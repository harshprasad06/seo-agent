/**
 * Keyword Discovery — reads GSC search queries and auto-adds high-opportunity
 * keywords to the keywords table for tracking.
 *
 * Opportunity criteria:
 * - impressions >= 10 (Google is showing us for this query)
 * - position > 10 (not on page 1 yet — room to improve)
 * - not already tracked
 * - not branded (learnwealthx)
 * - not navigational (login, signup, etc.)
 */

import { supabaseAdmin } from '../../lib/supabase';

const BRANDED_TERMS = ['learnwealthx', 'learn wealth x', 'learnwealth'];
const NAVIGATIONAL_TERMS = ['login', 'signup', 'sign up', 'sign in', 'register', 'password', 'forgot'];

function isLowValue(query: string): boolean {
  const q = query.toLowerCase();
  if (BRANDED_TERMS.some(t => q.includes(t))) return true;
  if (NAVIGATIONAL_TERMS.some(t => q.includes(t))) return true;
  if (q.length < 4) return true; // too short
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

export async function runKeywordDiscovery(): Promise<number> {
  // 1. Get all GSC queries with meaningful impressions
  const { data: gscData, error: gscError } = await supabaseAdmin
    .from('gsc_data_points')
    .select('query, impressions, position, clicks, ctr')
    .not('query', 'is', null)
    .gte('impressions', 10)
    .order('impressions', { ascending: false })
    .limit(500);

  if (gscError) throw new Error(`Failed to fetch GSC data: ${gscError.message}`);
  if (!gscData || (gscData as any[]).length === 0) {
    console.log('[keyword-discovery] No GSC data available yet');
    return 0;
  }

  // 2. Get already-tracked keywords to avoid duplicates
  const { data: existing } = await supabaseAdmin
    .from('keywords').select('keyword');
  const existingSet = new Set(((existing ?? []) as any[]).map((k: any) => k.keyword.toLowerCase()));

  // 3. Aggregate by query (sum impressions, avg position across dates)
  const queryMap: Record<string, { impressions: number; positionSum: number; count: number; clicks: number }> = {};
  for (const row of gscData as any[]) {
    const q = row.query?.trim().toLowerCase();
    if (!q) continue;
    if (!queryMap[q]) queryMap[q] = { impressions: 0, positionSum: 0, count: 0, clicks: 0 };
    queryMap[q].impressions += row.impressions ?? 0;
    queryMap[q].positionSum += parseFloat(row.position ?? '0');
    queryMap[q].count++;
    queryMap[q].clicks += row.clicks ?? 0;
  }

  // 4. Filter for opportunities
  const opportunities = Object.entries(queryMap)
    .map(([query, stats]) => ({
      query,
      impressions: stats.impressions,
      avgPosition: stats.count > 0 ? stats.positionSum / stats.count : 100,
      clicks: stats.clicks,
    }))
    .filter(o => {
      if (isLowValue(o.query)) return false;
      if (existingSet.has(o.query)) return false;
      if (o.avgPosition <= 3) return false; // already ranking well
      return true;
    })
    .sort((a, b) => {
      // Score: high impressions + position between 4-30 = best opportunity
      const scoreA = a.impressions * (a.avgPosition <= 30 ? 2 : 1);
      const scoreB = b.impressions * (b.avgPosition <= 30 ? 2 : 1);
      return scoreB - scoreA;
    })
    .slice(0, 20); // max 20 new keywords per run

  if (opportunities.length === 0) {
    console.log('[keyword-discovery] No new keyword opportunities found');
    return 0;
  }

  // 5. Insert new keywords
  let added = 0;
  for (const opp of opportunities) {
    const status = opp.avgPosition <= 20 ? 'unranked_opportunity' : 'unranked_opportunity';
    const { error } = await supabaseAdmin
      .from('keywords')
      .upsert({
        keyword: opp.query,
        is_tracked: true,
        is_approved: false,
        status,
        intent_cluster: classifyIntent(opp.query),
        search_volume: opp.impressions, // use impressions as proxy
      }, { onConflict: 'keyword' });

    if (!error) added++;
  }

  console.log(`[keyword-discovery] Added ${added} new keyword opportunities from GSC`);
  return added;
}
