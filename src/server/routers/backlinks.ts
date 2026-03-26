import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';

export const backlinksRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const { data, error } = await ctx.db
      .from('backlinks')
      .select('*')
      .order('domain_authority', { ascending: false });
    if (error) throw new Error(`Failed to fetch backlinks: ${error.message}`);
    return data ?? [];
  }),

  outreach: protectedProcedure.query(async ({ ctx }) => {
    const { data, error } = await ctx.db
      .from('outreach_opportunities')
      .select('*')
      .order('relevance_score', { ascending: false });
    if (error) throw new Error(`Failed to fetch outreach opportunities: ${error.message}`);
    return data ?? [];
  }),

  updateOutreachStatus: protectedProcedure
    .input(z.object({ id: z.string(), status: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.db
        .from('outreach_opportunities')
        .update({ status: input.status, updated_at: new Date().toISOString() })
        .eq('id', input.id)
        .select()
        .single();
      if (error) throw new Error(`Failed to update outreach status: ${error.message}`);
      return data;
    }),

  generateDraft: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const { generateOutreachDraft } = await import('../../agent/tools/outreach-drafter');
      const draft = await generateOutreachDraft(input.id);
      return { draft };
    }),

  findProspects: protectedProcedure.mutation(async () => {
    const { runOutreachProspector } = await import('../../agent/tools/outreach-prospector');
    const count = await runOutreachProspector();
    return { count };
  }),
});
