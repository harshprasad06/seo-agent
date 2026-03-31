/**
 * Site Crawl Worker — Playwright-based crawler for full and single-page crawls.
 * Validates: Requirements 4.1
 */

import PgBoss from 'pg-boss';
// playwright is installed as a runtime dependency; types are bundled with the package
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { chromium } = require('playwright') as { chromium: { launch: (opts?: { headless?: boolean }) => Promise<PlaywrightBrowser> } };

// Minimal playwright type shims (avoids hard dependency on @playwright/test types)
interface PlaywrightBrowser {
  newContext(): Promise<PlaywrightContext>;
  close(): Promise<void>;
}
interface PlaywrightContext {
  newPage(): Promise<Page>;
  close(): Promise<void>;
}
interface Page {
  goto(url: string, opts?: { timeout?: number; waitUntil?: string }): Promise<Response | null>;
  evaluate<T, A>(fn: (arg: A) => T, arg: A): Promise<T>;
  evaluate<T>(fn: () => T): Promise<T>;
  on(event: string, handler: (r: Response) => void): void;
  off(event: string, handler: (r: Response) => void): void;
}
interface Response {
  url(): string;
  status(): number;
}
import { supabaseAdmin } from '../lib/supabase';

const SITE_URL = process.env.SITE_URL ?? 'https://example.com/';
const PAGE_TIMEOUT_MS = 30_000;
const MAX_BROKEN_LINK_CHECKS = 10;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CrawlResult {
  url: string;
  title_tag: string | null;
  meta_description: string | null;
  h1: string | null;
  h2_tags: string[];
  h3_tags: string[];
  alt_text_missing: number;
  canonical_url: string | null;
  http_status: number;
  redirect_chain: string[];
  structured_data: unknown[];
  internal_links: string[];
  broken_links: string[];
  word_count: number;
}

// ---------------------------------------------------------------------------
// robots.txt helpers
// ---------------------------------------------------------------------------

interface RobotsRules {
  disallowed: string[];
}

async function fetchRobotsTxt(siteUrl: string): Promise<RobotsRules> {
  try {
    const robotsUrl = new URL('/robots.txt', siteUrl).toString();
    const res = await fetch(robotsUrl, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return { disallowed: [] };
    const text = await res.text();
    const disallowed: string[] = [];
    let inUserAgentAll = false;
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (line.toLowerCase().startsWith('user-agent:')) {
        const agent = line.split(':')[1]?.trim();
        inUserAgentAll = agent === '*';
      } else if (inUserAgentAll && line.toLowerCase().startsWith('disallow:')) {
        const path = line.split(':')[1]?.trim();
        if (path) disallowed.push(path);
      }
    }
    return { disallowed };
  } catch {
    return { disallowed: [] };
  }
}

