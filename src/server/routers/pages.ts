import { router, protectedProcedure } from '../trpc';

/**
 * tRPC router for pages and CWV data.
 * Validates: Requirements 4.1, 4.6
 */
export const pagesRouter = router({
  /**
   * Returns all pages from the pages table.
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    const { data, error } = await ctx.db
      .from('pages')
      .select('*')
      .order('url', { ascending: true });

    if (error) throw new Error(`Failed to fetch pages: ${error.message}`);
    return data ?? [];
  }),

  /**
   * Returns CWV results joined with pages.
   */
  cwv: protectedProcedure.query(async ({ ctx }) => {
    const { data: cwvData, error } = await ctx.db
      .from('cwv_results')
      .select('page_id, lcp_ms, inp_ms, cls_score, lcp_rating, inp_rating, cls_rating, measured_at')
      .order('measured_at', { ascending: false });

    if (error) throw new Error(`Failed to fetch CWV results: ${error.message}`);
    if (!cwvData || (cwvData as any[]).length === 0) return [];

    // Fetch page URLs separately
    const pageIds = [...new Set((cwvData as any[]).map((r: any) => r.page_id))];
    const { data: pagesData } = await ctx.db
      .from('pages')
      .select('id, url')
      .in('id', pageIds);

    const pageMap = ((pagesData as any[]) ?? []).reduce((acc: Record<string, string>, p: any) => {
      acc[p.id] = p.url;
      return acc;
    }, {});

    return (cwvData as any[]).map((row: any) => ({
      page_id: row.page_id,
      url: pageMap[row.page_id] ?? null,
      lcp_ms: row.lcp_ms,
      inp_ms: row.inp_ms,
      cls_score: row.cls_score,
      lcp_rating: row.lcp_rating,
      inp_rating: row.inp_rating,
      cls_rating: row.cls_rating,
      measured_at: row.measured_at,
    }));
  }),
});
