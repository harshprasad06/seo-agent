import PgBoss from 'pg-boss';

let boss: PgBoss | null = null;

/**
 * Returns a singleton pg-boss instance connected to Supabase PostgreSQL.
 * Call `await getQueue()` before scheduling or consuming jobs.
 */
export async function getQueue(): Promise<PgBoss> {
  if (boss) return boss;

  const connectionString = process.env.SUPABASE_DB_URL;

  if (!connectionString) {
    throw new Error(
      'SUPABASE_DB_URL environment variable is required for pg-boss. ' +
        'Find it in Supabase Dashboard → Settings → Database → Connection string (URI mode).'
    );
  }

  boss = new PgBoss({
    connectionString,
    // Retain failed jobs for 7 days in the dead-letter queue
    deleteAfterDays: 7,
    // Archive completed jobs after 1 day
    archiveCompletedAfterSeconds: 86400,
  });

  boss.on('error', (error) => {
    console.error('[pg-boss] error:', error);
  });

  await boss.start();
  return boss;
}

/**
 * Gracefully stop the pg-boss instance (call on process exit).
 */
export async function stopQueue(): Promise<void> {
  if (boss) {
    await boss.stop();
    boss = null;
  }
}
