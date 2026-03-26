import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';
import { approveRecommendation, rejectRecommendation } from '../../agent/workflow/approval-queue';

/**
 * tRPC routers for the action queue and auto-fix feed.
 * Validates: Requirements 10.2, 10.3, 10.4
 */

export const recommendationsRouter = router({
  /**
   * Returns all pending recommendations ordered by priority ASC.
   */
  queue: protectedProcedure.query(async ({ ctx }) => {
    const { data, error } = await ctx.db
      .from('recommendations')
      .select('*')
      .eq('status', 'pending')
      .order('priority', { ascending: true });

    if (error) throw new Error(`Failed to fetch recommendation queue: ${error.message}`);
    return data ?? [];
  }),

  /**
   * Approves a recommendation by id.
   */
  approve: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      await approveRecommendation(input.id);
      return { success: true };
    }),

  /**
   * Rejects a recommendation by id with a reason.
   */
  reject: protectedProcedure
    .input(z.object({ id: z.string().uuid(), reason: z.string().min(1) }))
    .mutation(async ({ input }) => {
      await rejectRecommendation(input.id, input.reason);
      return { success: true };
    }),
});

export const auditLogRouter = router({
  /**
   * Returns the last 50 AUTO_FIX entries from audit_log ordered by executed_at DESC.
   */
  feed: protectedProcedure.query(async ({ ctx }) => {
    const { data, error } = await ctx.db
      .from('audit_log')
      .select('*')
      .eq('classification', 'AUTO_FIX')
      .order('executed_at', { ascending: false })
      .limit(50);

    if (error) throw new Error(`Failed to fetch audit log feed: ${error.message}`);
    return data ?? [];
  }),
});
