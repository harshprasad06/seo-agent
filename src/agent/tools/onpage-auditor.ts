/**
 * On-Page Auditor — reads crawl results and creates AUTO_FIX / RECOMMENDATION records.
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 4.1
 */

import { supabaseAdmin } from '@/lib/supabase';
import { classifyAction } from '../workflow/risk-classifier';
import { executeAutoFix } from '../workflow/auto-fix-executor';
import { createRecommendation } from '../workflow/approval-queue';

const TITLE_TAG_MAX_LENGTH = 60;
const CRAWL_LOOKBACK_DAYS = 7;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PageCrawlRow {
  id: string;
  page_id: string;
  crawled_at: string;
  title_tag: string | null;
  meta_description: string | null;
  h1: string | null;
  alt_text_missing: number | null;
}

interface PageRow {
  id: string;
  url: string;
  primary_keyword_id: string | null;
}

// ---------------------------------------------------------------------------
// Audit a single crawl result
// ---------------------------------------------------------------------------

async function auditCrawlResult(
  crawl: PageCrawlRow,
  page: PageRow,
): Promise<void> {
  const { page_id, title_tag, meta_description, h1, alt_text_missing } = crawl;

  // 1. Title tag > 60 chars
  if (title_tag && title_tag.length > TITLE_TAG_MAX_LENGTH) {
    console.warn(
      `[onpage-auditor] Title tag too long (${title_tag.length} chars) on ${page.url}`,
    );
    // Title tag length is a warning — not an auto-fixable action in the risk table.
    // Log and continue; a missing meta description check follows.
  }

  // 2. Missing meta description → AUTO_FIX
  if (!meta_description || meta_description.trim() === '') {
    const actionType = 'add_missing_meta_description';
    const classification = classifyAction(actionType);

    if (classification === 'AUTO_FIX') {
      await executeAutoFix({
        actionType,
        pageId: page_id,
        beforeState: { meta_description: null, url: page.url },
        afterState: { meta_description: '[to be generated]', url: page.url },
      });
      console.log(`[onpage-auditor] AUTO_FIX queued: ${actionType} for ${page.url}`);
    }
  }

  // 3. Missing H1 → RECOMMENDATION
  if (!h1 || h1.trim() === '') {
    const actionType = 'change_h1_heading';
    const classification = classifyAction(actionType);

    if (classification === 'RECOMMENDATION') {
      await createRecommendation({
        type: actionType,
        pageId: page_id,
        currentState: { h1: null, url: page.url },
        proposedChange: { h1: '[to be determined]', url: page.url },
        reason: `Page "${page.url}" is missing an H1 heading, which is required for on-page SEO.`,
        expectedImpact: 'Improved keyword relevance signals and crawlability for this page.',
        priority: 3,
      });
      console.log(`[onpage-auditor] RECOMMENDATION created: ${actionType} for ${page.url}`);
    }
  }

  // 4. Missing alt text → AUTO_FIX (one per page)
  if (alt_text_missing && alt_text_missing > 0) {
    const actionType = 'add_missing_alt_text';
    const classification = classifyAction(actionType);

    if (classification === 'AUTO_FIX') {
      await executeAutoFix({
        actionType,
        pageId: page_id,
        beforeState: { alt_text_missing, url: page.url },
        afterState: { alt_text_missing: 0, url: page.url },
      });
      console.log(
        `[onpage-auditor] AUTO_FIX queued: ${actionType} (${alt_text_missing} image(s)) for ${page.url}`,
      );
    }
  }

  // 5. No primary keyword mapping — flag in console (manual for now)
  if (!page.primary_keyword_id) {
    console.warn(
      `[onpage-auditor] No primary keyword mapped for page "${page.url}" — keyword mapping is manual.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Audits on-page SEO for one page (by pageId) or all pages with recent crawl results.
 */
export async function runOnPageAudit(pageId?: string): Promise<void> {
  const since = new Date(
    Date.now() - CRAWL_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  let crawlQuery = supabaseAdmin
    .from('page_crawl_results')
    .select('id, page_id, crawled_at, title_tag, meta_description, h1, alt_text_missing')
    .gte('crawled_at', since)
    .order('crawled_at', { ascending: false });

  if (pageId) {
    // Latest crawl result for the given page
    crawlQuery = crawlQuery.eq('page_id', pageId).limit(1);
  }

  const { data: crawlRows, error: crawlError } = await crawlQuery;

  if (crawlError) {
    throw new Error(`Failed to fetch crawl results: ${crawlError.message}`);
  }

  if (!crawlRows || crawlRows.length === 0) {
    console.log('[onpage-auditor] No crawl results found to audit.');
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
    .select('id, url, primary_keyword_id')
    .in('id', pageIds);

  if (pagesError) {
    throw new Error(`Failed to fetch pages: ${pagesError.message}`);
  }

  const pageMap = new Map<string, PageRow>(
    (pages as PageRow[]).map((p) => [p.id, p]),
  );

  console.log(`[onpage-auditor] Auditing ${latestByPage.size} page(s)...`);

  for (const [pid, crawl] of Array.from(latestByPage.entries())) {
    const page = pageMap.get(pid);
    if (!page) {
      console.warn(`[onpage-auditor] Page record not found for page_id ${pid} — skipping`);
      continue;
    }
    try {
      await auditCrawlResult(crawl, page);
    } catch (err) {
      console.error(
        `[onpage-auditor] Error auditing page "${page.url}":`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  console.log('[onpage-auditor] Audit complete.');
}
