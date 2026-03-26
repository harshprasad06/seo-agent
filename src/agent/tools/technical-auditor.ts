/**
 * Technical Auditor — aggregates crawl results and CWV data to surface
 * technical SEO issues as AUTO_FIX or RECOMMENDATION records.
 * Validates: Requirements 4.2, 4.3, 4.4
 */

import { supabaseAdmin } from '@/lib/supabase';
import { classifyAction } from '../workflow/risk-classifier';
import { executeAutoFix } from '../workflow/auto-fix-executor';
import { createRecommendation } from '../workflow/approval-queue';

const CRAWL_LOOKBACK_HOURS = 1;
const REDIRECT_CHAIN_MAX_LENGTH = 2;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PageCrawlRow {
  id: string;
  page_id: string;
  crawled_at: string;
  http_status: number | null;
  broken_links: string[] | null;
  redirect_chain: unknown[] | null;
  structured_data: unknown | null;
  canonical_url: string | null;
}

interface PageRow {
  id: string;
  url: string;
  indexable: boolean | null;
  canonical_url: string | null;
}

interface CwvRow {
  page_id: string;
  lcp_rating: string | null;
  inp_rating: string | null;
  cls_rating: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns true if the page has GSC traffic (clicks > 0). */
async function hasGscTraffic(url: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('gsc_data_points')
    .select('clicks')
    .eq('url', url)
    .gt('clicks', 0)
    .limit(1);

  if (error) {
    console.warn(`[technical-auditor] Could not check GSC traffic for ${url}: ${error.message}`);
    return false;
  }

  return (data?.length ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Per-page audit logic
// ---------------------------------------------------------------------------

async function auditPage(crawl: PageCrawlRow, page: PageRow): Promise<void> {
  const { page_id, http_status, broken_links, redirect_chain, canonical_url: crawlCanonical } = crawl;
  const { url, indexable, canonical_url: pageCanonical } = page;

  // 1. 5xx server errors → RECOMMENDATION priority=1
  if (http_status !== null && http_status >= 500 && http_status < 600) {
    await createRecommendation({
      type: 'fix_server_error',
      pageId: page_id,
      currentState: { http_status, url },
      proposedChange: { http_status: 200, url },
      reason: `Page "${url}" returned HTTP ${http_status}. Server errors prevent indexing and degrade user experience.`,
      expectedImpact: 'Restoring the page will recover lost traffic and indexing.',
      priority: 1,
    });
    console.log(`[technical-auditor] RECOMMENDATION (priority=1) created: fix_server_error for ${url}`);
  }

  // 2. Noindex on pages with GSC traffic → RECOMMENDATION priority=1
  if (indexable === false) {
    const hasTraffic = await hasGscTraffic(url);
    if (hasTraffic) {
      await createRecommendation({
        type: 'fix_noindex',
        pageId: page_id,
        currentState: { indexable: false, url },
        proposedChange: { indexable: true, url },
        reason: `Page "${url}" is marked noindex but has recorded GSC clicks. Removing noindex will restore organic visibility.`,
        expectedImpact: 'Recovering indexed status for a page with existing traffic.',
        priority: 1,
      });
      console.log(`[technical-auditor] RECOMMENDATION (priority=1) created: fix_noindex for ${url}`);
    }
  }

  // 3. Broken internal links → AUTO_FIX
  if (broken_links && broken_links.length > 0) {
    const actionType = 'fix_broken_internal_link';
    const classification = classifyAction(actionType);

    if (classification === 'AUTO_FIX') {
      await executeAutoFix({
        actionType,
        pageId: page_id,
        beforeState: { broken_links, url },
        afterState: { broken_links: [], url },
      });
      console.log(
        `[technical-auditor] AUTO_FIX queued: ${actionType} (${broken_links.length} link(s)) for ${url}`,
      );
    }
  }

  // 4. Redirect chains longer than 2 hops → AUTO_FIX
  if (redirect_chain && redirect_chain.length > REDIRECT_CHAIN_MAX_LENGTH) {
    const actionType = 'correct_redirect_chain';
    const classification = classifyAction(actionType);

    if (classification === 'AUTO_FIX') {
      await executeAutoFix({
        actionType,
        pageId: page_id,
        beforeState: { redirect_chain, url },
        afterState: { redirect_chain: [redirect_chain[redirect_chain.length - 1]], url },
      });
      console.log(
        `[technical-auditor] AUTO_FIX queued: ${actionType} (chain length ${redirect_chain.length}) for ${url}`,
      );
    }
  }

  // 5. Canonical mismatch (canonical differs from URL and no redirect) → RECOMMENDATION
  const effectiveCanonical = crawlCanonical ?? pageCanonical;
  const hasRedirect = redirect_chain && redirect_chain.length > 0;

  if (effectiveCanonical && effectiveCanonical !== url && !hasRedirect) {
    const actionType = 'change_canonical_tag';
    const classification = classifyAction(actionType);

    if (classification === 'RECOMMENDATION') {
      await createRecommendation({
        type: actionType,
        pageId: page_id,
        currentState: { canonical_url: effectiveCanonical, url },
        proposedChange: { canonical_url: url, url },
        reason: `Page "${url}" has a canonical tag pointing to "${effectiveCanonical}" with no redirect in place. This may cause indexing confusion.`,
        expectedImpact: 'Aligning the canonical tag with the page URL consolidates ranking signals.',
        priority: 3,
      });
      console.log(`[technical-auditor] RECOMMENDATION created: ${actionType} for ${url}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Runs the technical audit for one page (by pageId) or all pages with
 * crawl results from the last hour.
 */
export async function runTechnicalAudit(pageId?: string): Promise<void> {
  const since = new Date(
    Date.now() - CRAWL_LOOKBACK_HOURS * 60 * 60 * 1000,
  ).toISOString();

  let crawlQuery = supabaseAdmin
    .from('page_crawl_results')
    .select('id, page_id, crawled_at, http_status, broken_links, redirect_chain, structured_data, canonical_url')
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
    console.log('[technical-auditor] No crawl results found to audit.');
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

  // Fetch page records
  const { data: pages, error: pagesError } = await supabaseAdmin
    .from('pages')
    .select('id, url, indexable, canonical_url')
    .in('id', pageIds);

  if (pagesError) {
    throw new Error(`Failed to fetch pages: ${pagesError.message}`);
  }

  const pageMap = new Map<string, PageRow>(
    (pages as PageRow[]).map((p) => [p.id, p]),
  );

  // Fetch latest CWV results (for future use / logging)
  const { data: cwvRows } = await supabaseAdmin
    .from('cwv_results')
    .select('page_id, lcp_rating, inp_rating, cls_rating')
    .in('page_id', pageIds)
    .order('measured_at', { ascending: false });

  const cwvMap = new Map<string, CwvRow>();
  if (cwvRows) {
    for (const row of cwvRows as CwvRow[]) {
      if (!cwvMap.has(row.page_id)) {
        cwvMap.set(row.page_id, row);
      }
    }
  }

  console.log(`[technical-auditor] Auditing ${latestByPage.size} page(s)...`);

  for (const [pid, crawl] of Array.from(latestByPage.entries())) {
    const page = pageMap.get(pid);
    if (!page) {
      console.warn(`[technical-auditor] Page record not found for page_id ${pid} — skipping`);
      continue;
    }

    const cwv = cwvMap.get(pid);
    if (cwv) {
      const poorMetrics = [cwv.lcp_rating, cwv.inp_rating, cwv.cls_rating].filter(
        (r) => r === 'poor',
      );
      if (poorMetrics.length > 0) {
        console.log(
          `[technical-auditor] CWV poor ratings on ${page.url}: ${poorMetrics.join(', ')}`,
        );
      }
    }

    try {
      await auditPage(crawl, page);
    } catch (err) {
      console.error(
        `[technical-auditor] Error auditing page "${page.url}":`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  console.log('[technical-auditor] Audit complete.');
}