function isAllowed(url: string, rules: RobotsRules): boolean {
  try {
    const { pathname } = new URL(url);
    return !rules.disallowed.some(
      (d) => d !== '' && pathname.startsWith(d),
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Sitemap helpers
// ---------------------------------------------------------------------------

async function fetchSitemapUrls(siteUrl: string): Promise<string[]> {
  try {
    const sitemapUrl = `${siteUrl.replace(/\/$/, '')}/sitemap.xml`;
    const res = await fetch(sitemapUrl, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return [];
    const xml = await res.text();
    const matches = xml.match(/<loc>(.*?)<\/loc>/g) ?? [];
    return matches.map((m) => m.replace(/<\/?loc>/g, '').trim());
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Single-page crawl
// ---------------------------------------------------------------------------

async function crawlPage(
  page: Page,
  url: string,
  siteDomain: string,
): Promise<CrawlResult | null> {
  const redirectChain: string[] = [];
  let finalStatus = 200;

  const onResponse = (response: Response) => {
    const status = response.status();
    if (status >= 300 && status < 400) {
      redirectChain.push(response.url());
    }
    if (response.url() === url || redirectChain.includes(response.url())) {
      finalStatus = status;
    }
  };

  page.on('response', onResponse);

  try {
    const response = await page.goto(url, {
      timeout: PAGE_TIMEOUT_MS,
      waitUntil: 'domcontentloaded',
    });

    if (response) {
      finalStatus = response.status();
    }

    if (finalStatus !== 200) {
      console.warn(`[site-crawl] Non-200 status ${finalStatus} for ${url}`);
    }

    // Extract on-page data
    const data = await page.evaluate(() => {
      const title = document.title || null;

      const metaDesc =
        document
          .querySelector('meta[name="description"]')
          ?.getAttribute('content') ?? null;

      const h1El = document.querySelector('h1');
      const h1 = h1El?.textContent?.trim() ?? null;

      const h2Tags = Array.from(document.querySelectorAll('h2')).map(
        (el) => el.textContent?.trim() ?? '',
      );

      const h3Tags = Array.from(document.querySelectorAll('h3')).map(
        (el) => el.textContent?.trim() ?? '',
      );

      const imgs = document.querySelectorAll('img');
      let altMissing = 0;
      imgs.forEach((img) => {
        if (!img.hasAttribute('alt') || img.getAttribute('alt') === null) {
          altMissing++;
        }
      });

      const canonical =
        document
          .querySelector('link[rel="canonical"]')
          ?.getAttribute('href') ?? null;

      const jsonLdBlocks: unknown[] = [];
      document
        .querySelectorAll('script[type="application/ld+json"]')
        .forEach((el) => {
          try {
            jsonLdBlocks.push(JSON.parse(el.textContent ?? ''));
          } catch {
            // skip malformed JSON-LD
          }
        });

      const bodyText = document.body?.innerText ?? '';
      const wordCount = bodyText
        .split(/\s+/)
        .filter((w) => w.length > 0).length;

      return {
        title,
        metaDesc,
        h1,
        h2Tags,
        h3Tags,
        altMissing,
        canonical,
        jsonLdBlocks,
        wordCount,
      };
    });

    // Collect internal links
    const allLinks: string[] = await page.evaluate((domain: string) => {
      return Array.from(document.querySelectorAll('a[href]'))
        .map((a) => {
          try {
            return new URL((a as HTMLAnchorElement).href, location.href).toString();
          } catch {
            return null;
          }
        })
        .filter((href): href is string => {
          if (!href) return false;
          try {
            return new URL(href).hostname === domain;
          } catch {
            return false;
          }
        });
    }, siteDomain);

    const uniqueInternalLinks = Array.from(new Set(allLinks));

    // Check broken links (up to MAX_BROKEN_LINK_CHECKS)
    const brokenLinks: string[] = [];
    const linksToCheck = uniqueInternalLinks.slice(0, MAX_BROKEN_LINK_CHECKS);
    await Promise.all(
      linksToCheck.map(async (href) => {
        try {
          const r = await fetch(href, {
            method: 'HEAD',
            signal: AbortSignal.timeout(10_000),
          });
          if (r.status !== 200) brokenLinks.push(href);
        } catch {
          brokenLinks.push(href);
        }
      }),
    );

    return {
      url,
      title_tag: data.title,
      meta_description: data.metaDesc,
      h1: data.h1,
      h2_tags: data.h2Tags,
      h3_tags: data.h3Tags,
      alt_text_missing: data.altMissing,
      canonical_url: data.canonical,
      http_status: finalStatus,
      redirect_chain: redirectChain,
      structured_data: data.jsonLdBlocks,
      internal_links: uniqueInternalLinks,
      broken_links: brokenLinks,
      word_count: data.wordCount,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Timeout') || msg.includes('timeout')) {
      console.warn(`[site-crawl] Timeout crawling ${url} — skipping`);
      return null;
    }
    throw err;
  } finally {
    page.off('response', onResponse);
  }
}

// ---------------------------------------------------------------------------
// Persist helpers
// ---------------------------------------------------------------------------

async function persistCrawlResult(result: CrawlResult): Promise<void> {
  // Upsert into pages
  const { data: pageRow, error: pageError } = await supabaseAdmin
    .from('pages')
    .upsert(
      {
        url: result.url,
        title_tag: result.title_tag,
        meta_description: result.meta_description,
        h1: result.h1,
        canonical_url: result.canonical_url,
        http_status: result.http_status,
        last_crawled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'url' },
    )
    .select('id')
    .single();

  if (pageError || !pageRow) {
    throw new Error(`Failed to upsert page ${result.url}: ${pageError?.message}`);
  }

  const pageId = pageRow.id as string;

  // Insert into page_crawl_results
  const { error: crawlError } = await supabaseAdmin
    .from('page_crawl_results')
    .insert({
      page_id: pageId,
      crawled_at: new Date().toISOString(),
      title_tag: result.title_tag,
      meta_description: result.meta_description,
      h1: result.h1,
      h2_tags: result.h2_tags,
      h3_tags: result.h3_tags,
      alt_text_missing: result.alt_text_missing,
      canonical_url: result.canonical_url,
      http_status: result.http_status,
      redirect_chain: result.redirect_chain,
      structured_data: result.structured_data,
      internal_links: result.internal_links,
      broken_links: result.broken_links,
      word_count: result.word_count,
    });

  if (crawlError) {
    throw new Error(
      `Failed to insert crawl result for ${result.url}: ${crawlError.message}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Full site crawl
// ---------------------------------------------------------------------------

async function runFullSiteCrawl(): Promise<void> {
  const siteUrl = SITE_URL.endsWith('/') ? SITE_URL : `${SITE_URL}/`;
  const siteDomain = new URL(siteUrl).hostname;

  console.log(`[site-crawl] Starting full crawl of ${siteUrl}`);

  const robots = await fetchRobotsTxt(siteUrl);
  let urlsToVisit = await fetchSitemapUrls(siteUrl);

  if (urlsToVisit.length === 0) {
    console.warn('[site-crawl] Sitemap empty or not found — falling back to homepage');
    urlsToVisit = [siteUrl];
  }

  // Filter by robots.txt
  urlsToVisit = urlsToVisit.filter((u) => isAllowed(u, robots));

  console.log(`[site-crawl] Crawling ${urlsToVisit.length} URL(s)`);

  const browser = await chromium.launch({ headless: true });
  try {
    for (const url of urlsToVisit) {
      const context = await browser.newContext();
      const page = await context.newPage();
      try {
        const result = await crawlPage(page, url, siteDomain);
        if (result) {
          await persistCrawlResult(result);
          console.log(`[site-crawl] Crawled ${url} — status ${result.http_status}`);
        }
      } catch (err) {
        console.error(
          `[site-crawl] Error crawling ${url}:`,
          err instanceof Error ? err.message : String(err),
        );
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  console.log('[site-crawl] Full crawl complete.');
}

// ---------------------------------------------------------------------------
// Single-page crawl
// ---------------------------------------------------------------------------

async function runSinglePageCrawl(pageId: string): Promise<void> {
  const { data: pageRow, error } = await supabaseAdmin
    .from('pages')
    .select('url')
    .eq('id', pageId)
    .single();

  if (error || !pageRow) {
    throw new Error(`Page not found for id ${pageId}: ${error?.message}`);
  }

  const url = pageRow.url as string;
  const siteDomain = new URL(SITE_URL).hostname;

  console.log(`[site-crawl-single] Crawling single page: ${url}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    const result = await crawlPage(page, url, siteDomain);
    if (result) {
      await persistCrawlResult(result);
      console.log(`[site-crawl-single] Done — status ${result.http_status}`);
    }
  } finally {
    await context.close();
    await browser.close();
  }
}

// ---------------------------------------------------------------------------
// Worker registration
// ---------------------------------------------------------------------------

// Cron: every Sunday at 01:00 UTC (before keyword-tracker and pagespeed-audit)
const SITE_CRAWL_CRON = '0 1 * * 0';

export async function registerSiteCrawlWorker(boss: PgBoss): Promise<void> {
  await boss.createQueue('site-crawl');
  await boss.createQueue('site-crawl-single');
  await boss.schedule('site-crawl', SITE_CRAWL_CRON, {}, { tz: 'UTC' });

  // Full site crawl — weekly
  await boss.work('site-crawl', async (_job) => {
    try {
      await runFullSiteCrawl();
    } catch (err) {
      console.error(
        '[site-crawl] Worker failed:',
        err instanceof Error ? err.message : String(err),
      );
      throw err;
    }
  });

  // Single-page crawl — triggered after auto-fix
  await boss.work('site-crawl-single', async (job) => {
    const jobData = ((job as unknown) as PgBoss.Job<{ pageId?: string }>).data ?? {};
    const { pageId } = jobData;
    if (!pageId) {
      console.warn('[site-crawl-single] No pageId provided — skipping');
      return;
    }
    try {
      await runSinglePageCrawl(pageId);
    } catch (err) {
      console.error(
        '[site-crawl-single] Worker failed:',
        err instanceof Error ? err.message : String(err),
      );
      throw err;
    }
  });

  console.log('[site-crawl] Workers registered (site-crawl weekly Sundays 01:00 UTC, site-crawl-single on-demand).');
}
