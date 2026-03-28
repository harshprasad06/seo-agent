/**
 * Direct GA4 sync — runs inline during agent execution (no pg-boss).
 * Fetches organic sessions from GA4 Data API for the last 7 days.
 */

import { refreshTokenIfNeeded } from '../lib/tokens';
import { supabaseAdmin } from '../lib/supabase';

export async function runGaSyncDirect(): Promise<number> {
  const propertyId = process.env.GA4_PROPERTY_ID;
  if (!propertyId) throw new Error('GA4_PROPERTY_ID not set');

  // Get OAuth token (shared with GSC)
  const tokens = await refreshTokenIfNeeded('gsc');

  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - 6);
  const fmt = (d: Date) => d.toISOString().split('T')[0];

  const res = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        dateRanges: [{ startDate: fmt(startDate), endDate: fmt(endDate) }],
        dimensions: [{ name: 'landingPage' }, { name: 'date' }],
        metrics: [
          { name: 'sessions' },
          { name: 'bounceRate' },
          { name: 'conversions' },
        ],
        dimensionFilter: {
          filter: {
            fieldName: 'sessionDefaultChannelGroup',
            stringFilter: { matchType: 'EXACT', value: 'Organic Search' },
          },
        },
        limit: 100,
      }),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GA4 API error ${res.status}: ${body}`);
  }

  const data: any = await res.json();
  const rows: any[] = data.rows ?? [];
  if (rows.length === 0) return 0;

  const records = rows.map(row => ({
    landing_page: row.dimensionValues[0]?.value ?? '',
    date: row.dimensionValues[1]?.value ?? fmt(endDate),
    organic_sessions: parseInt(row.metricValues[0]?.value ?? '0', 10),
    bounce_rate: parseFloat(row.metricValues[1]?.value ?? '0'),
    goal_completions: parseInt(row.metricValues[2]?.value ?? '0', 10),
    synced_at: new Date().toISOString(),
  }));

  const { error } = await supabaseAdmin
    .from('ga_data_points')
    .upsert(records, { onConflict: 'landing_page,date' });

  if (error) throw new Error(`Failed to upsert GA data: ${error.message}`);

  console.log(`[ga-sync-direct] Synced ${records.length} rows`);
  return records.length;
}
