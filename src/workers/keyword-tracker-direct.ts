/**
 * Direct keyword tracker — runs without pg-boss, called from /api/agent/run.
 */

import { supabaseAdmin } from '@/lib/supabase';

const SITE_DOMAIN = (process.env.SITE_URL ?? 'https://www.learnwealthx.in/')
  .replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');

async function findPosition(keyword: string, apiKey: string): Promise<{ position: number | null; searchVolume: number | null; intent: string | null }> {
  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: keyword, num: 100, gl: 'in' }),
  });
  if (!res.ok) throw new Error(`Serper ${res.status}`);
  const data = await res.json();

  // Find our position
  const organic: any[] = data.organic ?? [];
  const match = organic.find((r: any) => {
    try { return new URL(r.link).hostname.replace(/^www\./, '') === SITE_DOMAIN; }
    catch { return false; }
  });
  const position = match ? match.position : null;

  // Estimate search volume from answerBox/knowledgeGraph presence (rough proxy)
  // Serper doesn't return volume directly — use organic result count as proxy
  const searchVolume = data.searchInformation?.totalResults
    ? Math.min(100000, Math.round(parseInt(data.searchInformation.totalResults.replace(/,/g, '')) / 1000) * 10)
    : null;

  // Simple intent classification from keyword
  const kw = keyword.toLowerCase();
  let intent: string | null = null;
  if (/^(what|how|why|when|where|who|which|is|are|does|do|can|should)\b/.test(kw) || /\b(guide|tutorial|tips|learn|understand|explain)\b/.test(kw)) {
    intent = 'informational';
  } else if (/\b(buy|price|cost|cheap|discount|deal|purchase|order|shop)\b/.test(kw)) {
    intent = 'transactional';
  } else if (/\b(best|top|review|vs|compare|alternative|recommend)\b/.test(kw)) {
    intent = 'commercial';
  } else if (kw.split(' ').length <= 2) {
    intent = 'navigational';
  } else {
    intent = 'informational';
  }

  return { position, searchVolume, intent };
}

export async function runKeywordTrackerDirect(): Promise<number> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) throw new Error('SERPER_API_KEY not set');

  const { data: keywords } = await supabaseAdmin
    .from('keywords').select('id, keyword, current_position, intent_cluster').eq('is_tracked', true);

  if (!keywords || (keywords as any[]).length === 0) return 0;

  let updated = 0;
  for (const kw of keywords as any[]) {
    try {
      const { position, searchVolume, intent } = await findPosition(kw.keyword, apiKey);
      await supabaseAdmin.from('keywords').update({
        previous_position: kw.current_position,
        current_position: position,
        position_updated_at: new Date().toISOString(),
        ...(searchVolume !== null && { search_volume: searchVolume }),
        ...(intent !== null && !kw.intent_cluster && { intent_cluster: intent }),
      }).eq('id', kw.id);
      updated++;
    } catch (e: any) {
      console.warn(`[keyword-tracker-direct] ${kw.keyword}: ${e.message}`);
    }
  }
  return updated;
}
