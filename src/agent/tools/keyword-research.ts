import { supabaseAdmin } from '../../lib/supabase';

const SERPER_API_URL = 'https://google.serper.dev/search';

export interface KeywordSuggestion {
  keyword: string;
  search_volume: number;
  difficulty: number;
  current_position: number | null;
}

interface SerperOrganicResult {
  title: string;
  link: string;
  snippet?: string;
  position: number;
}

interface SerperResponse {
  organic?: SerperOrganicResult[];
}

/**
 * Inverted-rank heuristic: position 1 → 1000, position 10 → 100.
 */
function volumeFromPosition(position: number): number {
  return Math.max(100, Math.round(1000 / position));
}

/**
 * Placeholder difficulty: random integer in [20, 80].
 * Real data would come from DataForSEO in production.
 */
function randomDifficulty(): number {
  return Math.floor(Math.random() * 61) + 20; // 20..80
}

/**
 * Performs keyword research for a given topic using Serper.dev.
 * Upserts suggestions into the `keywords` table and returns them.
 */
export async function keywordResearch(topic: string): Promise<KeywordSuggestion[]> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    throw new Error('SERPER_API_KEY environment variable is not set');
  }

  // 1. Fetch organic results from Serper.dev
  const response = await fetch(SERPER_API_URL, {
    method: 'POST',
    headers: {
      'X-API-KEY': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ q: topic, num: 10 }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Serper API error ${response.status}: ${body}`);
  }

  const data: SerperResponse = await response.json();
  const organic = data.organic ?? [];

  if (organic.length === 0) {
    return [];
  }

  // 2. Look up existing positions for these keywords in one query
  const keywordTexts = organic.map((r) => r.title);
  const { data: existingRows } = await supabaseAdmin
    .from('keywords')
    .select('keyword, current_position')
    .in('keyword', keywordTexts);

  const existingMap = new Map<string, number | null>(
    (existingRows ?? []).map((row: { keyword: string; current_position: number | null }) => [
      row.keyword,
      row.current_position,
    ]),
  );

  // 3. Build suggestions
  const suggestions: KeywordSuggestion[] = organic.map((result) => ({
    keyword: result.title,
    search_volume: volumeFromPosition(result.position),
    difficulty: randomDifficulty(),
    current_position: existingMap.has(result.title)
      ? (existingMap.get(result.title) ?? null)
      : null,
  }));

  // 4. Upsert into keywords table
  const upsertRows = suggestions.map((s) => ({
    keyword: s.keyword,
    search_volume: s.search_volume,
    difficulty: s.difficulty,
    status: s.current_position !== null ? 'ranked' : 'unranked_opportunity',
  }));

  const { error } = await supabaseAdmin
    .from('keywords')
    .upsert(upsertRows, { onConflict: 'keyword' });

  if (error) {
    throw new Error(`Failed to upsert keywords: ${error.message}`);
  }

  return suggestions;
}
