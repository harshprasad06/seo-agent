import { supabaseAdmin } from '../../lib/supabase';

export interface DisplacementOpportunity {
  keywordId: string;
  keyword: string;
  ourPosition: number;
  competitorDomain: string;
  competitorPosition: number;
  delta: number;
}

/**
 * Pure function: returns true iff |ourPosition - competitorPosition| <= 5.
 * Validates: Requirements 7.3, 7.5
 */
export function isDisplacementOpportunity(
  ourPosition: number,
  competitorPosition: number,
): boolean {
  return Math.abs(ourPosition - competitorPosition) <= 5;
}

interface KeywordRow {
  id: string;
  keyword: string;
  current_position: number;
}

interface CompetitorKeywordRow {
  competitor_id: string;
  keyword: string;
  position: number;
  tracked_at: string;
  competitors: { domain: string } | { domain: string }[] | null;
}

interface CompetitorEntry {
  domain: string;
  position: number;
  tracked_at: string;
}

/**
 * Identifies displacement opportunities: keywords where goodads.ai and a
 * competitor both have a ranking position and |delta| <= 5.
 *
 * Steps:
 * 1. Fetch all our keywords with a current_position (not null, not > 100)
 * 2. Fetch latest competitor_keywords per active competitor per keyword
 * 3. Match on keyword text (case-insensitive)
 * 4. Flag as displacement_opportunity when |our_position - competitor_position| <= 5
 * 5. Update keyword status to 'displacement_opportunity' in keywords table
 *
 * Validates: Requirements 7.3, 7.5
 */
export async function identifyDisplacementOpportunities(): Promise<DisplacementOpportunity[]> {
  // 1. Fetch our ranked keywords (position 1–100)
  const { data: ownKeywords, error: ownError } = await supabaseAdmin
    .from('keywords')
    .select('id, keyword, current_position')
    .not('current_position', 'is', null)
    .lte('current_position', 100)
    .gt('current_position', 0);

  if (ownError) {
    throw new Error(`Failed to fetch own keywords: ${ownError.message}`);
  }

  if (!ownKeywords || ownKeywords.length === 0) {
    return [];
  }

  // 2. Fetch latest competitor_keywords for each active competitor
  // We join competitors to filter is_active=true and get the domain
  const { data: competitorKeywords, error: compError } = await supabaseAdmin
    .from('competitor_keywords')
    .select('competitor_id, keyword, position, tracked_at, competitors!inner(domain)')
    .eq('competitors.is_active', true)
    .not('position', 'is', null);

  if (compError) {
    throw new Error(`Failed to fetch competitor keywords: ${compError.message}`);
  }

  if (!competitorKeywords || competitorKeywords.length === 0) {
    return [];
  }

  // Build a map: keyword_lower -> latest entry per (competitor_id, keyword)
  // Keep only the most recent tracked_at per competitor per keyword
  const latestCompMap = new Map<string, Map<string, CompetitorEntry>>();

  for (const row of competitorKeywords as CompetitorKeywordRow[]) {
    const keyLower = row.keyword.toLowerCase();
    const domain = Array.isArray(row.competitors)
      ? (row.competitors[0]?.domain ?? 'unknown')
      : (row.competitors?.domain ?? 'unknown');

    const compKey = `${row.competitor_id}::${keyLower}`;

    if (!latestCompMap.has(keyLower)) {
      latestCompMap.set(keyLower, new Map());
    }

    const perKeyword = latestCompMap.get(keyLower)!;
    const existing = perKeyword.get(compKey);

    // Keep the entry with the latest tracked_at
    if (!existing || row.tracked_at > existing.tracked_at) {
      perKeyword.set(compKey, { domain, position: row.position, tracked_at: row.tracked_at });
    }
  }

  // 3 & 4. Match our keywords against competitor keywords and find displacement opportunities
  const opportunities: DisplacementOpportunity[] = [];
  const displacementKeywordIds = new Set<string>();

  for (const ownKw of ownKeywords as KeywordRow[]) {
    const keyLower = ownKw.keyword.toLowerCase();
    const compEntries = latestCompMap.get(keyLower);

    if (!compEntries) continue;

    for (const [, compData] of Array.from(compEntries.entries())) {
      const { domain, position: competitorPosition } = compData;

      if (isDisplacementOpportunity(ownKw.current_position, competitorPosition)) {
        opportunities.push({
          keywordId: ownKw.id,
          keyword: ownKw.keyword,
          ourPosition: ownKw.current_position,
          competitorDomain: domain,
          competitorPosition,
          delta: Math.abs(ownKw.current_position - competitorPosition),
        });
        displacementKeywordIds.add(ownKw.id);
      }
    }
  }

  // 5. Update keyword status to 'displacement_opportunity' for all matched keywords
  if (displacementKeywordIds.size > 0) {
    const { error: updateError } = await supabaseAdmin
      .from('keywords')
      .update({ status: 'displacement_opportunity' })
      .in('id', Array.from(displacementKeywordIds));

    if (updateError) {
      throw new Error(`Failed to update keyword statuses: ${updateError.message}`);
    }
  }

  return opportunities;
}
