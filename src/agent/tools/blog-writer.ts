/**
 * Blog Post Writer — auto-generates blog post drafts using Gemini,
 * saves them to the blog_posts table, and publishes approved posts via GitHub PR.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import Groq from 'groq-sdk';
import { createPullRequest } from '@/lib/github';
import { supabaseAdmin } from '@/lib/supabase';

const genAI = new GoogleGenerativeAI(
  process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GEMINI_API_KEY ?? '',
);

const SITE_NAME = 'LearnWealthX';
const SITE_DOMAIN = 'learnwealthx.in';

// Gemini models to try in order
const GEMINI_MODELS = ['gemini-2.0-flash-lite', 'gemini-1.5-flash-8b', 'gemini-1.5-flash'];

async function generateWithFallback(prompt: string): Promise<string> {
  // Try Gemini models first
  for (const modelName of GEMINI_MODELS) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(prompt);
      return result.response.text();
    } catch (err: any) {
      const isQuota = err?.message?.includes('429') || err?.message?.includes('quota') || err?.message?.includes('RESOURCE_EXHAUSTED');
      const isNotFound = err?.message?.includes('404') || err?.message?.includes('not found');
      if (isQuota || isNotFound) {
        console.warn(`[blog-writer] Gemini ${modelName} unavailable, trying next…`);
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }
      throw err;
    }
  }

  // Fallback to Groq (llama3 — free tier, generous limits)
  console.warn('[blog-writer] All Gemini models exhausted, falling back to Groq…');
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  const completion = await groq.chat.completions.create({
    model: 'llama-3.1-8b-instant',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7,
    max_tokens: 4096,
  });
  return completion.choices[0]?.message?.content ?? '';
}

/** Converts a title to a URL-friendly slug */
function toSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim()
    .slice(0, 80);
}

// ── Keyword idea generation ───────────────────────────────────────────────────

export interface BlogIdea {
  keyword: string;
  title: string;
  h2Outline: string[];
  estimatedWordCount: number;
}

/**
 * Uses Gemini to generate blog post ideas based on the site's niche
 * and any tracked keywords from the DB.
 */
export async function generateBlogIdeas(count = 5): Promise<BlogIdea[]> {
  // Pull tracked keywords from DB for context
  const { data: keywords } = await supabaseAdmin
    .from('keywords')
    .select('keyword, intent_cluster, search_volume')
    .eq('is_tracked', true)
    .order('search_volume', { ascending: false })
    .limit(20);

  const kwContext = keywords?.length
    ? `Tracked keywords: ${keywords.map((k: any) => k.keyword).join(', ')}`
    : 'Site niche: online courses for skills, finance, stock market, career growth (India audience)';

  const prompt = `You are an SEO content strategist for ${SITE_NAME} (${SITE_DOMAIN}), an Indian online course platform.

${kwContext}

Generate ${count} high-value blog post ideas that would rank well on Google India and drive course signups.

Return ONLY a valid JSON array, no markdown, no explanation:
[
  {
    "keyword": "primary target keyword",
    "title": "SEO-optimized blog post title",
    "h2Outline": ["H2 section 1", "H2 section 2", "H2 section 3", "H2 section 4"],
    "estimatedWordCount": 1500
  }
]`;

  const result = await generateWithFallback(prompt);
  const json = result.trim().replace(/^```json?\n?/, '').replace(/\n?```$/, '').trim();
  return JSON.parse(json) as BlogIdea[];
}

// ── Featured image generation (Unsplash Source — free, instant, reliable) ────

function generateImageUrl(title: string, keyword: string): string {
  // Unsplash Source returns a random relevant photo instantly — no generation delay
  const query = encodeURIComponent(keyword.split(' ').slice(0, 3).join(' '));
  return `https://source.unsplash.com/1200x630/?${query},india,education`;
}

// ── Full post generation ──────────────────────────────────────────────────────

async function generatePostContent(idea: BlogIdea): Promise<string> {
  const imageUrl = generateImageUrl(idea.title, idea.keyword);

  const prompt = `Write a comprehensive, SEO-optimized blog post for ${SITE_NAME} (${SITE_DOMAIN}), an Indian online course platform.

Target keyword: "${idea.keyword}"
Title: "${idea.title}"
Target word count: ${idea.estimatedWordCount} words
H2 outline:
${idea.h2Outline.map((h, i) => `${i + 1}. ${h}`).join('\n')}

Requirements:
- Write in MDX format (plain Markdown, no JSX components)
- Start with frontmatter (title, description, date, keywords, author, image)
- Use the target keyword naturally in the intro, at least 2 H2s, and conclusion
- Write in a helpful, educational tone for Indian learners
- End with a CTA to explore courses on ${SITE_NAME}
- Output ONLY the MDX content, no explanation

Format:
---
title: "..."
description: "..."
date: "${new Date().toISOString().split('T')[0]}"
keywords: [...]
author: "${SITE_NAME} Team"
image: "${imageUrl}"
---

![Featured image for ${idea.title}](${imageUrl})

[content]`;

  return generateWithFallback(prompt);
}

