/**
 * Direct keyword tracker — runs without pg-boss, called from /api/agent/run.
 */

import { supabaseAdmin } from '@/lib/supabase';

const SITE_DOMAIN = (process.env.SITE_URL ?? 'https://www.learnwealthx.in/')
  .replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');

async function findPosition(keyword: string, apiKey: string): Promise<number | null> {
  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: keyword, num: 10, gl: 'in' }),
  });
  if (!res.ok) throw new Error(`Serper ${res.status}`);
  const data = await res.json();
  const match = (data.organic ?? []).find((r: any) => {
    try { return new URL(r.link).hostname.replace(/^www\./, '') === SITE_DOMAIN; }
    catch { return false; }
  });
  return match ? match.position : null;
}

export async function runKeywordTrackerDirect(): Promise<number> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) throw new Error('SERPER_API_KEY not set');

  const { data: keywords } = await supabaseAdmin
    .from('keywords').select('id, keyword, current_position').eq('is_tracked', true);

  if (!keywords || (keywords as any[]).length === 0) return 0;

  let updated = 0;
  for (const kw of keywords as any[]) {
    try {
      const pos = await findPosition(kw.keyword, apiKey);
      await supabaseAdmin.from('keywords').update({
        previous_position: kw.current_position,
        current_position: pos,
        position_updated_at: new Date().toISOString(),
      }).eq('id', kw.id);
      updated++;
    } catch (e: any) {
      console.warn(`[keyword-tracker-direct] ${kw.keyword}: ${e.message}`);
    }
  }
  return updated;
}
