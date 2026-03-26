/**
 * PageSpeed Audit Worker — fetches Core Web Vitals via Google PageSpeed Insights API.
 * Validates: Requirements 4.1, 4.6
 */

import PgBoss from 'pg-boss';
import { supabaseAdmin } from '../lib/supabase';
import { createRecommendation } from '../agent/workflow/approval-queue';

const PAGESPEED_API_BASE = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
const DELAY_BETWEEN_PAGES_MS = 1500;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CwvRating = 'good' | 'needs_improvement' | 'poor';

interface PageSpeedAuditEntry {
  numericValue?: number;
}

interface PageSpeedLighthouseResult {
  audits?: {
    'largest-contentful-paint'?: PageSpeedAuditEntry;
    'interaction-to-next-paint'?: PageSpeedAuditEntry;
    'cumulative-layout-shift'?: PageSpeedAuditEntry;
  };
}

interface PageSpeedApiResponse {
  lighthouseResult?: PageSpeedLighthouseResult;
}

interface IndexablePage {
  id: string;
  url: string;
}

// ---------------------------------------------------------------------------
// Rating helpers
// ---------------------------------------------------------------------------

function rateLcp(ms: number): CwvRating {
  if (ms < 2500) return 'good';
  if (ms < 4000) return 'needs_improvement';
  return 'poor';
}

function rateInp(ms: number): CwvRating {
  if (ms < 200) return 'good';
  if (ms < 500) return 'needs_improvement';
  return 'poor';
}

function rateCls(score: number): CwvRating {
  if (score < 0.1) return 'good';
  if (score < 0.25) return 'needs_improvement';
  return 'poor';
}

// ---------------------------------------------------------------------------
// API call
// ---------------------------------------------------------------------------

