/**
 * Direct (no pg-boss) competitor monitor — runs inline during agent execution.
 * Uses Serper site: search to find each competitor's top pages/keywords.
 */

import { supabaseAdmin } from '../lib/supabase';

const SERPER_API_URL = 'https://google.serper.dev/search';

export async function runCompetitorMonitorDirect(): Promise<number> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) throw new Error('SERPER_API_KEY not set');

  const { data: competitors, error } = await supabaseAdmin
    .from('competitors')
    .select('id, domain, name')
    .eq('is_active', true);

  if (error) throw new Error(`Failed to fetch competitors: ${error.message}`);
  if (!competitors || (competitors as any[]).length === 0) return 0;

  const today = new Date().toISOString().split('T')[0];

  for (const comp of competitors as any[]) {
    try {
      const res = await fetch(SERPER_API_URL, {
        method: 'POST',
        headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: `site:${comp.domain}`, num: 20 }),
      });
      if (!res.ok) continue;

      const json: any = await res.json();
      const organic: any[] = json.organic ?? [];

      for (let i = 0; i < organic.length; i++) {
        const result = organic[i];
        const keyword = result.title?.trim();
        if (!keyword) continue;
        const position = result.position ?? i + 1;

        await supabaseAdmin
          .from('competitor_keywords')
          .upsert(
            { competitor_id: comp.id, keyword, position, tracked_at: today },
            { onConflict: 'competitor_id,keyword,tracked_at' },
          );
      }

      console.log(`[competitor-monitor-direct] ${comp.domain}: ${organic.length} keyword(s) upserted`);
    } catch (err) {
      console.error(`[competitor-monitor-direct] Error for ${comp.domain}:`, err);
    }
  }

  return (competitors as any[]).length;
}
