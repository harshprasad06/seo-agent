import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';
import { generateDailyReport, generateWeeklyReport, generateMonthlyReport } from '../../agent/tools/report-generator';

export const reportsRouter = router({
  generate: protectedProcedure
    .input(z.object({ topic: z.enum(['daily', 'weekly', 'monthly']) }))
    .mutation(async ({ ctx, input }) => {
      const reportId =
        input.topic === 'daily'   ? await generateDailyReport() :
        input.topic === 'monthly' ? await generateMonthlyReport() :
                                    await generateWeeklyReport();

      const { data, error } = await ctx.db
        .from('reports').select('*').eq('id', reportId).single();

      if (error) throw new Error(`Failed to fetch generated report: ${error.message}`);
      return data;
    }),

  list: protectedProcedure
    .input(z.object({ type: z.enum(['daily', 'weekly', 'monthly', 'all']).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const q = ctx.db.from('reports').select('*').order('created_at', { ascending: false });
      if (input?.type && input.type !== 'all') q.eq('type', input.type);
      const { data, error } = await q;
      if (error) throw new Error(`Failed to list reports: ${error.message}`);
      return data ?? [];
    }),

  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { data, error } = await ctx.db
        .from('reports').select('*').eq('id', input.id).single();
      if (error) throw new Error(`Failed to fetch report: ${error.message}`);
      return data;
    }),
});
