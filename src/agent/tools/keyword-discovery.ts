/**
 * Keyword Discovery — two modes:
 * 1. GSC mode: reads search queries from Google Search Console data (best quality)
 * 2. AI mode: fetches site content and uses AI to generate keyword ideas (fallback when no GSC data)
 *
 * Runs automatically every agent run. Adds new keywords to the DB once per day max.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { supabaseAdmin } from '../../lib/supabase';

const BRANDED_TERMS = (process.env.SITE_BRANDED_TERMS ?? '').split(',').map(t => t.trim()).filter(Boolean);
const NAVIGATIONAL_TERMS = ['login', 'signup', 'sign up', 'sign in', 'register', 'password', 'forgot'];

function isLowValue(query: string): boolean {
  const q = query.toLowerCase();
  if (BRANDED_TERMS.some(t => t && q.includes(t))) return true;
  if (NAVIGATIONAL_TERMS.some(t => q.includes(t))) return true;
  if (q.length < 4) return true;
  return false;
}

function classifyIntent(query: string): string {
  const q = query.toLowerCase();
  if (/^(what|how|why|when|where|who|which|is|are|does|do|can|should)\b/.test(q) ||
      /\b(guide|tutorial|tips|learn|understand|explain|meaning|definition)\b/.test(q)) {
    return 'informational';
  }
  if (/\b(buy|price|cost|cheap|discount|deal|purchase|order|shop|enroll|join)\b/.test(q)) {
    return 'transactional';
  }
  if (/\b(best|top|review|vs|compare|alternative|recommend|rating)\b/.test(q)) {
    return 'commercial';
  }
  return 'informational';
}

async function upsertKeywords(keywords: Array<{ keyword: string; impressions?: number }>): Promise<number> {
  const { data: existing } = await supabaseAdmin.from('keywords').select('keyword');
  const existingSet = new Set(((existing ?? []) as any[]).map((k: any) => k.keyword.toLowerCase()));

  let added = 0;
  for (const kw of keywords) {
    if (existingSet.has(kw.keyword.toLowerCase())) continue;
    if (isLowValue(kw.keyword)) continue;

    const { error } = await supabaseAdmin.from('keywords').upsert({
      keyword: kw.keyword,
      is_tracked: true,
      is_approved: false,
      status: 'unranked_opportunity',
      intent_cluster: classifyIntent(kw.keyword),
      search_volume: kw.impressions ?? null,
    }, { onConflict: 'keyword' });

    if (!error) added++;
  }
  return added;
}

// ── Mode 1: GSC-based discovery ───────────────────────────────────────────────

async function discoverFromGSC(): Promise<number> {
  const { data: gscData, error } = await supabaseAdmin
    .from('gsc_data_points')
    .select('query, impressions, position')
    .not('query', 'is', null)
    .gte('impressions', 10)
    .order('impressions', { ascending: false })
    .limit(500);

  if (error || !gscData || (gscData as any[]).length === 0) return -1; // signal: no GSC data

  const queryMap: Record<string, { impressions: number; positionSum: number; count: number }> = {};
  for (const row of gscData as any[]) {
    const q = row.query?.trim().toLowerCase();
    if (!q) continue;
    if (!queryMap[q]) queryMap[q] = { impressions: 0, positionSum: 0, count: 0 };
    queryMap[q].impressions += row.impressions ?? 0;
    queryMap[q].positionSum += parseFloat(row.position ?? '0');
    queryMap[q].count++;
  }

  const opportunities = Object.entries(queryMap)
    .map(([query, s]) => ({ keyword: query, impressions: s.impressions, avgPos: s.count > 0 ? s.positionSum / s.count : 100 }))
    .filter(o => o.avgPos > 3) // skip already top-3
    .sort((a, b) => (b.impressions * (b.avgPos <= 30 ? 2 : 1)) - (a.impressions * (a.avgPos <= 30 ? 2 : 1)))
    .slice(0, 20);

  return upsertKeywords(opportunities);
}

// ── Mode 2: AI-based discovery (fallback) ─────────────────────────────────────

async function discoverFromAI(): Promise<number> {
  const siteUrl = process.env.SITE_URL ?? '';
  const siteName = process.env.SITE_NAME ?? '';
  const siteDesc = process.env.SITE_DESCRIPTION ?? '';

  if (!siteUrl) return 0;

  // Fetch homepage content
  let siteContent = '';
  try {
    const res = await fetch(siteUrl, {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SEOAgent/1.0)' },
    });
    if (res.ok) {
      const html = await res.text();
      siteContent = html.replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 3000);
    }
  } catch {}

  const prompt = `You are an SEO keyword researcher.

Site: ${siteName} (${siteUrl})
Description: ${siteDesc}
Homepage content: ${siteContent.slice(0, 1500)}

Generate 15 high-value SEO keywords this site should rank for.
Focus on:
- Long-tail keywords (3-5 words) with clear search intent
- Keywords potential customers would search
- Mix of informational and transactional intent
- Avoid brand name keywords

Return ONLY a JSON array of strings, no explanation:
["keyword 1", "keyword 2", ...]`;

  let text = '';
  const geminiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GEMINI_API_KEY;
  if (geminiKey) {
    try {
      const genAI = new GoogleGenerativeAI(geminiKey);
      const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
      const result = await model.generateContent(prompt);
      text = result.response.text().trim();
    } catch (err: any) {
      if (!err.message?.includes('429') && !err.message?.includes('quota')) throw err;
    }
  }

  if (!text) {
    const groqKey = process.env.GROQ_API_KEY;
    if (!groqKey) return 0;
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'llama-3.1-8b-instant', messages: [{ role: 'user', content: prompt }], temperature: 0.3 }),
    });
    if (!res.ok) return 0;
    const json: any = await res.json();
    text = json.choices?.[0]?.message?.content?.trim() ?? '';
  }

  try {
    const clean = text.replace(/^```json?\s*/i, '').replace(/```\s*$/i, '').trim();
    const keywords: string[] = JSON.parse(clean);
    return upsertKeywords(keywords.map(k => ({ keyword: k.toLowerCase().trim() })));
  } catch {
    return 0;
  }
}

// ── Main entry point ──────────────────────────────────────────────────────────

export async function runKeywordDiscovery(): Promise<number> {
  // Check if already ran today
  const today = new Date().toISOString().split('T')[0];
  const { data: todayKw } = await supabaseAdmin
    .from('keywords')
    .select('id')
    .gte('created_at', `${today}T00:00:00Z`)
    .limit(1);

  // Try GSC first
  const gscResult = await discoverFromGSC();

  if (gscResult === -1) {
    // No GSC data — use AI discovery
    console.log('[keyword-discovery] No GSC data — using AI-based discovery');
    const aiResult = await discoverFromAI();
    console.log(`[keyword-discovery] AI discovery added ${aiResult} keyword(s)`);
    return aiResult;
  }

  console.log(`[keyword-discovery] GSC discovery added ${gscResult} keyword(s)`);
  return gscResult;
}
