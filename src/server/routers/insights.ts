import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';
import { analyzeTrafficDrop, isTrafficDrop } from '../../agent/tools/root-cause-analyzer';

/**
 * tRPC router for insights feed and traffic drop analysis.
 * Validates: Requirements 8.4, 8.5, 8.6
 */
export const insightsRouter = router({
  /**
   * Returns top 5 pending recommendations sorted by priority ASC (1 = highest impact).
   * Validates: Requirement 8.4
   */
  feed: protectedProcedure.query(async ({ ctx }) => {
    const { data, error } = await ctx.db
      .from('recommendations')
      .select('*')
      .eq('status', 'pending')
      .order('priority', { ascending: true })
      .limit(5);

    if (error) throw new Error(`Failed to fetch insights feed: ${error.message}`);
    return data ?? [];
  }),

  /**
   * Fetches last 2 weeks of GA data and runs root-cause analysis if drop >= 20%.
   * Validates: Requirements 8.5, 8.6
   */
  trafficDrop: protectedProcedure.query(async ({ ctx }) => {
    const today = new Date();

    // Current week: last 7 days
    const currentEnd = new Date(today);
    currentEnd.setHours(23, 59, 59, 999);
    const currentStart = new Date(today);
    currentStart.setDate(currentStart.getDate() - 6);
    currentStart.setHours(0, 0, 0, 0);

    // Prior week: 7 days before current week
    const priorEnd = new Date(currentStart);
    priorEnd.setDate(priorEnd.getDate() - 1);
    priorEnd.setHours(23, 59, 59, 999);
    const priorStart = new Date(priorEnd);
    priorStart.setDate(priorStart.getDate() - 6);
    priorStart.setHours(0, 0, 0, 0);

    const toDateStr = (d: Date) => d.toISOString().slice(0, 10);

    // Fetch sessions for both weeks
    const [currentResult, priorResult] = await Promise.all([
      ctx.db
        .from('ga_data_points')
        .select('organic_sessions')
        .gte('date', toDateStr(currentStart))
        .lte('date', toDateStr(currentEnd)),
      ctx.db
        .from('ga_data_points')
        .select('organic_sessions')
        .gte('date', toDateStr(priorStart))
        .lte('date', toDateStr(priorEnd)),
    ]);

    if (currentResult.error)
      throw new Error(`Failed to fetch current week GA data: ${currentResult.error.message}`);
    if (priorResult.error)
      throw new Error(`Failed to fetch prior week GA data: ${priorResult.error.message}`);

    const sumSessions = (rows: { organic_sessions: number }[]) =>
      rows.reduce((sum, row) => sum + (row.organic_sessions ?? 0), 0);

    const currentWeekSessions = sumSessions(currentResult.data ?? []);
    const priorWeekSessions = sumSessions(priorResult.data ?? []);

    if (!isTrafficDrop(currentWeekSessions, priorWeekSessions)) {
      return {
        triggered: false,
        drop_pct: 0,
        root_causes: [] as string[],
        report: '',
        currentWeekSessions,
        priorWeekSessions,
      };
    }

    const analysis = await analyzeTrafficDrop(currentWeekSessions, priorWeekSessions);

    return {
      ...analysis,
      currentWeekSessions,
      priorWeekSessions,
    };
  }),
});
