import { router, publicProcedure } from '../trpc';
import { reportsRouter } from './reports';
import { insightsRouter } from './insights';
import { recommendationsRouter, auditLogRouter } from './recommendations';
import { keywordsRouter } from './keywords';
import { pagesRouter } from './pages';
import { contentRouter } from './content';
import { backlinksRouter } from './backlinks';
import { competitorsRouter } from './competitors';

/**
 * Root tRPC router.
 */
export const appRouter = router({
  healthCheck: publicProcedure.query(() => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }),
  reports: reportsRouter,
  insights: insightsRouter,
  recommendations: recommendationsRouter,
  auditLog: auditLogRouter,
  keywords: keywordsRouter,
  pages: pagesRouter,
  content: contentRouter,
  backlinks: backlinksRouter,
  competitors: competitorsRouter,
});

export type AppRouter = typeof appRouter;
