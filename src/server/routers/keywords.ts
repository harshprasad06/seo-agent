import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';

/**
 * tRPC router for keyword ranking table with optional filters.
 * Validates: Requirement 10.5
 */
export const keywordsRouter = router({
  /**
   * Returns keywords with optional filters.
   * If competitor_domain is provided, joins with competitor_keywords to include
   * the competitor's position for that domain.
   */
  list: protectedProcedure
    .input(
      z.object({
        intent_cluster: z.string().optional(),
        min_position: z.number().int().optional(),
        max_position: z.number().int().optional(),
        competitor_domain: z.string().optional(),
      }).optional(),
    )
    .query(async ({ ctx, input }) => {
      let query = ctx.db.from('keywords').select('*');

      if (input?.intent_cluster) {
        query = query.eq('intent_cluster', input.intent_cluster);
      }
      if (input?.min_position !== undefined) {
        query = query.gte('current_position', input.min_position);
      }
      if (input?.max_position !== undefined) {
        query = query.lte('current_position', input.max_position);
      }

      const { data: keywords, error } = await query;
      if (error) throw new Error(`Failed to fetch keywords: ${error.message}`);

      if (!input?.competitor_domain || !keywords?.length) {
        return keywords ?? [];
      }

      // Resolve competitor id for the given domain
      const { data: competitor } = await ctx.db
        .from('competitors')
        .select('id')
        .eq('domain', input.competitor_domain)
        .single();

      if (!competitor) {
        return keywords.map((kw) => ({ ...kw, competitor_position: null }));
      }

      // Fetch the most recent competitor position for each keyword
      const keywordTexts = keywords.map((kw) => kw.keyword);
      const { data: compKeywords } = await ctx.db
        .from('competitor_keywords')
        .select('keyword, position, tracked_at')
        .eq('competitor_id', competitor.id)
        .in('keyword', keywordTexts)
        .order('tracked_at', { ascending: false });

      // Build a map: keyword -> latest competitor position
      const compPositionMap = new Map<string, number | null>();
      for (const ck of compKeywords ?? []) {
        if (!compPositionMap.has(ck.keyword)) {
          compPositionMap.set(ck.keyword, ck.position);
        }
      }

      return keywords.map((kw) => ({
        ...kw,
        competitor_position: compPositionMap.get(kw.keyword) ?? null,
      }));
    }),
});
