import { supabaseAdmin } from '@/lib/supabase';

export interface ContentRefreshCandidate {
  pageId: string;
  url: string;
  title_tag: string | null;
  published_at: string;
  current_position: number | null;
  primary_keyword: string | null;
  days_since_published: number;
}

/**
 * Pure function — returns true iff the page is a refresh candidate:
 * - published 90+ days ago
 * - current position > 20 or unranked (null)
 *
 * Validates: Requirements 5.5
 */
export function isRefreshCandidate(
  publishedAt: Date,
  currentPosition: number | null
): boolean {
  const msPerDay = 1000 * 60 * 60 * 24;
  const daysSince = (Date.now() - publishedAt.getTime()) / msPerDay;
  const positionQualifies = currentPosition === null || currentPosition > 20;
  return daysSince >= 90 && positionQualifies;
}

/**
 * Queries pages that are candidates for a content refresh:
 * - created 90+ days ago (using created_at as proxy for published_at)
 * - primary keyword position > 20 or unranked
 *
 * Validates: Requirements 5.5
 */
export async function getContentRefreshCandidates(): Promise<ContentRefreshCandidate[]> {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabaseAdmin
    .from('pages')
    .select(`
      id,
      url,
      title_tag,
      created_at,
      keywords!primary_keyword_id (
        keyword,
        current_position
      )
    `)
    .lte('created_at', ninetyDaysAgo);

  if (error) {
    throw new Error(`Failed to fetch content refresh candidates: ${error.message}`);
  }

  const msPerDay = 1000 * 60 * 60 * 24;
  const now = Date.now();

  return (data ?? [])
    .filter((row: any) => {
      const position: number | null = row.keywords?.current_position ?? null;
      return position === null || position > 20;
    })
    .map((row: any) => {
      const publishedAt = row.created_at as string;
      const daysSince = Math.floor((now - new Date(publishedAt).getTime()) / msPerDay);
      return {
        pageId: row.id as string,
        url: row.url as string,
        title_tag: (row.title_tag as string | null) ?? null,
        published_at: publishedAt,
        current_position: (row.keywords?.current_position as number | null) ?? null,
        primary_keyword: (row.keywords?.keyword as string | null) ?? null,
        days_since_published: daysSince,
      };
    });
}