// ── Auto-generate and save drafts ─────────────────────────────────────────────

/**
 * Generates blog post ideas + full content and saves them as drafts.
 * Called by the weekly content worker or manually from the dashboard.
 */
export async function autoGenerateBlogDrafts(count = 3): Promise<string[]> {
  const ideas = await generateBlogIdeas(count);
  const ids: string[] = [];

  for (const idea of ideas) {
    const slug = toSlug(idea.title);

    // Skip if slug already exists
    const { data: existing } = await supabaseAdmin
      .from('blog_posts')
      .select('id')
      .eq('slug', slug)
      .single();

    if (existing) continue;

    const mdxContent = await generatePostContent(idea);
    const wordCount = mdxContent.split(/\s+/).length;

    const { data, error } = await supabaseAdmin
      .from('blog_posts')
      .insert({
        target_keyword: idea.keyword,
        title: idea.title,
        slug,
        mdx_content: mdxContent,
        h2_outline: idea.h2Outline,
        word_count: wordCount,
        status: 'draft',
      })
      .select('id')
      .single();

    if (error) {
      console.error(`[blog-writer] Failed to save draft "${idea.title}": ${error.message}`);
      continue;
    }

    // Auto-inject internal links
    try {
      const { addInternalLinks } = await import('./internal-linker');
      await addInternalLinks(data.id as string);
    } catch (e: any) {
      console.warn(`[blog-writer] Internal linking failed: ${e.message}`);
    }

    ids.push(data.id as string);
    console.log(`[blog-writer] Draft saved: "${idea.title}" (${wordCount} words)`);
  }

  return ids;
}

// ── Publish approved post via GitHub ─────────────────────────────────────────

export async function publishBlogPost(postId: string, mode: 'direct' | 'pr' = 'direct'): Promise<string> {
  const { data: post, error } = await supabaseAdmin
    .from('blog_posts')
    .select('*')
    .eq('id', postId)
    .single();

  if (error || !post) throw new Error(`Blog post not found: ${postId}`);

  const filePath = `app/blog/${post.slug}/page.mdx`;
  let url: string;

  if (mode === 'direct') {
    const { commitDirectly } = await import('@/lib/github');
    url = await commitDirectly({
      filePath,
      fileContent: post.mdx_content as string,
      commitMessage: `[SEO Blog] Add: ${post.title}`,
    });
  } else {
    const branchName = `seo-blog/${post.slug}-${Date.now()}`;
    url = await createPullRequest({
      title: `[SEO Blog] ${post.title}`,
      body: `## SEO Blog Post\n\n**Keyword:** ${post.target_keyword}\n**File:** \`${filePath}\`\n\nGenerated by SEO Agent.`,
      filePath,
      fileContent: post.mdx_content as string,
      branchName,
    });
  }

  await supabaseAdmin
    .from('blog_posts')
    .update({ status: 'approved', pr_url: url, updated_at: new Date().toISOString() })
    .eq('id', postId);

  // Ping Google to re-crawl the sitemap
  const siteUrl = (process.env.SITE_URL ?? 'https://www.learnwealthx.in').replace(/\/$/, '');
  try {
    const sitemapUrl = encodeURIComponent(`${siteUrl}/sitemap.xml`);
    await fetch(`https://www.google.com/ping?sitemap=${sitemapUrl}`, { method: 'GET' });
    console.log(`[blog-writer] Pinged Google sitemap for ${siteUrl}`);
  } catch (e) {
    console.warn('[blog-writer] Google sitemap ping failed (non-critical):', e);
  }

  return url;
}

// ── Update post content (after user edits) ────────────────────────────────────

export async function updateBlogPost(postId: string, updates: {
  title?: string;
  mdxContent?: string;
}): Promise<void> {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (updates.title) patch.title = updates.title;
  if (updates.mdxContent) {
    patch.mdx_content = updates.mdxContent;
    patch.word_count = updates.mdxContent.split(/\s+/).length;
  }

  const { error } = await supabaseAdmin.from('blog_posts').update(patch).eq('id', postId);
  if (error) throw new Error(`Failed to update blog post: ${error.message}`);
}

// ── Regenerate a post ─────────────────────────────────────────────────────────

export async function regenerateBlogPost(postId: string): Promise<void> {
  const { data: post, error } = await supabaseAdmin
    .from('blog_posts')
    .select('target_keyword, title, h2_outline, word_count')
    .eq('id', postId)
    .single();

  if (error || !post) throw new Error(`Blog post not found: ${postId}`);

  const idea: BlogIdea = {
    keyword: post.target_keyword as string,
    title: post.title as string,
    h2Outline: (post.h2_outline as string[]) ?? [],
    estimatedWordCount: (post.word_count as number) ?? 1500,
  };

  const mdxContent = await generatePostContent(idea);

  await supabaseAdmin
    .from('blog_posts')
    .update({
      mdx_content: mdxContent,
      word_count: mdxContent.split(/\s+/).length,
      status: 'draft',
      updated_at: new Date().toISOString(),
    })
    .eq('id', postId);
}
