import PgBoss from 'pg-boss';
import { getQueue } from '../lib/queue';
import { registerGscSyncWorker } from './gsc-sync';
import { registerGaSyncWorker } from './ga-sync';
import { registerKeywordTrackerWorker } from './keyword-tracker';
import { registerSiteCrawlWorker } from './site-crawl';
import { registerPageSpeedAuditWorker } from './pagespeed-audit';
import { registerBacklinkSyncWorker } from './backlink-sync';
import { registerCompetitorMonitorWorker } from './competitor-monitor';

/**
 * Cron schedule reference:
 *   gsc-sync            — daily        02:00 UTC
 *   ga-sync             — daily        02:30 UTC
 *   site-crawl          — weekly       Sundays  01:00 UTC
 *   keyword-tracker     — weekly       Sundays  04:00 UTC
 *   pagespeed-audit     — weekly       Mondays  03:00 UTC
 *   competitor-monitor  — weekly       Mondays  05:00 UTC
 *   backlink-sync       — bi-weekly    1st & 15th 04:00 UTC
 */

/**
 * Registers all pg-boss workers and their cron schedules.
 * Call this once after `getQueue()` returns a started PgBoss instance.
 */
export async function registerAllWorkers(boss: PgBoss): Promise<void> {
  await registerGscSyncWorker(boss);
  await registerGaSyncWorker(boss);
  await registerSiteCrawlWorker(boss);
  await registerKeywordTrackerWorker(boss);
  await registerPageSpeedAuditWorker(boss);
  await registerBacklinkSyncWorker(boss);
  await registerCompetitorMonitorWorker(boss);
  console.log('[workers] All workers registered.');
}

/**
 * Convenience: starts the pg-boss queue and registers all workers.
 * Safe to call multiple times — getQueue() returns the singleton.
 */
export async function startWorkers(): Promise<PgBoss> {
  const boss = await getQueue();
  await registerAllWorkers(boss);
  return boss;
}
