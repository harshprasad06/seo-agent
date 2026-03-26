/**
 * Structured Data Validator — validates JSON-LD blocks from crawl results
 * against Schema.org specs and flags missing/invalid structured data.
 * Validates: Requirements 4.5
 */

import { supabaseAdmin } from '@/lib/supabase';
import { createRecommendation } from '../workflow/approval-queue';

const CRAWL_LOOKBACK_HOURS = 1;
const WORD_COUNT_THRESHOLD = 300;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface JsonLdBlock {
  '@context'?: unknown;
  '@type'?: unknown;
  [key: string]: unknown;
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
}

interface PageCrawlRow {
  page_id: string;
  crawled_at: string;
  structured_data: unknown;
  word_count: number | null;
}

interface PageRow {
  id: string;
  url: string;
}

// ---------------------------------------------------------------------------
// Required fields per Schema.org type
// ---------------------------------------------------------------------------

const REQUIRED_FIELDS: Record<string, string[]> = {
  Article: ['headline', 'author', 'datePublished'],
  Product: ['name', 'offers'],
  FAQPage: ['mainEntity'],
  BreadcrumbList: ['itemListElement'],
  Organization: ['name', 'url'],
  WebSite: ['name', 'url'],
  LocalBusiness: ['name', 'address'],
};

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function hasSchemaOrgContext(block: JsonLdBlock): boolean {
  const ctx = block['@context'];
  if (typeof ctx === 'string') {
    return ctx.includes('schema.org');
  }
  if (Array.isArray(ctx)) {
    return ctx.some((c) => typeof c === 'string' && c.includes('schema.org'));
  }
  return false;
}

function validateBlock(block: JsonLdBlock): ValidationResult {
  const errors: string[] = [];

  if (!hasSchemaOrgContext(block)) {
    errors.push('Missing or invalid @context (must contain "schema.org")');
  }

  const type = block['@type'];
  if (!type) {
    errors.push('Missing @type field');
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  // Resolve type string (handle arrays like ["Product", "Thing"])
  const typeStr = Array.isArray(type) ? (type[0] as string) : (type as string);
  const requiredFields = REQUIRED_FIELDS[typeStr];

  if (requiredFields) {
    for (const field of requiredFields) {
      const value = block[field];
      if (value === undefined || value === null) {
        errors.push(`Missing required field "${field}" for type "${typeStr}"`);
      } else if (
        (field === 'mainEntity' || field === 'itemListElement') &&
        (!Array.isArray(value) || (value as unknown[]).length === 0)
      ) {
        errors.push(`"${field}" must be a non-empty array for type "${typeStr}"`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Per-page validation logic
// ---------------------------------------------------------------------------

async function validatePage(crawl: PageCrawlRow, page: PageRow): Promise<void> {
  const { page_id, structured_data, word_count } = crawl;
  const { url } = page;

  // Case 1: No structured data at all
  if (
    structured_data === null ||
    structured_data === undefined ||
    (Array.isArray(structured_data) && (structured_data as unknown[]).length === 0)
  ) {
    const wc = word_count ?? 0;
    if (wc > WORD_COUNT_THRESHOLD) {
      await createRecommendation({
        type: 'fix_structured_data',
        pageId: page_id,
        currentState: { structured_data: null, word_count: wc, url },
        proposedChange: {
          structured_data: 'Add appropriate JSON-LD structured data (e.g. Article, WebPage)',
          url,
        },
        reason: `Page "${url}" has ${wc} words but no structured data. Adding JSON-LD markup helps search engines understand the content and enables rich results.`,
        expectedImpact: 'Structured data can unlock rich snippets and improve click-through rates.',
        priority: 4,
      });
      console.log(`[structured-data-validator] RECOMMENDATION (priority=4): missing structured data on "${url}" (word_count=${wc})`);
    }
    return;
  }

  // Case 2: Validate each JSON-LD block
  const blocks = Array.isArray(structured_data)
    ? (structured_data as JsonLdBlock[])
    : [structured_data as JsonLdBlock];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const result = validateBlock(block);

    if (!result.valid) {
      const typeLabel = block['@type'] ? String(block['@type']) : 'unknown';
      const errorSummary = result.errors.join('; ');

      await createRecommendation({
        type: 'fix_structured_data',
        pageId: page_id,
        currentState: { block_index: i, type: typeLabel, errors: result.errors, url },
        proposedChange: {
          action: `Fix JSON-LD block #${i} (type: ${typeLabel}): ${errorSummary}`,
          url,
        },
        reason: `Page "${url}" has an invalid JSON-LD block (type: ${typeLabel}). Issues: ${errorSummary}.`,
        expectedImpact: 'Valid structured data enables rich results and improves search visibility.',
        priority: 4,
      });
      console.log(`[structured-data-validator] RECOMMENDATION (priority=4): invalid JSON-LD block #${i} (${typeLabel}) on "${url}" — ${errorSummary}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Runs structured data validation for one page (by pageId) or all pages
 * with crawl results from the last hour.
 */
export async function runStructuredDataValidation(pageId?: string): Promise<void> {
  const since = new Date(
    Date.now() - CRAWL_LOOKBACK_HOURS * 60 * 60 * 1000,
  ).toISOString();

  let crawlQuery = supabaseAdmin
    .from('page_crawl_results')
    .select('page_id, crawled_at, structured_data, word_count')
    .gte('crawled_at', since)
    .order('crawled_at', { ascending: false });

  if (pageId) {
    crawlQuery = crawlQuery.eq('page_id', pageId).limit(1);
  }

  const { data: crawlRows, error: crawlError } = await crawlQuery;

  if (crawlError) {
    throw new Error(`Failed to fetch crawl results: ${crawlError.message}`);
  }

  if (!crawlRows || crawlRows.length === 0) {
    console.log('[structured-data-validator] No crawl results found to validate.');
    return;
  }

  // Deduplicate: keep only the latest crawl per page
  const latestByPage = new Map<string, PageCrawlRow>();
  for (const row of crawlRows as PageCrawlRow[]) {
    if (!latestByPage.has(row.page_id)) {
      latestByPage.set(row.page_id, row);
    }
  }

  const pageIds = Array.from(latestByPage.keys());

  const { data: pages, error: pagesError } = await supabaseAdmin
    .from('pages')
    .select('id, url')
    .in('id', pageIds);

  if (pagesError) {
    throw new Error(`Failed to fetch pages: ${pagesError.message}`);
  }

  const pageMap = new Map<string, PageRow>(
    (pages as PageRow[]).map((p) => [p.id, p]),
  );

  console.log(`[structured-data-validator] Validating ${latestByPage.size} page(s)...`);

  for (const [pid, crawl] of Array.from(latestByPage.entries())) {
    const page = pageMap.get(pid);
    if (!page) {
      console.warn(`[structured-data-validator] Page record not found for page_id ${pid} — skipping`);
      continue;
    }

    try {
      await validatePage(crawl, page);
    } catch (err) {
      console.error(
        `[structured-data-validator] Error validating page "${page.url}":`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  console.log('[structured-data-validator] Validation complete.');
}
