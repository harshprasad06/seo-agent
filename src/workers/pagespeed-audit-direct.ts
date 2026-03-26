/**
 * PageSpeed Audit Direct Worker — calls Google PageSpeed Insights API
 * for all crawled pages and saves CWV data to cwv_results table.
 */

import { supabaseAdmin } from '@/lib/supabase';
import { createRecommendation } from '@/agent/workflow/approval-queue';

const PAGESPEED_API_BASE = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
const DELAY_MS = 1500;

type CwvRating = 'good' | 'needs_improvement' | 'poor';

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

async function auditPage(page: { id: string; url: string }): Promise<void> {
  const apiKey = process.env.PAGESPEED_API_KEY;
  const params = new URLSearchParams({ url: page.url, strategy: 'mobile' });
  if (apiKey) params.set('key', apiKey);

  const res = await fetch(`${PAGESPEED_API_BASE}?${params}`, {
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`PageSpeed API ${res.status}: ${body.slice(0, 200)}`);
  }

  const json: any = await res.json();
  const audits = json?.lighthouseResult?.audits;
  if (!audits) return;

  const lcpMs: number | null = audits['largest-contentful-paint']?.numericValue ?? null;
  const inpMs: number | null = audits['interaction-to-next-paint']?.numericValue ?? null;
  const clsScore: number | null = audits['cumulative-layout-shift']?.numericValue ?? null;

  const lcpRating = lcpMs !== null ? rateLcp(lcpMs) : null;
  const inpRating = inpMs !== null ? rateInp(inpMs) : null;
  const clsRating = clsScore !== null ? rateCls(clsScore) : null;

  const { error } = await supabaseAdmin.from('cwv_results').insert({
    page_id: page.id,
    measured_at: new Date().toISOString(),
    lcp_ms: lcpMs !== null ? Math.round(lcpMs) : null,
    inp_ms: inpMs !== null ? Math.round(inpMs) : null,
    cls_score: clsScore,
    lcp_rating: lcpRating,
    inp_rating: inpRating,
    cls_rating: clsRating,
  });

  if (error) throw new Error(`Failed to save CWV for ${page.url}: ${error.message}`);

  // Create recommendation if any metric is poor/needs improvement
  const poorMetrics: string[] = [];
  const details: Record<string, unknown> = {};
  if (lcpMs !== null && lcpMs > 2500) { poorMetrics.push(`LCP ${Math.round(lcpMs)}ms (${lcpRating})`); details.lcp_ms = Math.round(lcpMs); details.lcp_rating = lcpRating; }
  if (inpMs !== null && inpMs > 200) { poorMetrics.push(`INP ${Math.round(inpMs)}ms (${inpRating})`); details.inp_ms = Math.round(inpMs); details.inp_rating = inpRating; }
  if (clsScore !== null && clsScore > 0.1) { poorMetrics.push(`CLS ${clsScore.toFixed(4)} (${clsRating})`); details.cls_score = clsScore; details.cls_rating = clsRating; }

  if (poorMetrics.length > 0) {
    await createRecommendation({
      type: 'cwv_performance',
      pageId: page.id,
      currentState: details,
      proposedChange: { target_lcp_ms: 2500, target_inp_ms: 200, target_cls_score: 0.1 },
      reason: `Core Web Vitals need improvement on ${page.url}: ${poorMetrics.join(', ')}`,
      expectedImpact: 'Improving CWV scores can boost search rankings and user experience',
      priority: lcpRating === 'poor' || inpRating === 'poor' || clsRating === 'poor' ? 3 : 5,
    });
  }

  console.log(`[pagespeed-direct] ${page.url} — LCP: ${lcpMs?.toFixed(0)}ms, INP: ${inpMs?.toFixed(0)}ms, CLS: ${clsScore?.toFixed(4)}`);
}

export async function runPageSpeedAuditDirect(): Promise<number> {
  const { data: pages, error } = await supabaseAdmin
    .from('pages')
    .select('id, url')
    .or('indexable.eq.true,indexable.is.null');

  if (error) throw new Error(`Failed to fetch pages: ${error.message}`);
  if (!pages || (pages as any[]).length === 0) return 0;

  let audited = 0;
  for (const page of pages as { id: string; url: string }[]) {
    try {
      await auditPage(page);
      audited++;
    } catch (err: any) {
      console.error(`[pagespeed-direct] Failed for ${page.url}: ${err.message}`);
    }
    await new Promise(r => setTimeout(r, DELAY_MS));
  }

  return audited;
}
