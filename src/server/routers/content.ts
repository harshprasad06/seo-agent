import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';
import { analyzeContentGaps } from '../../agent/tools/content-gap-analyzer';
import { getContentRefreshCandidates } from '../../agent/tools/content-refresh-tracker';
import {
  autoGenerateBlogDrafts,
  publishBlogPost,
  updateBlogPost,
  regenerateBlogPost,
} from '../../agent/tools/blog-writer';

export const contentRouter = router({
  briefs: protectedProcedure.query(async ({ ctx }) => {
    const { data, error } = await ctx.db
      .from('content_briefs')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw new Error(`Failed to fetch content briefs: ${error.message}`);
    return data ?? [];
  }),

  gaps: protectedProcedure.query(async () => analyzeContentGaps()),

  refreshCandidates: protectedProcedure.query(async () => getContentRefreshCandidates()),

  // ── Blog post endpoints ──────────────────────────────────────────────────

  /** List all blog post drafts */
  blogPosts: protectedProcedure.query(async ({ ctx }) => {
    const { data, error } = await ctx.db
      .from('blog_posts')
      .select('id, target_keyword, title, slug, status, word_count, pr_url, created_at, updated_at')
      .order('created_at', { ascending: false });
    if (error) throw new Error(`Failed to fetch blog posts: ${error.message}`);
    return data ?? [];
  }),

  /** Get full content of a single blog post */
  blogPost: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { data, error } = await ctx.db
        .from('blog_posts')
        .select('*')
        .eq('id', input.id)
        .single();
      if (error) throw new Error(`Blog post not found: ${error.message}`);
      return data;
    }),

  /** Auto-generate N blog post drafts using Gemini */
  autoGenerate: protectedProcedure
    .input(z.object({ count: z.number().min(1).max(10).default(3) }))
    .mutation(async ({ input }) => {
      const ids = await autoGenerateBlogDrafts(input.count);
      return { generated: ids.length, ids };
    }),

  /** Save edits to a draft */
  updateBlogPost: protectedProcedure
    .input(z.object({
      id: z.string().uuid(),
      title: z.string().min(1).optional(),
      mdxContent: z.string().min(1).optional(),
    }))
    .mutation(async ({ input }) => {
      await updateBlogPost(input.id, { title: input.title, mdxContent: input.mdxContent });
      return { success: true };
    }),

  /** Add internal links to a blog post */
  addInternalLinks: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const { addInternalLinks } = await import('../../agent/tools/internal-linker');
      const count = await addInternalLinks(input.id);
      return { linksAdded: count };
    }),

  /** Approve a draft — commits directly to main or opens a PR */
  approveBlogPost: protectedProcedure
    .input(z.object({ id: z.string().uuid(), mode: z.enum(['direct', 'pr']).default('direct') }))
    .mutation(async ({ input }) => {
      const url = await publishBlogPost(input.id, input.mode);
      return { url, mode: input.mode };
    }),

  /** Reject a draft */
  rejectBlogPost: protectedProcedure
    .input(z.object({ id: z.string().uuid(), note: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .from('blog_posts')
        .update({ status: 'rejected', rejection_note: input.note ?? null, updated_at: new Date().toISOString() })
        .eq('id', input.id);
      return { success: true };
    }),

  /** Regenerate content for a draft */
  regenerateBlogPost: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      await regenerateBlogPost(input.id);
      return { success: true };
    }),
});
