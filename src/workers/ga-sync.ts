import PgBoss from 'pg-boss';
import { refreshTokenIfNeeded, TokenRevokedError } from '../lib/tokens';
import { supabaseAdmin } from '../lib/supabase';

const GA4_PROPERTY_ID = process.env.GA4_PROPERTY_ID;

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

// ── GA4 API types ─────────────────────────────────────────────────────────────

interface DimensionValue {
  value: string;
}

interface MetricValue {
  value: string;
}

interface GA4Row {
  dimensionValues: DimensionValue[]; // [landingPage, date]
  metricValues: MetricValue[];       // [sessions, bounceRate, conversions]
}

interface GA4ApiResponse {
  rows?: GA4Row[];
}

// ── Core sync logic ───────────────────────────────────────────────────────────

async function syncGaData(): Promise<void> {
  if (!GA4_PROPERTY_ID) {
    throw new Error('GA4_PROPERTY_ID environment variable is required for GA sync.');
  }

  // 1. Get a valid access token — GSC and GA share the same Google OAuth flow
  const tokens = await refreshTokenIfNeeded('gsc');

  // 2. Build date range: last 7 days
  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - 6);

  const formatDate = (d: Date) => d.toISOString().split('T')[0];

  // 3. Fetch organic traffic data from GA4 Data API
  const apiUrl = `https://analyticsdata.googleapis.com/v1beta/properties/${GA4_PROPERTY_ID}:runReport`;

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokens.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      dateRanges: [
        {
          startDate: formatDate(startDate),
          endDate: formatDate(endDate),
        },
      ],
      dimensions: [
        { name: 'landingPage' },
        { name: 'date' },
      ],
      metrics: [
        { name: 'sessions' },
        { name: 'bounceRate' },
        { name: 'conversions' },
      ],
      dimensionFilter: {
        filter: {
          fieldName: 'sessionDefaultChannelGroup',
          stringFilter: {
            matchType: 'EXACT',
            value: 'Organic Search',
          },
        },
      },
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`GA4 API error ${response.status}: ${errorBody}`);
  }

  const data: GA4ApiResponse = await response.json();
  const rows = data.rows ?? [];

  if (rows.length === 0) {
    console.log('[ga-sync] No rows returned from GA4 API.');
    return;
  }

  // 4. Upsert each row into ga_data_points
  const records = rows.map((row) => ({
    landing_page: row.dimensionValues[0]?.value ?? '',
    date: row.dimensionValues[1]?.value ?? formatDate(endDate),
    organic_sessions: parseInt(row.metricValues[0]?.value ?? '0', 10),
    bounce_rate: parseFloat(row.metricValues[1]?.value ?? '0'),
    goal_completions: parseInt(row.metricValues[2]?.value ?? '0', 10),
    synced_at: new Date().toISOString(),
  }));

  const { error } = await supabaseAdmin
    .from('ga_data_points')
    .upsert(records, { onConflict: 'landing_page,date' });

  if (error) {
    throw new Error(`Failed to upsert ga_data_points: ${error.message}`);
  }

  console.log(`[ga-sync] Upserted ${records.length} rows into ga_data_points.`);
}

// ── Worker registration ───────────────────────────────────────────────────────

// Cron: daily at 02:30 UTC (offset from GSC to avoid concurrent API calls)
const GA_SYNC_CRON = '30 2 * * *';

export async function registerGaSyncWorker(boss: PgBoss): Promise<void> {
  await boss.createQueue('ga-sync');
  await boss.schedule('ga-sync', GA_SYNC_CRON, {}, { tz: 'UTC' });

  await boss.work('ga-sync', async (_job) => {
    try {
      await withRetry(syncGaData);
    } catch (err) {
      if (err instanceof TokenRevokedError) {
        console.error(
          '[ga-sync] Re-authentication required: Google OAuth refresh token has been revoked. ' +
            'Please reconnect Google Analytics in the Dashboard settings.',
          err.message,
        );
        // Do not rethrow — token revocation is a user action, not a transient failure.
        return;
      }

      // All 3 attempts exhausted — log a clear error
      console.error(
        '[ga-sync] SYNC FAILED after 3 attempts. Manual intervention required.',
        err instanceof Error ? err.message : String(err),
      );

      // Rethrow so pg-boss marks the job as failed and retains it in the dead-letter queue
      throw err;
    }
  });

  console.log('[ga-sync] Worker registered (daily cron: 02:30 UTC).');
}
