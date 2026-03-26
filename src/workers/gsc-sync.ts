import PgBoss from 'pg-boss';
import { refreshTokenIfNeeded, TokenRevokedError } from '../lib/tokens';
import { supabaseAdmin } from '../lib/supabase';

const SITE_URL = process.env.SITE_URL ?? 'https://goodads.ai/';

// ── Retry helpers ─────────────────────────────────────────────────────────────

const RETRY_DELAYS_MS = [1000, 2000, 4000]; // 1s, 2s, 4s

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calls `fn` up to 3 times total with exponential backoff.
 * Throws the last error if all attempts fail.
 */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < RETRY_DELAYS_MS.length) {
        await sleep(RETRY_DELAYS_MS[attempt]);
      }
    }
  }
  throw lastError;
}

// ── GSC API types ─────────────────────────────────────────────────────────────

interface GscRow {
  keys: string[]; // [query, page]
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

interface GscApiResponse {
  rows?: GscRow[];
}

// ── Core sync logic ───────────────────────────────────────────────────────────

async function syncGscData(): Promise<void> {
  // 1. Get a valid access token (refresh if needed)
  const tokens = await refreshTokenIfNeeded('gsc');

  // 2. Build date range: last 7 days
  const endDate = new Date();
  endDate.setDate(endDate.getDate() - 1); // GSC data lags by 1 day
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - 6);

  const formatDate = (d: Date) => d.toISOString().split('T')[0];

  // 3. Fetch Search Analytics data from GSC API
  const encodedSiteUrl = encodeURIComponent(SITE_URL);
  const apiUrl = `https://searchconsole.googleapis.com/v1/sites/${encodedSiteUrl}/searchAnalytics/query`;

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokens.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      startDate: formatDate(startDate),
      endDate: formatDate(endDate),
      dimensions: ['query', 'page'],
      rowLimit: 25000,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`GSC API error ${response.status}: ${errorBody}`);
  }

  const data: GscApiResponse = await response.json();
  const rows = data.rows ?? [];

  if (rows.length === 0) {
    console.log('[gsc-sync] No rows returned from GSC API.');
    return;
  }

  // 4. Upsert each row into gsc_data_points
  const records = rows.map((row) => ({
    query: row.keys[0] ?? null,
    url: row.keys[1] ?? '',
    // GSC returns per-row date only when 'date' is in dimensions;
    // without it we use the end of the range as the representative date.
    date: formatDate(endDate),
    clicks: row.clicks,
    impressions: row.impressions,
    ctr: row.ctr,
    position: row.position,
    synced_at: new Date().toISOString(),
  }));

  const { error } = await supabaseAdmin
    .from('gsc_data_points')
    .upsert(records, { onConflict: 'url,query,date' });

  if (error) {
    throw new Error(`Failed to upsert gsc_data_points: ${error.message}`);
  }

  console.log(`[gsc-sync] Upserted ${records.length} rows into gsc_data_points.`);
}

// ── Worker registration ───────────────────────────────────────────────────────

// Cron: daily at 02:00 UTC
const GSC_SYNC_CRON = '0 2 * * *';

export async function registerGscSyncWorker(boss: PgBoss): Promise<void> {
  await boss.createQueue('gsc-sync');
  await boss.schedule('gsc-sync', GSC_SYNC_CRON, {}, { tz: 'UTC' });

  await boss.work('gsc-sync', async (_job) => {
    try {
      await withRetry(syncGscData);
    } catch (err) {
      if (err instanceof TokenRevokedError) {
        console.error(
          '[gsc-sync] Re-authentication required: GSC refresh token has been revoked. ' +
            'Please reconnect Google Search Console in the Dashboard settings.',
          err.message,
        );
        // Do not rethrow — token revocation is a user action, not a transient failure.
        return;
      }

      // All 3 attempts exhausted — log a clear error (notifications table not yet created)
      console.error(
        '[gsc-sync] SYNC FAILED after 3 attempts. Manual intervention required.',
        err instanceof Error ? err.message : String(err),
      );

      // Rethrow so pg-boss marks the job as failed and retains it in the dead-letter queue
      throw err;
    }
  });

  console.log('[gsc-sync] Worker registered (daily cron: 02:00 UTC).');
}
