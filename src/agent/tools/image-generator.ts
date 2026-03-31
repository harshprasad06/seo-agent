/**
 * Image Generator — generates AI images using Pollinations.ai (free, no key needed)
 * with HuggingFace as an optional alternative.
 * Stores images in the GitHub repo alongside the blog post.
 *
 * Storage: app/blog/{slug}/cover.jpg in the GitHub repo
 * Public URL: /blog/{slug}/cover.jpg (served by Next.js)
 */

import { commitDirectly } from '../../lib/github';
import { supabaseAdmin } from '../../lib/supabase';

/**
 * Build a detailed image prompt from the blog keyword/title.
 */
function buildImagePrompt(keyword: string, title: string): string {
  return `professional blog featured image, ${keyword}, ${title}, modern flat design, vibrant colors, digital art, high quality, no text, no watermark, clean background`;
}

/**
 * Generate image using Pollinations.ai (free, no API key, fast).
 * Returns image as base64 string.
 */
async function generateWithPollinations(prompt: string): Promise<string> {
  const encoded = encodeURIComponent(prompt);
  // Pollinations new API format
  const url = `https://image.pollinations.ai/prompt/${encoded}?width=1200&height=630&nologo=true&seed=${Date.now()}`;

  const res = await fetch(url, {
    signal: AbortSignal.timeout(60000), // 60s timeout
    headers: { 'User-Agent': 'SEOAgent/1.0' },
  });

  if (!res.ok) throw new Error(`Pollinations error ${res.status}`);

  const buffer = await res.arrayBuffer();
  if (buffer.byteLength < 1000) throw new Error('Pollinations returned empty image');
  return Buffer.from(buffer).toString('base64');
}

/**
 * Generate image using HuggingFace (optional, needs HUGGINGFACE_API_KEY).
 * Uses FLUX.1-schnell which is fast even on free tier.
 */
async function generateWithHuggingFace(prompt: string): Promise<string> {
  const apiKey = process.env.HUGGINGFACE_API_KEY;
  if (!apiKey) throw new Error('HUGGINGFACE_API_KEY not set');

  const res = await fetch('https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      inputs: prompt,
      parameters: { width: 1024, height: 576, num_inference_steps: 4 },
      options: { wait_for_model: true },
    }),
    signal: AbortSignal.timeout(90000),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HuggingFace error ${res.status}: ${body.slice(0, 200)}`);
  }

  const buffer = await res.arrayBuffer();
  return Buffer.from(buffer).toString('base64');
}

/**
 * Generate image — tries HuggingFace first if key is set, falls back to Pollinations.
 */
async function generateImage(prompt: string): Promise<string> {
  if (process.env.HUGGINGFACE_API_KEY) {
    try {
      console.log('[image-generator] Using HuggingFace FLUX.1-schnell…');
      return await generateWithHuggingFace(prompt);
    } catch (err: any) {
      console.warn(`[image-generator] HuggingFace failed: ${err.message} — falling back to Pollinations`);
    }
  }
  console.log('[image-generator] Using Pollinations.ai…');
  return await generateWithPollinations(prompt);
}

/**
 * Generate, store, and return the image URL for a blog post.
 */
export async function generateAndStoreImage(slug: string, keyword: string, title?: string): Promise<string> {
  const prompt = buildImagePrompt(keyword, title ?? keyword);
  console.log(`[image-generator] Generating image for "${keyword}"…`);

  const base64 = await generateImage(prompt);

  // Store in public/ so Next.js serves it as a static asset at /blog/{slug}/cover.jpg
  const filePath = `public/blog/${slug}/cover.jpg`;
  await commitDirectly({
    filePath,
    fileContent: base64,
    commitMessage: `[SEO Blog] Add AI cover image for ${slug}`,
    isBase64: true,
  });

  const siteUrl = (process.env.SITE_URL ?? 'https://example.com').replace(/\/$/, '');
  const publicUrl = `${siteUrl}/blog/${slug}/cover.jpg`;
  console.log(`[image-generator] Image stored at ${publicUrl}`);
  return publicUrl;
}

/**
 * Regenerate image for an existing blog post.
 */
export async function regeneratePostImage(postId: string): Promise<string> {
  const { data: post, error } = await supabaseAdmin
    .from('blog_posts')
    .select('slug, target_keyword, title, mdx_content')
    .eq('id', postId)
    .single();

  if (error || !post) throw new Error(`Post not found: ${error?.message}`);

  const p = post as any;
  const newImageUrl = await generateAndStoreImage(p.slug, p.target_keyword, p.title);

  let mdx = p.mdx_content as string;

  if (/^image:/m.test(mdx)) {
    mdx = mdx.replace(/^image:.*$/m, `image: "${newImageUrl}"`);
  } else {
    mdx = mdx.replace(/^(author:.*$)/m, `$1\nimage: "${newImageUrl}"`);
  }

  mdx = mdx.replace(
    /!\[Featured image[^\]]*\]\([^)]+\)/,
    `![Featured image for ${p.slug}](${newImageUrl})`
  );

  await supabaseAdmin
    .from('blog_posts')
    .update({ mdx_content: mdx, updated_at: new Date().toISOString() })
    .eq('id', postId);

  return newImageUrl;
}
