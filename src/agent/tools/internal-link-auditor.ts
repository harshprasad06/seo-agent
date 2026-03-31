/**
 * Internal Link Auditor — scans existing pages for internal linking opportunities.
 * Finds pages that mention keywords from other pages but don't link to them.
 * Creates recommendations for each opportunity.
 */

import { supabaseAdmin } from '../../lib/supabase';
import { createRecommendation } from '../workflow/approval-queue';

const SITE_URL = (process.env.SITE_URL ?? 'https://example.com').replace(/\/$/, '');

interface PageData {
  id: string;
  url: string;
  title_tag: string | null;
  h1: string | null;
}

function extractKeyPhrases(text: string): string[] {
  if (!text) return [];
  // Extract 2-4 word phrases from title/h1
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2);
  const phrases: string[] = [];
  for (let i = 0; i < words.length; i++) {
    if (i + 1 < words.length) phrases.push(`${words[i]} ${words[i+1]}`);
    if (i + 2 < words.length) phrases.push(`${words[i]} ${words[i+1]} ${words[i+2]}`);
  }
  return [...new Set(phrases)].filter(p => p.length >= 8);
}

async function fetchPageText(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': `SEOAgent/1.0 (+${SITE_URL})` },
    });
    if (!res.ok) return '';
    const html = await res.text();
    // Strip scripts, styles, nav, footer
    return html
      .replace(/<(script|style|nav|footer|header)[^>]*>[\s\S]*?<\/\1>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .toLowerCase()
      .slice(0, 10000);
  } catch {
    return '';
  }
}

export async function runInternalLinkAudit(): Promise<number> {
  // Get all crawled pages
  const { data: pages, error } = await supabaseAdmin
    .from('pages')
    .select('id, url, title_tag, h1')
    .not('last_crawled_at', 'is', null)
    .limit(30); // cap to avoid too many HTTP requests

  if (error || !pages || (pages as any[]).length === 0) return 0;

  const pageList = pages as PageData[];
  let recsCreated = 0;

  // Build link targets: each page's key phrases → its URL
  const linkTargets: Array<{ phrase: string; url: string; pageId: string; title: string }> = [];
  for (const page of pageList) {
    const text = `${page.title_tag ?? ''} ${page.h1 ?? ''}`;
    const phrases = extractKeyPhrases(text);
    for (const phrase of phrases.slice(0, 5)) {
      linkTargets.push({ phrase, url: page.url, pageId: page.id, title: page.title_tag ?? page.h1 ?? page.url });
    }
  }

  if (linkTargets.length === 0) return 0;

  // For each page, check if it mentions phrases from other pages without linking
  for (const sourcePage of pageList.slice(0, 10)) { // limit to 10 pages to avoid rate limits
    const pageText = await fetchPageText(sourcePage.url);
    if (!pageText) continue;

    // Find existing links in the page
    const existingLinks = new Set<string>();
    const linkMatches = pageText.match(/href=["']([^"']+)["']/g) ?? [];
    for (const m of linkMatches) {
      const url = m.replace(/href=["']/, '').replace(/["']$/, '');
      existingLinks.add(url);
    }

    const suggestionsForPage: Array<{ phrase: string; targetUrl: string; targetTitle: string }> = [];

    for (const target of linkTargets) {
      // Skip self-links
      if (target.pageId === sourcePage.id) continue;
      // Skip if already linked
      if (existingLinks.has(target.url) || pageText.includes(target.url)) continue;
      // Check if phrase appears in page text
      if (pageText.includes(target.phrase)) {
        suggestionsForPage.push({ phrase: target.phrase, targetUrl: target.url, targetTitle: target.title });
      }
    }

    // Deduplicate by target URL, take top 3
    const seen = new Set<string>();
    const unique = suggestionsForPage.filter(s => {
      if (seen.has(s.targetUrl)) return false;
      seen.add(s.targetUrl);
      return true;
    }).slice(0, 3);

    for (const suggestion of unique) {
      try {
        await createRecommendation({
          type: 'add_internal_link',
          pageId: sourcePage.id,
          currentState: { url: sourcePage.url, missing_link_to: suggestion.targetUrl },
          proposedChange: {
            anchor_text: suggestion.phrase,
            link_to: suggestion.targetUrl,
            link_title: suggestion.targetTitle,
          },
          reason: `Page mentions "${suggestion.phrase}" but doesn't link to ${suggestion.targetUrl} — add an internal link to improve site structure`,
          expectedImpact: 'Internal links distribute page authority and help Google understand site structure',
          priority: 6,
        });
        recsCreated++;
      } catch {}
    }

    // Small delay between page fetches
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`[internal-link-auditor] Created ${recsCreated} internal link recommendation(s)`);
  return recsCreated;
}
