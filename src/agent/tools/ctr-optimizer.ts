/**
 * CTR Optimizer — finds pages with high impressions but low CTR in GSC data,
 * then generates better title/meta suggestions using AI.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { supabaseAdmin } from '../../lib/supabase';
import { createRecommendation } from '../workflow/approval-queue';

async function callAI(prompt: string): Promise<string> {
  const geminiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GEMINI_API_KEY;
  if (geminiKey) {
    try {
      const genAI = new GoogleGenerativeAI(geminiKey);
      const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
      const result = await model.generateContent(prompt);
      return result.response.text().trim();
    } catch (err: any) {
      if (!err.message?.includes('429') && !err.message?.includes('quota')) throw err;
    }
  }
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) throw new Error('No AI available');
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.4,
    }),
  });
  if (!res.ok) throw new Error(`Groq error: ${await res.text()}`);
  const json: any = await res.json();
  return json.choices?.[0]?.message?.content?.trim() ?? '';
}

export async function runCTROptimizer(): Promise<number> {
  // Find pages with high impressions but CTR below 3%
  // Group by URL, sum impressions, avg CTR
  const { data: gscData, error } = await supabaseAdmin
    .from('gsc_data_points')
    .select('url, impressions, ctr, query')
    .gte('impressions', 50); // only pages with meaningful impressions

  if (error || !gscData || (gscData as any[]).length === 0) {
    console.log('[ctr-optimizer] No GSC data available');
    return 0;
  }

  // Aggregate by URL
  const urlStats: Record<string, { impressions: number; ctrSum: number; count: number; queries: string[] }> = {};
  for (const row of gscData as any[]) {
    if (!urlStats[row.url]) urlStats[row.url] = { impressions: 0, ctrSum: 0, count: 0, queries: [] };
    urlStats[row.url].impressions += row.impressions ?? 0;
    urlStats[row.url].ctrSum += parseFloat(row.ctr ?? '0');
    urlStats[row.url].count++;
    if (row.query && !urlStats[row.url].queries.includes(row.query)) {
      urlStats[row.url].queries.push(row.query);
    }
  }

  // Find low-CTR pages (avg CTR < 3%)
  const lowCTRPages = Object.entries(urlStats)
    .map(([url, s]) => ({ url, impressions: s.impressions, avgCTR: s.count > 0 ? s.ctrSum / s.count : 0, queries: s.queries }))
    .filter(p => p.avgCTR < 0.03 && p.impressions >= 50)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 5); // top 5 opportunities

  if (lowCTRPages.length === 0) {
    console.log('[ctr-optimizer] No low-CTR pages found');
    return 0;
  }

  let recsCreated = 0;

  for (const page of lowCTRPages) {
    // Get current title/meta from pages table
    const { data: pageRow } = await supabaseAdmin
      .from('pages')
      .select('id, title_tag, meta_description')
      .eq('url', page.url)
      .single();

    if (!pageRow) continue;
    const p = pageRow as any;

    const topQueries = page.queries.slice(0, 5).join(', ');
    const prompt = `You are an SEO specialist. A page has high impressions but low CTR in Google Search.

Page URL: ${page.url}
Current title: ${p.title_tag ?? 'missing'}
Current meta description: ${p.meta_description ?? 'missing'}
Top search queries it appears for: ${topQueries}
Current avg CTR: ${(page.avgCTR * 100).toFixed(1)}%
Impressions: ${page.impressions}

Write an improved title tag (max 60 chars) and meta description (max 155 chars) that will increase click-through rate.
Make them compelling, include the main keyword naturally, and add a clear value proposition.

Respond in this exact format:
TITLE: [your title here]
META: [your meta description here]`;

    try {
      const suggestion = await callAI(prompt);
      const titleMatch = suggestion.match(/TITLE:\s*(.+)/i);
      const metaMatch = suggestion.match(/META:\s*(.+)/i);

      if (!titleMatch && !metaMatch) continue;

      await createRecommendation({
        type: 'improve_ctr',
        pageId: p.id,
        currentState: {
          url: page.url,
          title_tag: p.title_tag,
          meta_description: p.meta_description,
          avg_ctr: page.avgCTR,
          impressions: page.impressions,
          top_queries: topQueries,
        },
        proposedChange: {
          title_tag: titleMatch?.[1]?.trim() ?? p.title_tag,
          meta_description: metaMatch?.[1]?.trim() ?? p.meta_description,
        },
        reason: `Page has ${page.impressions} impressions but only ${(page.avgCTR * 100).toFixed(1)}% CTR — improved title/meta can significantly increase clicks`,
        expectedImpact: 'Improving CTR from <3% to 5-8% could double organic traffic to this page',
        priority: 7,
      });
      recsCreated++;
    } catch (err: any) {
      console.error(`[ctr-optimizer] Failed for ${page.url}: ${err.message}`);
    }
  }

  console.log(`[ctr-optimizer] Created ${recsCreated} CTR improvement recommendation(s)`);
  return recsCreated;
}
