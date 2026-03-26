import { supabaseAdmin } from '../../lib/supabase';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface HealthScore {
  id: string;
  score: number;
  technical_score: number;
  onpage_score: number;
  keyword_score: number;
  backlink_score: number;
  computed_at: string;
}

interface PageCrawlRow {
  page_id: string;
  http_status: number | null;
  broken_links: string[] | null;
  redirect_chain: unknown[] | null;
  alt_text_missing: number | null;
  meta_description: string | null;
  h1: string | null;
  title_tag: string | null;
}

interface PageRow {
  id: string;
  url: string;
  indexable: boolean | null;
}

interface GscRow {
  url: string;
  clicks: number;
}

interface KeywordRow {
  status: string | null;
  current_position: number | null;
}

interface BacklinkRow {
  status: string;
  domain_authority: number | null;
  lost_at: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Clamps a numeric value to [0, 100] and rounds to the nearest integer.
 *
 * Validates: Requirements 10.1
 */
export function clampScore(value: number): number {
  return Math.round(Math.min(100, Math.max(0, value)));
}

// ── Score calculators ─────────────────────────────────────────────────────────

async function computeTechnicalScore(): Promise<number> {
  const { data: crawlRows, error: crawlError } = await supabaseAdmin
    .from('page_crawl_results')
    .select('page_id, http_status, broken_links, redirect_chain');

  if (crawlError) {
    throw new Error(`Failed to fetch page_crawl_results: ${crawlError.message}`);
  }

  const rows = (crawlRows ?? []) as PageCrawlRow[];

  // Build set of page_ids that have GSC traffic (clicks > 0)
  const { data: gscRows, error: gscError } = await supabaseAdmin
    .from('gsc_data_points')
    .select('url, clicks')
    .gt('clicks', 0);

  if (gscError) {
    throw new Error(`Failed to fetch gsc_data_points: ${gscError.message}`);
  }

  const gscUrls = new Set<string>(
    ((gscRows ?? []) as GscRow[]).map((r) => r.url),
  );

  // Fetch pages to map page_id → url and indexable
  const { data: pageRows, error: pageError } = await supabaseAdmin
    .from('pages')
    .select('id, url, indexable');

  if (pageError) {
    throw new Error(`Failed to fetch pages: ${pageError.message}`);
  }

  const pageMap = new Map<string, PageRow>(
    ((pageRows ?? []) as PageRow[]).map((p) => [p.id, p]),
  );

  let score = 100;

  for (const row of rows) {
    // -10 for each page with http_status >= 400
    if (row.http_status != null && row.http_status >= 400) {
      score -= 10;
    }

    // -5 for each page with broken_links count > 0
    if (Array.isArray(row.broken_links) && row.broken_links.length > 0) {
      score -= 5;
    }

    // -5 for each page with redirect_chain length > 2
    if (Array.isArray(row.redirect_chain) && row.redirect_chain.length > 2) {
      score -= 5;
    }

    // -10 for each page with indexable=false that has GSC traffic
    const page = pageMap.get(row.page_id);
    if (page && page.indexable === false && gscUrls.has(page.url)) {
      score -= 10;
    }
  }

  return clampScore(score);
}

async function computeOnpageScore(): Promise<number> {
  const { data: crawlRows, error } = await supabaseAdmin
    .from('page_crawl_results')
    .select('meta_description, h1, alt_text_missing, title_tag');

  if (error) {
    throw new Error(`Failed to fetch page_crawl_results: ${error.message}`);
  }

  const rows = (crawlRows ?? []) as PageCrawlRow[];

  let score = 100;

  for (const row of rows) {
    // -5 for each page missing meta_description
    if (!row.meta_description) {
      score -= 5;
    }

    // -5 for each page missing H1
    if (!row.h1) {
      score -= 5;
    }

    // -3 for each page with alt_text_missing > 0
    if (row.alt_text_missing != null && row.alt_text_missing > 0) {
      score -= 3;
    }

    // -5 for each page with title_tag length > 60
    if (row.title_tag != null && row.title_tag.length > 60) {
      score -= 5;
    }
  }

  return clampScore(score);
}

async function computeKeywordScore(): Promise<number> {
  const { data: keywordRows, error } = await supabaseAdmin
    .from('keywords')
    .select('status, current_position');

  if (error) {
    throw new Error(`Failed to fetch keywords: ${error.message}`);
  }

  const rows = (keywordRows ?? []) as KeywordRow[];

  let score = 100;

  for (const row of rows) {
    // -2 for each keyword with status='unranked_opportunity'
    if (row.status === 'unranked_opportunity') {
      score -= 2;
    }

    // +2 for each keyword with current_position <= 10 (top 10)
    if (row.current_position != null && row.current_position <= 10) {
      score += 2;
    }
  }

  return clampScore(score);
}

async function computeBacklinkScore(): Promise<number> {
  const { data: backlinkRows, error } = await supabaseAdmin
    .from('backlinks')
    .select('status, domain_authority, lost_at');

  if (error) {
    throw new Error(`Failed to fetch backlinks: ${error.message}`);
  }

  const rows = (backlinkRows ?? []) as BacklinkRow[];

  let score = 50; // baseline

  let activeBonus = 0;

  for (const row of rows) {
    // +5 for each active backlink (up to +50 max)
    if (row.status === 'active') {
      if (activeBonus < 50) {
        activeBonus += 5;
      }
    }

    // -10 for each lost backlink with domain_authority >= 40
    if (row.status === 'lost' && row.domain_authority != null && row.domain_authority >= 40) {
      score -= 10;
    }
  }

  score += activeBonus;

  return clampScore(score);
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Computes a composite SEO health score (0–100) from four component scores
 * and persists the result to the health_scores table.
 *
 * Validates: Requirements 10.1
 */
export async function calculateHealthScore(): Promise<HealthScore> {
  const [technical_score, onpage_score, keyword_score, backlink_score] = await Promise.all([
    computeTechnicalScore(),
    computeOnpageScore(),
    computeKeywordScore(),
    computeBacklinkScore(),
  ]);

  const score = Math.round(
    (technical_score + onpage_score + keyword_score + backlink_score) / 4,
  );

  const { data, error } = await supabaseAdmin
    .from('health_scores')
    .insert({
      score,
      technical_score,
      onpage_score,
      keyword_score,
      backlink_score,
    })
    .select('id, score, technical_score, onpage_score, keyword_score, backlink_score, computed_at')
    .single();

  if (error) {
    throw new Error(`Failed to persist health score: ${error.message}`);
  }

  console.log(
    `[health-score-calculator] Computed health score: ${score} ` +
      `(technical=${technical_score}, onpage=${onpage_score}, ` +
      `keyword=${keyword_score}, backlink=${backlink_score})`,
  );

  return data as HealthScore;
}
