/**
 * Direct site crawl — runs without pg-boss, called from /api/agent/run.
 * Fetches sitemap, crawls each page with fetch (no Playwright needed for basic audit),
 * persists results, and runs the on-page auditor.
 */

import { supabaseAdmin } from '@/lib/supabase';
import { runOnPageAudit } from '@/agent/tools/onpage-auditor';

const SITE_URL = (process.env.SITE_URL ?? 'https://www.learnwealthx.in/').replace(/\/$/, '');

interface BasicCrawlResult {
  url: string;
  title_tag: string | null;
  meta_description: string | null;
  h1: string | null;
  http_status: number;
  word_count: number;
  alt_text_missing: number;
  canonical_url: string | null;
  has_viewport: boolean;
}

async function fetchSitemapUrls(): Promise<string[]> {
  try {
    const res = await fetch(`${SITE_URL}/sitemap.xml`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return [SITE_URL];
    const xml = await res.text();
    const matches = xml.match(/<loc>(.*?)<\/loc>/g) ?? [];
    const urls = matches.map(m => m.replace(/<\/?loc>/g, '').trim()).filter(u => u.startsWith('http'));
    return urls.length > 0 ? urls.slice(0, 50) : [SITE_URL]; // cap at 50 pages
  } catch {
    return [SITE_URL];
  }
}

function extractMeta(html: string): BasicCrawlResult['title_tag' | 'meta_description' | 'h1' | 'canonical_url'] {
  return null; // placeholder — real extraction below
}

async function crawlPageBasic(url: string): Promise<BasicCrawlResult | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': `SEOAgent/1.0 (+${process.env.SITE_URL ?? 'https://example.com'})` },
    });
    const html = await res.text();

    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : null;

    const metaMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i)
      ?? html.match(/<meta[^>]+content=["']([^"']*)[^>]+name=["']description["']/i);
    const metaDesc = metaMatch ? metaMatch[1].trim() : null;

    const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    const h1 = h1Match ? h1Match[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : null;

    const canonicalMatch = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']*)/i)
      ?? html.match(/<link[^>]+href=["']([^"']*)[^>]+rel=["']canonical["']/i);
    const canonical = canonicalMatch ? canonicalMatch[1].trim() : null;

    const imgMatches = html.match(/<img[^>]+>/gi) ?? [];
    const altMissing = imgMatches.filter(img => !img.match(/alt=["'][^"']/i)).length;

    // Mobile usability: check for viewport meta tag
    const hasViewport = /<meta[^>]+name=["']viewport["']/i.test(html);

    const textContent = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const wordCount = textContent.split(' ').filter(w => w.length > 2).length;

    return { url, title_tag: title, meta_description: metaDesc, h1, http_status: res.status, word_count: wordCount, alt_text_missing: altMissing, canonical_url: canonical, has_viewport: hasViewport };
  } catch (e: any) {
    console.warn(`[site-crawl-direct] Failed to crawl ${url}: ${e.message}`);
    return null;
  }
}

async function persistResult(result: BasicCrawlResult): Promise<string | null> {
  const { data: pageRow, error } = await supabaseAdmin
    .from('pages')
    .upsert({
      url: result.url,
      title_tag: result.title_tag,
      meta_description: result.meta_description,
      h1: result.h1,
      canonical_url: result.canonical_url,
      http_status: result.http_status,
      last_crawled_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'url' })
    .select('id')
    .single();

  if (error || !pageRow) return null;
  const pageId = (pageRow as any).id as string;

  await supabaseAdmin.from('page_crawl_results').insert({
    page_id: pageId,
    title_tag: result.title_tag,
    meta_description: result.meta_description,
    h1: result.h1,
    http_status: result.http_status,
    word_count: result.word_count,
    alt_text_missing: result.alt_text_missing,
    canonical_url: result.canonical_url,
    structured_data: { has_viewport: result.has_viewport },
    h2_tags: [],
    h3_tags: [],
    internal_links: [],
    broken_links: [],
  });

  return pageId;
}

export async function runFullSiteCrawlDirect(): Promise<{ pagesFound: number; recommendations: number }> {
  const urls = await fetchSitemapUrls();
  console.log(`[site-crawl-direct] Crawling ${urls.length} URL(s) from sitemap`);

  let pagesFound = 0;

  for (const url of urls) {
    const result = await crawlPageBasic(url);
    if (!result) continue;
    await persistResult(result);
    pagesFound++;
  }

  // Run on-page audit to generate recommendations
  await runOnPageAudit();

  // Check for mobile usability issues (missing viewport)
  const { data: allPages } = await supabaseAdmin.from('pages').select('id, url');
  for (const page of (allPages ?? []) as any[]) {
    // We stored has_viewport in page_crawl_results — check latest
    const { data: crawlResult } = await supabaseAdmin
      .from('page_crawl_results')
      .select('structured_data')
      .eq('page_id', page.id)
      .order('crawled_at', { ascending: false })
      .limit(1)
      .single();
    // has_viewport is stored in structured_data.has_viewport
    const hasViewport = (crawlResult as any)?.structured_data?.has_viewport;
    if (hasViewport === false) {
      try {
        const { createRecommendation } = await import('@/agent/workflow/approval-queue');
        await createRecommendation({
          type: 'fix_mobile_viewport',
          pageId: page.id,
          currentState: { url: page.url, has_viewport: false },
          proposedChange: { add_meta: '<meta name="viewport" content="width=device-width, initial-scale=1">' },
          reason: `Page ${page.url} is missing the viewport meta tag — it will not render correctly on mobile devices`,
          expectedImpact: 'Mobile-friendly pages rank higher in Google mobile search',
          priority: 2,
        });
      } catch {}
    }
  }

  // Count recommendations created
  const { data: recs } = await supabaseAdmin
    .from('recommendations')
    .select('id')
    .eq('status', 'pending');

  return { pagesFound, recommendations: (recs as any[])?.length ?? 0 };
}
