import PgBoss from 'pg-boss';
import { supabaseAdmin } from '../lib/supabase';

const SERPER_API_URL = 'https://google.serper.dev/search';

// Cron: every Monday at 05:00 UTC
const COMPETITOR_MONITOR_CRON = '0 5 * * 1';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Competitor {
  id: string;
  domain: string;
  name: string;
}

interface SerperOrganicResult {
  link: string;
  title?: string;
  position?: number;
}

interface SerperResponse {
  organic?: SerperOrganicResult[];
}

interface OurKeyword {
  keyword: string;
  status: string;
}

// ── Serper helpers ────────────────────────────────────────────────────────────

async function fetchCompetitorKeywords(
  domain: string,
  apiKey: string,
): Promise<Array<{ keyword: string; position: number }>> {
  const response = await fetch(SERPER_API_URL, {
    method: 'POST',
    headers: {
      'X-API-KEY': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ q: `site:${domain}`, num: 20 }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Serper API error ${response.status}: ${body}`);
  }

  const data: SerperResponse = await response.json();
  const organic = data.organic ?? [];

  return organic
    .filter((r) => r.title)
    .map((r, idx) => ({
      keyword: r.title!.trim(),
      position: r.position ?? idx + 1,
    }));
}

async function fetchBacklinkCount(domain: string, apiKey: string): Promise<number> {
  const response = await fetch(SERPER_API_URL, {
    method: 'POST',
    headers: {
      'X-API-KEY': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ q: `link:${domain}`, num: 10 }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Serper API error ${response.status}: ${body}`);
  }

  const data: SerperResponse = await response.json();
  return (data.organic ?? []).length;
}

// ── Core logic ────────────────────────────────────────────────────────────────

async function runCompetitorMonitor(): Promise<void> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    throw new Error('SERPER_API_KEY environment variable is not set');
  }

  // 1. Fetch all active competitors
  const { data: competitors, error: compError } = await supabaseAdmin
    .from('competitors')
    .select('id, domain, name')
    .eq('is_active', true);

  if (compError) {
    throw new Error(`Failed to fetch competitors: ${compError.message}`);
  }

  if (!competitors || competitors.length === 0) {
    console.log('[competitor-monitor] No active competitors found.');
    return;
  }

  console.log(`[competitor-monitor] Monitoring ${competitors.length} competitor(s).`);

  // 2. Fetch our own unranked-opportunity keywords for alert comparison
  const { data: ourKeywords, error: kwError } = await supabaseAdmin
    .from('keywords')
    .select('keyword, status')
    .eq('status', 'unranked_opportunity');

  if (kwError) {
    console.error(`[competitor-monitor] Failed to fetch our keywords: ${kwError.message}`);
  }

  const unrankedOpportunitySet = new Set(
    ((ourKeywords ?? []) as OurKeyword[]).map((k) => k.keyword.toLowerCase()),
  );

  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  for (const competitor of competitors as Competitor[]) {
    try {
      // 3. Fetch competitor's top keyword proxies via Serper site: search
      const keywords = await fetchCompetitorKeywords(competitor.domain, apiKey);
      console.log(
        `[competitor-monitor] ${competitor.name} (${competitor.domain}): ` +
          `found ${keywords.length} keyword(s).`,
      );

      // 4. Upsert into competitor_keywords
      for (const { keyword, position } of keywords) {
        const { error: upsertError } = await supabaseAdmin
          .from('competitor_keywords')
          .upsert(
            {
              competitor_id: competitor.id,
              keyword,
              position,
              tracked_at: today,
            },
            { onConflict: 'competitor_id,keyword,tracked_at' },
          );

        if (upsertError) {
          console.error(
            `[competitor-monitor] Failed to upsert keyword "${keyword}" ` +
              `for ${competitor.domain}: ${upsertError.message}`,
          );
        }

        // 5. Alert if competitor targets a keyword we haven't ranked for yet
        if (unrankedOpportunitySet.has(keyword.toLowerCase())) {
          console.warn(
            `[competitor-monitor] ALERT: Competitor "${competitor.name}" (${competitor.domain}) ` +
              `is targeting unranked opportunity keyword: "${keyword}" at position ${position}`,
          );
        }
      }

      // 6. Check for significant new backlink growth (proxy via link: search count)
      const backlinkCount = await fetchBacklinkCount(competitor.domain, apiKey);

      if (backlinkCount >= 10) {
        console.warn(
          `[competitor-monitor] ALERT: Competitor "${competitor.name}" (${competitor.domain}) ` +
            `has ${backlinkCount} backlink result(s) detected this week — ` +
            `possible significant backlink growth (>= 10 results with potential DA >= 40).`,
        );
      }
    } catch (err) {
      console.error(
        `[competitor-monitor] Error processing competitor "${competitor.domain}":`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  console.log('[competitor-monitor] Monitor run complete.');
}

// ── Worker registration ───────────────────────────────────────────────────────

export async function registerCompetitorMonitorWorker(boss: PgBoss): Promise<void> {
  await boss.createQueue('competitor-monitor');
  await boss.schedule('competitor-monitor', COMPETITOR_MONITOR_CRON, {});

  await boss.work('competitor-monitor', async (_job) => {
    try {
      await runCompetitorMonitor();
    } catch (err) {
      console.error(
        '[competitor-monitor] Worker failed:',
        err instanceof Error ? err.message : String(err),
      );
      throw err;
    }
  });

  console.log('[competitor-monitor] Worker registered (cron: every Monday at 05:00 UTC).');
}
