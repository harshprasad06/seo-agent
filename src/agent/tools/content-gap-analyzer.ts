import { supabaseAdmin } from '../../lib/supabase';

// Keywords that indicate strong product alignment with goodads.ai
const PRODUCT_ALIGNED_TERMS = [
  'ads',
  'catalog',
  'dpa',
  'dynamic',
  'product',
  'feed',
  'ecommerce',
  'shopping',
  'retargeting',
  'facebook ads',
  'google ads',
  'meta ads',
];

export interface ContentGap {
  keyword: string;
  search_volume: number | null;
  difficulty: number | null;
  current_position: number | null;
  competitor_positions: { competitor: string; position: number }[];
  traffic_opportunity: number;
  source: 'unranked' | 'competitor_gap' | 'both';
}

interface KeywordRow {
  keyword: string;
  search_volume: number | null;
  difficulty: number | null;
  current_position: number | null;
  status: string | null;
}

interface CompetitorKeywordRow {
  keyword: string;
  position: number;
  // Supabase returns joined rows as an array even for !inner joins
  competitors: { name: string }[] | { name: string } | null;
}

/**
 * Returns a product alignment multiplier for a keyword.
 * 2.0 if the keyword contains any product-aligned term, 1.0 otherwise.
 */
function productAlignmentScore(keyword: string): number {
  const lower = keyword.toLowerCase();
  return PRODUCT_ALIGNED_TERMS.some((term) => lower.includes(term)) ? 2.0 : 1.0;
}

/**
 * Computes the traffic opportunity score for a gap keyword.
 * traffic_opportunity = search_volume * (1 / max(difficulty, 1)) * product_alignment_score
 */
function trafficOpportunity(
  searchVolume: number | null,
  difficulty: number | null,
  keyword: string,
): number {
  const volume = searchVolume ?? 0;
  const diff = difficulty ?? 1;
  return volume * (1 / Math.max(diff, 1)) * productAlignmentScore(keyword);
}

/**
 * Analyzes content gaps by comparing goodads.ai keyword coverage against
 * competitor rankings and unranked high-volume opportunities.
 *
 * Validates: Requirements 5.1, 5.3
 */
export async function analyzeContentGaps(): Promise<ContentGap[]> {
  // 1. Fetch our unranked / poorly-ranked keywords
  const { data: ownKeywords, error: ownError } = await supabaseAdmin
    .from('keywords')
    .select('keyword, search_volume, difficulty, current_position, status')
    .or('status.eq.unranked_opportunity,current_position.gt.20,current_position.is.null');

  if (ownError) {
    throw new Error(`Failed to fetch own keywords: ${ownError.message}`);
  }

  // 2. Fetch competitor keywords for active competitors (position <= 20)
  const { data: competitorKeywords, error: compError } = await supabaseAdmin
    .from('competitor_keywords')
    .select('keyword, position, competitors!inner(name)')
    .lte('position', 20)
    .eq('competitors.is_active', true);

  if (compError) {
    throw new Error(`Failed to fetch competitor keywords: ${compError.message}`);
  }

  // Build a map of our own keyword positions for quick lookup
  const ownKeywordMap = new Map<string, KeywordRow>(
    (ownKeywords ?? []).map((row: KeywordRow) => [row.keyword.toLowerCase(), row]),
  );

  // Build a full set of all our ranked keywords (position <= 20) to identify gaps
  const { data: rankedOwn, error: rankedError } = await supabaseAdmin
    .from('keywords')
    .select('keyword, current_position')
    .lte('current_position', 20);

  if (rankedError) {
    throw new Error(`Failed to fetch ranked keywords: ${rankedError.message}`);
  }

  const rankedOwnSet = new Set<string>(
    (rankedOwn ?? []).map((r: { keyword: string }) => r.keyword.toLowerCase()),
  );

  // 3. Group competitor positions by keyword
  const competitorPositionMap = new Map<string, { competitor: string; position: number }[]>();
  for (const row of (competitorKeywords ?? []) as CompetitorKeywordRow[]) {
    const key = row.keyword.toLowerCase();
    const comp = row.competitors;
    const competitorName = Array.isArray(comp)
      ? (comp[0]?.name ?? 'unknown')
      : (comp?.name ?? 'unknown');
    if (!competitorPositionMap.has(key)) {
      competitorPositionMap.set(key, []);
    }
    competitorPositionMap.get(key)!.push({ competitor: competitorName, position: row.position });
  }

  // 4. Build the combined gap map (deduplicated by keyword text)
  const gapMap = new Map<string, ContentGap>();

  // Add our own unranked/poorly-ranked keywords
  for (const row of (ownKeywords ?? []) as KeywordRow[]) {
    const key = row.keyword.toLowerCase();
    gapMap.set(key, {
      keyword: row.keyword,
      search_volume: row.search_volume,
      difficulty: row.difficulty,
      current_position: row.current_position,
      competitor_positions: competitorPositionMap.get(key) ?? [],
      traffic_opportunity: trafficOpportunity(row.search_volume, row.difficulty, row.keyword),
      source: 'unranked',
    });
  }

  // Add competitor gap keywords (competitors rank for it, we don't)
  for (const [key, positions] of Array.from(competitorPositionMap.entries())) {
    if (rankedOwnSet.has(key)) {
      // We already rank well for this keyword — not a gap
      continue;
    }

    if (gapMap.has(key)) {
      // Already in map from our own unranked list — update source and competitor positions
      const existing = gapMap.get(key)!;
      existing.source = 'both';
      existing.competitor_positions = positions;
    } else {
      // Pure competitor gap — not in our keywords table at all
      const ownData = ownKeywordMap.get(key);
      gapMap.set(key, {
        keyword: positions[0] ? key : key, // preserve original casing from competitor data
        search_volume: ownData?.search_volume ?? null,
        difficulty: ownData?.difficulty ?? null,
        current_position: ownData?.current_position ?? null,
        competitor_positions: positions,
        traffic_opportunity: trafficOpportunity(
          ownData?.search_volume ?? null,
          ownData?.difficulty ?? null,
          key,
        ),
        source: 'competitor_gap',
      });
    }
  }

  // 5. Sort by traffic_opportunity DESC and return top 50
  return Array.from(gapMap.values())
    .sort((a, b) => b.traffic_opportunity - a.traffic_opportunity)
    .slice(0, 50);
}
