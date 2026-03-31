import PgBoss from 'pg-boss';
import { supabaseAdmin } from '../lib/supabase';

const SERPER_API_URL = 'https://google.serper.dev/search';
const TARGET_DOMAIN = process.env.SITE_URL
  ? new URL(process.env.SITE_URL).hostname.replace(/^www\./, '')
  : 'example.com';

interface SerperOrganicResult {
  link: string;
  position: number;
}

interface SerperResponse {
  organic?: SerperOrganicResult[];
}

interface TrackedKeyword {
  id: string;
  keyword: string;
  current_position: number | null;
}

/**
 * Searches Serper.dev for a keyword and returns the 1-indexed position
 * of TARGET_DOMAIN in the organic results, or null if not found in top 10.
 */
async function findPositionForKeyword(
  keyword: string,
  apiKey: string,
): Promise<number | null> {
  const response = await fetch(SERPER_API_URL, {
    method: 'POST',
    headers: {
      'X-API-KEY': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ q: keyword, num: 10 }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Serper API error ${response.status}: ${body}`);
  }

  const data: SerperResponse = await response.json();
  const organic = data.organic ?? [];

  const match = organic.find((result) => {
    try {
      const hostname = new URL(result.link).hostname.replace(/^www\./, '');
      return hostname === TARGET_DOMAIN;
    } catch {
      return false;
    }
  });

  return match ? match.position : null;
}

async function runKeywordTracker(): Promise<void> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    throw new Error('SERPER_API_KEY environment variable is not set');
  }

  // Fetch all tracked keywords
  const { data: keywords, error: fetchError } = await supabaseAdmin
    .from('keywords')
    .select('id, keyword, current_position')
    .eq('is_tracked', true);

  if (fetchError) {
    throw new Error(`Failed to fetch tracked keywords: ${fetchError.message}`);
  }

  if (!keywords || keywords.length === 0) {
    console.log('[keyword-tracker] No tracked keywords found.');
    return;
  }

  console.log(`[keyword-tracker] Tracking ${keywords.length} keyword(s).`);

  for (const kw of keywords as TrackedKeyword[]) {
    try {
      const newPosition = await findPositionForKeyword(kw.keyword, apiKey);
      const previousPosition = kw.current_position;

      // Update the keyword row
      const { error: updateError } = await supabaseAdmin
        .from('keywords')
        .update({
          previous_position: previousPosition,
          current_position: newPosition,
          position_updated_at: new Date().toISOString(),
        })
        .eq('id', kw.id);

      if (updateError) {
        console.error(
          `[keyword-tracker] Failed to update keyword "${kw.keyword}": ${updateError.message}`,
        );
        continue;
      }

      // Alert if position changed by 5 or more positions
      if (
        previousPosition !== null &&
        newPosition !== null &&
        Math.abs(newPosition - previousPosition) >= 5
      ) {
        const direction = newPosition < previousPosition ? 'UP' : 'DOWN';
        console.warn(
          `[keyword-tracker] RANKING ALERT: "${kw.keyword}" moved ${direction} ` +
            `from position ${previousPosition} to ${newPosition} ` +
            `(delta: ${Math.abs(newPosition - previousPosition)})`,
        );
      }
    } catch (err) {
      console.error(
        `[keyword-tracker] Error tracking keyword "${kw.keyword}":`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  console.log('[keyword-tracker] Tracking run complete.');
}

// Cron: every Sunday at 04:00 UTC
const KEYWORD_TRACKER_CRON = '0 4 * * 0';

export async function registerKeywordTrackerWorker(boss: PgBoss): Promise<void> {
  await boss.createQueue('keyword-tracker');
  await boss.schedule('keyword-tracker', KEYWORD_TRACKER_CRON, {}, { tz: 'UTC' });

  await boss.work('keyword-tracker', async (_job) => {
    try {
      await runKeywordTracker();
    } catch (err) {
      console.error(
        '[keyword-tracker] Worker failed:',
        err instanceof Error ? err.message : String(err),
      );
      throw err;
    }
  });

  console.log('[keyword-tracker] Worker registered (weekly cron: Sundays 04:00 UTC).');
}
