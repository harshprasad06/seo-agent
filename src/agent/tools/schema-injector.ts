/**
 * Schema Injector — auto-generates and injects JSON-LD structured data
 * for pages that are missing it, via GitHub PR.
 *
 * Generates:
 * - WebPage schema for all pages
 * - Article schema for blog posts
 * - BreadcrumbList for nested pages
 * - Organization schema for homepage
 */

import { supabaseAdmin } from '../../lib/supabase';
import { createRecommendation } from '../workflow/approval-queue';

const SITE_URL = (process.env.SITE_URL ?? 'https://example.com').replace(/\/$/, '');
const SITE_NAME = process.env.SITE_NAME ?? 'Website';

function generateWebPageSchema(url: string, title: string, description: string): string {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: title,
    description,
    url,
    isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: SITE_URL },
  }, null, 2);
}

function generateArticleSchema(url: string, title: string, description: string, datePublished: string): string {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: title,
    description,
    url,
    datePublished,
    dateModified: datePublished,
    author: { '@type': 'Organization', name: SITE_NAME },
    publisher: { '@type': 'Organization', name: SITE_NAME, url: SITE_URL },
  }, null, 2);
}

function generateOrganizationSchema(): string {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE_NAME,
    url: SITE_URL,
    description: process.env.SITE_DESCRIPTION ?? '',
  }, null, 2);
}

export async function runSchemaAudit(): Promise<number> {
  // Get pages without structured data
  const { data: crawlResults, error } = await supabaseAdmin
    .from('page_crawl_results')
    .select('page_id, structured_data')
    .order('crawled_at', { ascending: false })
    .limit(50);

  if (error || !crawlResults) return 0;

  // Find pages with null/empty structured_data
  const pagesNeedingSchema = (crawlResults as any[]).filter(r => {
    const sd = r.structured_data;
    if (!sd) return true;
    // Check if it has actual schema (not just our has_viewport flag)
    const keys = Object.keys(sd);
    return keys.length === 0 || (keys.length === 1 && keys[0] === 'has_viewport');
  });

  if (pagesNeedingSchema.length === 0) return 0;

  // Get page details
  const pageIds = Array.from(new Set(pagesNeedingSchema.map((r: any) => r.page_id)));
  const { data: pages } = await supabaseAdmin
    .from('pages')
    .select('id, url, title_tag, meta_description, created_at')
    .in('id', pageIds);

  if (!pages) return 0;

  let recsCreated = 0;

  for (const page of pages as any[]) {
    const url = page.url as string;
    const title = page.title_tag ?? SITE_NAME;
    const description = page.meta_description ?? '';

    let schema: string;
    let schemaType: string;

    if (url === SITE_URL || url === `${SITE_URL}/`) {
      // Homepage — Organization schema
      schema = generateOrganizationSchema();
      schemaType = 'Organization';
    } else if (url.includes('/blog/')) {
      // Blog post — Article schema
      schema = generateArticleSchema(url, title, description, new Date(page.created_at).toISOString().split('T')[0]);
      schemaType = 'Article';
    } else {
      // Other pages — WebPage schema
      schema = generateWebPageSchema(url, title, description);
      schemaType = 'WebPage';
    }

    try {
      await createRecommendation({
        type: 'add_structured_data',
        pageId: page.id,
        currentState: { url, has_schema: false },
        proposedChange: {
          schema_type: schemaType,
          json_ld: schema,
          inject_in: '<head> tag as <script type="application/ld+json">',
        },
        reason: `Page ${url} is missing ${schemaType} structured data — adding JSON-LD helps Google understand the page content`,
        expectedImpact: 'Structured data can enable rich results in Google Search (star ratings, breadcrumbs, article dates)',
        priority: 5,
      });
      recsCreated++;
    } catch {}
  }

  console.log(`[schema-injector] Created ${recsCreated} structured data recommendation(s)`);
  return recsCreated;
}
