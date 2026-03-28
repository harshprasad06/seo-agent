/**
 * Internal Linker — scans blog post content and injects links to relevant
 * pages on the site based on keyword matches.
 *
 * Strategy:
 * 1. Build a link map: anchor text → URL from crawled pages + other blog posts
 * 2. Scan the MDX content for mentions of those anchor texts
 * 3. Inject markdown links for the first occurrence of each match
 * 4. Skip if already linked, skip frontmatter, skip headings
 */

import { supabaseAdmin } from '../../lib/supabase';

const SITE_URL = (process.env.SITE_URL ?? 'https://www.learnwealthx.in').replace(/\/$/, '');

interface LinkTarget {
  anchorText: string;
  url: string;
  priority: number; // higher = prefer this link
}

/** Build a map of anchor texts → URLs from crawled pages and blog posts */
async function buildLinkMap(): Promise<LinkTarget[]> {
  const targets: LinkTarget[] = [];

  // 1. Crawled pages (courses, about, etc.)
  const { data: pages } = await supabaseAdmin
    .from('pages')
    .select('url, title_tag, h1')
    .not('title_tag', 'is', null);

  for (const page of (pages ?? []) as any[]) {
    const url = page.url as string;
    // Skip homepage, login, signup, admin pages
    if (/\/(login|signup|sign-up|admin|auth|api|_next)/.test(url)) continue;

    const title = (page.h1 || page.title_tag || '').replace(/\s*[|\-–].*$/, '').trim();
    if (title.length < 4) continue;

    targets.push({ anchorText: title, url, priority: 2 });

    // Also add shorter keyword variants from the title
    const words = title.split(' ');
    if (words.length >= 3) {
      // Add 2-3 word phrases from the title
      for (let i = 0; i <= words.length - 2; i++) {
        const phrase = words.slice(i, i + 3).join(' ');
        if (phrase.length >= 8) {
          targets.push({ anchorText: phrase, url, priority: 1 });
        }
      }
    }
  }

  // 2. Other blog posts
  const { data: posts } = await supabaseAdmin
    .from('blog_posts')
    .select('slug, title, target_keyword')
    .eq('status', 'approved');

  for (const post of (posts ?? []) as any[]) {
    const url = `${SITE_URL}/blog/${post.slug}`;
    if (post.title) targets.push({ anchorText: post.title, url, priority: 3 });
    if (post.target_keyword) targets.push({ anchorText: post.target_keyword, url, priority: 3 });
  }

  // 3. Key site pages (hardcoded high-value targets)
  targets.push(
    { anchorText: 'online courses', url: `${SITE_URL}/courses`, priority: 4 },
    { anchorText: 'online course', url: `${SITE_URL}/courses`, priority: 4 },
    { anchorText: 'courses', url: `${SITE_URL}/courses`, priority: 3 },
    { anchorText: 'affiliate program', url: `${SITE_URL}/affiliate`, priority: 4 },
    { anchorText: 'affiliate', url: `${SITE_URL}/affiliate`, priority: 2 },
    { anchorText: 'earn commission', url: `${SITE_URL}/affiliate`, priority: 4 },
    { anchorText: '100% commission', url: `${SITE_URL}/affiliate`, priority: 4 },
  );

  // Sort by priority desc, then by anchor text length desc (prefer longer matches)
  return targets.sort((a, b) => b.priority - a.priority || b.anchorText.length - a.anchorText.length);
}

/** Inject internal links into MDX content */
export function injectLinks(content: string, targets: LinkTarget[]): { content: string; linksAdded: number } {
  // Split into frontmatter + body
  const frontmatterMatch = content.match(/^---[\s\S]*?---\n/);
  const frontmatter = frontmatterMatch ? frontmatterMatch[0] : '';
  let body = frontmatter ? content.slice(frontmatter.length) : content;

  const linkedUrls = new Set<string>(); // max 1 link per URL
  const linkedTexts = new Set<string>(); // avoid double-linking same text
  let linksAdded = 0;

  // Pre-scan for already-existing links to avoid duplicates
  const existingLinks = body.match(/\[([^\]]+)\]\([^)]+\)/g) ?? [];
  for (const link of existingLinks) {
    const urlMatch = link.match(/\]\(([^)]+)\)/);
    if (urlMatch) linkedUrls.add(urlMatch[1]);
  }

  for (const target of targets) {
    if (linkedUrls.has(target.url)) continue; // already linked to this URL
    if (linksAdded >= 5) break; // max 5 internal links per post

    const anchor = target.anchorText;
    if (anchor.length < 4) continue;

    // Escape special regex chars in anchor text
    const escaped = anchor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Match the anchor text NOT already inside a link, NOT in a heading, NOT in code
    // Use word boundary-aware matching, case-insensitive, first occurrence only
    const regex = new RegExp(
      `(?<!\\[)(?<!\\()\\b(${escaped})\\b(?!\\])(?!\\))`,
      'i'
    );

    const newBody = body.replace(regex, (match) => {
      if (linkedTexts.has(match.toLowerCase())) return match;
      linkedTexts.add(match.toLowerCase());
      linkedUrls.add(target.url);
      linksAdded++;
      return `[${match}](${target.url})`;
    });

    if (newBody !== body) {
      body = newBody;
    }
  }

  return { content: frontmatter + body, linksAdded };
}

/** Main entry point — add internal links to a blog post by ID */
export async function addInternalLinks(postId: string): Promise<number> {
  const { data: post, error } = await supabaseAdmin
    .from('blog_posts')
    .select('mdx_content, title, slug')
    .eq('id', postId)
    .single();

  if (error || !post) throw new Error(`Blog post not found: ${error?.message}`);

  const targets = await buildLinkMap();
  const { content: newContent, linksAdded } = injectLinks(post.mdx_content as string, targets);

  if (linksAdded === 0) {
    console.log(`[internal-linker] No links added to "${post.title}"`);
    return 0;
  }

  await supabaseAdmin
    .from('blog_posts')
    .update({ mdx_content: newContent, updated_at: new Date().toISOString() })
    .eq('id', postId);

  console.log(`[internal-linker] Added ${linksAdded} internal link(s) to "${post.title}"`);
  return linksAdded;
}
