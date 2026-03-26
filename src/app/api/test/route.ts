/**
 * GET /api/test
 * Runs all agent features end-to-end against learnwealthx.in with real data.
 * Returns a step-by-step log of what passed/failed.
 */

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getQueue } from '@/lib/queue';

interface StepResult {
  step: string;
  status: 'ok' | 'error' | 'skipped';
  detail: string;
}

const results: StepResult[] = [];

function log(step: string, status: StepResult['status'], detail: string) {
  console.log(`[test] [${status.toUpperCase()}] ${step}: ${detail}`);
  results.push({ step, status, detail });
}

export async function GET(): Promise<NextResponse> {
  results.length = 0;

  // ── Step 1: Seed keywords ──────────────────────────────────────────────────
  try {
    const { error } = await supabaseAdmin.from('keywords').upsert([
      { keyword: 'learnwealthx', is_tracked: true, is_approved: true, status: 'ranked' },
      { keyword: 'online courses india', is_tracked: true, is_approved: true, status: 'unranked_opportunity' },
      { keyword: 'stock market course online india', is_tracked: true, is_approved: true, status: 'unranked_opportunity' },
      { keyword: 'learn trading online india', is_tracked: true, is_approved: true, status: 'unranked_opportunity' },
      { keyword: 'best skill development courses india', is_tracked: true, is_approved: true, status: 'unranked_opportunity' },
    ], { onConflict: 'keyword' });
    if (error) throw error;
    log('Seed keywords', 'ok', '5 keywords seeded for learnwealthx.in');
  } catch (err: any) {
    log('Seed keywords', 'error', err.message);
  }

  // ── Step 2: Seed competitors ───────────────────────────────────────────────
  try {
    const { error } = await supabaseAdmin.from('competitors').upsert([
      { domain: 'udemy.com', name: 'Udemy', is_active: true },
      { domain: 'unacademy.com', name: 'Unacademy', is_active: true },
      { domain: 'coursera.org', name: 'Coursera', is_active: true },
    ], { onConflict: 'domain' });
    if (error) throw error;
    log('Seed competitors', 'ok', '3 competitors added');
  } catch (err: any) {
    log('Seed competitors', 'error', err.message);
  }

  // ── Step 3: Queue all workers ──────────────────────────────────────────────
  let boss: Awaited<ReturnType<typeof getQueue>> | null = null;
  try {
    boss = await getQueue();
    log('pg-boss connect', 'ok', 'Queue connected');
  } catch (err: any) {
    log('pg-boss connect', 'error', err.message);
  }

  const jobs = [
    { name: 'site-crawl', label: 'Site Crawl (learnwealthx.in)' },
    { name: 'keyword-tracker', label: 'Keyword Tracker (real Google rankings)' },
    { name: 'pagespeed-audit', label: 'PageSpeed Audit (Core Web Vitals)' },
    { name: 'backlink-sync', label: 'Backlink Sync (Serper link: query)' },
    { name: 'competitor-monitor', label: 'Competitor Monitor' },
  ];

  for (const job of jobs) {
    if (!boss) {
      log(job.label, 'skipped', 'pg-boss not connected');
      continue;
    }
    try {
      await boss.send(job.name, {});
      log(job.label, 'ok', `Job "${job.name}" queued — will run in background`);
    } catch (err: any) {
      log(job.label, 'error', err.message);
    }
  }

  // ── Step 4: Verify GSC token exists ───────────────────────────────────────
  try {
    const { data } = await supabaseAdmin
      .from('oauth_tokens')
      .select('provider, expires_at')
      .eq('provider', 'gsc')
      .single();
    if (data) {
      const expired = new Date(data.expires_at) < new Date();
      log('GSC OAuth token', expired ? 'error' : 'ok',
        expired ? 'Token expired — sign out and sign back in to refresh' : `Token valid until ${data.expires_at}`);
      if (!expired && boss) {
        await boss.send('gsc-sync', {});
        log('GSC Sync', 'ok', 'gsc-sync job queued');
      }
    } else {
      log('GSC OAuth token', 'skipped', 'No token found — sign in with Google to connect GSC');
    }
  } catch (err: any) {
    log('GSC OAuth token', 'skipped', 'Not connected yet');
  }

  // ── Step 5: Test Gemini → Groq fallback (blog generation) ────────────────
  let llmReady = false;
  try {
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(
      process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GEMINI_API_KEY ?? ''
    );
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-lite' });
    const result = await model.generateContent('Reply with just: OK');
    const text = result.response.text().trim();
    log('Gemini API', 'ok', `Response: "${text}" — blog generation ready`);
    llmReady = true;
  } catch (err: any) {
    const msg = err.message ?? '';
    if (msg.includes('429') || msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED')) {
      log('Gemini API', 'skipped', 'Quota exceeded — trying Groq fallback');
    } else {
      log('Gemini API', 'error', msg);
    }
  }

  // ── Step 5b: Groq fallback ─────────────────────────────────────────────────
  if (!llmReady) {
    try {
      const Groq = (await import('groq-sdk')).default;
      const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
      const completion = await groq.chat.completions.create({
        model: 'llama-3.1-8b-instant',
        messages: [{ role: 'user', content: 'Reply with just: OK' }],
        max_tokens: 10,
      });
      const text = completion.choices[0]?.message?.content?.trim() ?? '';
      log('Groq API (fallback)', 'ok', `Response: "${text}" — blog generation ready via Groq`);
    } catch (err: any) {
      log('Groq API (fallback)', 'error', err.message);
    }
  }

  // ── Step 6: Test Serper ────────────────────────────────────────────────────
  try {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': process.env.SERPER_API_KEY ?? '', 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: 'learnwealthx', num: 3 }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const count = data.organic?.length ?? 0;
    log('Serper API', 'ok', `${count} organic results returned for "learnwealthx"`);
  } catch (err: any) {
    log('Serper API', 'error', err.message);
  }

  // ── Step 7: Test GitHub PAT ────────────────────────────────────────────────
  try {
    const res = await fetch(
      `https://api.github.com/repos/${process.env.GITHUB_REPO_OWNER}/${process.env.GITHUB_REPO_NAME}`,
      { headers: { Authorization: `token ${process.env.GITHUB_PAT}`, Accept: 'application/vnd.github.v3+json' } }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    log('GitHub PAT', 'ok', `Repo "${data.full_name}" accessible — PR creation ready`);
  } catch (err: any) {
    log('GitHub PAT', 'error', err.message);
  }

  const passed = results.filter(r => r.status === 'ok').length;
  const failed = results.filter(r => r.status === 'error').length;
  const skipped = results.filter(r => r.status === 'skipped').length;

  return NextResponse.json({
    summary: { passed, failed, skipped, total: results.length },
    results,
    next: 'Workers are running in background. Check Supabase tables in 2-3 minutes for real data.',
  });
}