async function fetchPageSpeedData(url: string): Promise<PageSpeedApiResponse> {
  const apiKey = process.env.PAGESPEED_API_KEY;
  const params = new URLSearchParams({ url, strategy: 'mobile' });
  if (apiKey) {
    params.set('key', apiKey);
  }

  const endpoint = `${PAGESPEED_API_BASE}?${params.toString()}`;
  const response = await fetch(endpoint, { signal: AbortSignal.timeout(60_000) });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`PageSpeed API error ${response.status}: ${body}`);
  }

  return response.json() as Promise<PageSpeedApiResponse>;
}

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function auditPage(page: IndexablePage): Promise<void> {
  console.log(`[pagespeed-audit] Auditing ${page.url}`);

  let data: PageSpeedApiResponse;
  try {
    data = await fetchPageSpeedData(page.url);
  } catch (err) {
    console.error(
      `[pagespeed-audit] Failed to fetch PageSpeed data for ${page.url}:`,
      err instanceof Error ? err.message : String(err),
    );
    return;
  }

  const audits = data.lighthouseResult?.audits;
  if (!audits) {
    console.warn(`[pagespeed-audit] No lighthouse audits returned for ${page.url}`);
    return;
  }

  const lcpMs = audits['largest-contentful-paint']?.numericValue ?? null;
  const inpMs = audits['interaction-to-next-paint']?.numericValue ?? null;
  const clsScore = audits['cumulative-layout-shift']?.numericValue ?? null;

  const lcpRating = lcpMs !== null ? rateLcp(lcpMs) : null;
  const inpRating = inpMs !== null ? rateInp(inpMs) : null;
  const clsRating = clsScore !== null ? rateCls(clsScore) : null;

  // Persist CWV results
  const { error: insertError } = await supabaseAdmin.from('cwv_results').insert({
    page_id: page.id,
    measured_at: new Date().toISOString(),
    lcp_ms: lcpMs !== null ? Math.round(lcpMs) : null,
    inp_ms: inpMs !== null ? Math.round(inpMs) : null,
    cls_score: clsScore,
    lcp_rating: lcpRating,
    inp_rating: inpRating,
    cls_rating: clsRating,
  });

  if (insertError) {
    console.error(
      `[pagespeed-audit] Failed to insert CWV results for ${page.url}: ${insertError.message}`,
    );
    return;
  }

  console.log(
    `[pagespeed-audit] Stored CWV for ${page.url} — ` +
      `LCP: ${lcpMs?.toFixed(0)}ms (${lcpRating}), ` +
      `INP: ${inpMs?.toFixed(0)}ms (${inpRating}), ` +
      `CLS: ${clsScore?.toFixed(4)} (${clsRating})`,
  );

  // Create recommendation if any metric exceeds threshold
  const poorMetrics: string[] = [];
  const details: Record<string, unknown> = {};

  if (lcpMs !== null && lcpMs > 2500) {
    poorMetrics.push(`LCP ${lcpMs.toFixed(0)}ms (${lcpRating})`);
    details.lcp_ms = Math.round(lcpMs);
    details.lcp_rating = lcpRating;
  }
  if (inpMs !== null && inpMs > 200) {
    poorMetrics.push(`INP ${inpMs.toFixed(0)}ms (${inpRating})`);
    details.inp_ms = Math.round(inpMs);
    details.inp_rating = inpRating;
  }
  if (clsScore !== null && clsScore > 0.1) {
    poorMetrics.push(`CLS ${clsScore.toFixed(4)} (${clsRating})`);
    details.cls_score = clsScore;
    details.cls_rating = clsRating;
  }

  if (poorMetrics.length > 0) {
    try {
      await createRecommendation({
        type: 'cwv_performance',
        pageId: page.id,
        currentState: details,
        proposedChange: {
          target_lcp_ms: 2500,
          target_inp_ms: 200,
          target_cls_score: 0.1,
        },
        reason: `Core Web Vitals need improvement on ${page.url}: ${poorMetrics.join(', ')}`,
        expectedImpact: 'Improving CWV scores can boost search rankings and user experience',
        priority: lcpRating === 'poor' || inpRating === 'poor' || clsRating === 'poor' ? 3 : 5,
      });
      console.log(`[pagespeed-audit] Created CWV recommendation for ${page.url}`);
    } catch (err) {
      console.error(
        `[pagespeed-audit] Failed to create recommendation for ${page.url}:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
}

async function runPageSpeedAudit(): Promise<void> {
  // Fetch all indexable pages (indexable = true OR indexable is null)
  const { data: pages, error: fetchError } = await supabaseAdmin
    .from('pages')
    .select('id, url')
    .or('indexable.eq.true,indexable.is.null');

  if (fetchError) {
    throw new Error(`Failed to fetch pages: ${fetchError.message}`);
  }

  if (!pages || pages.length === 0) {
    console.log('[pagespeed-audit] No indexable pages found.');
    return;
  }

  console.log(`[pagespeed-audit] Auditing ${pages.length} page(s).`);

  for (const page of pages as IndexablePage[]) {
    await auditPage(page);
    await sleep(DELAY_BETWEEN_PAGES_MS);
  }

  console.log('[pagespeed-audit] Audit run complete.');
}

// ---------------------------------------------------------------------------
// Worker registration
// ---------------------------------------------------------------------------

export async function registerPageSpeedAuditWorker(boss: PgBoss): Promise<void> {
  await boss.createQueue('pagespeed-audit');
  // Schedule weekly cron: every Monday at 03:00 UTC
  await boss.schedule('pagespeed-audit', '0 3 * * 1', {}, { tz: 'UTC' });

  await boss.work('pagespeed-audit', async (_job) => {
    try {
      await runPageSpeedAudit();
    } catch (err) {
      console.error(
        '[pagespeed-audit] Worker failed:',
        err instanceof Error ? err.message : String(err),
      );
      throw err;
    }
  });

  console.log('[pagespeed-audit] Worker registered (weekly cron: Mondays 03:00 UTC).');
}
