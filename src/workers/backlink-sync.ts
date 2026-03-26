import PgBoss from 'pg-boss';
import { supabaseAdmin } from '../lib/supabase';

const SERPER_API_URL = 'https://google.serper.dev/search';
const TARGET_DOMAIN = process.env.SITE_URL
  ? new URL(process.env.SITE_URL).hostname.replace(/^www\./, '')
  : 'learnwealthx.in';

// Cron: bi-weekly — 04:00 on the 1st and 15th of every month
const BACKLINK_SYNC_CRON = '0 4 1,15 * *';

// Known high-authority domains → DA 80, everything else → DA 50
const HIGH_DA_DOMAINS = new Set([
  'google.com',
  'github.com',
  'reddit.com',
  'medium.com',
  'youtube.com',
  'twitter.com',
  'x.com',
  'linkedin.com',
  'stackoverflow.com',
  'wikipedia.org',
  'forbes.com',
  'techcrunch.com',
  'producthunt.com',
  'hackernews.com',
  'news.ycombinator.com',
  'dev.to',
  'substack.com',
]);

// ── Types ─────────────────────────────────────────────────────────────────────

interface SerperOrganicResult {
  link: string;
  domain?: string;
  title?: string;
  snippet?: string;
}

interface SerperResponse {
  organic?: SerperOrganicResult[];
}

interface BacklinkRecord {
  source_url: string;
  source_domain: string;
  anchor_text: string;
  domain_authority: number;
}

interface DbBacklink {
  id: string;
  source_url: string;
  source_domain: string;
  domain_authority: number | null;
  status: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function getDomainAuthority(domain: string): number {
  const normalized = domain.replace(/^www\./, '');
  return HIGH_DA_DOMAINS.has(normalized) ? 80 : 50;
}

// ── Serper fetch ──────────────────────────────────────────────────────────────

async function fetchBacklinksFromSerper(apiKey: string): Promise<BacklinkRecord[]> {
  const response = await fetch(SERPER_API_URL, {
    method: 'POST',
    headers: {
      'X-API-KEY': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ q: `link:${TARGET_DOMAIN}`, num: 10 }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Serper API error ${response.status}: ${body}`);
  }

  const data: SerperResponse = await response.json();
  const organic = data.organic ?? [];

  return organic.map((result) => {
    const source_url = result.link;
    const source_domain = result.domain ?? extractDomain(source_url);
    const anchor_text = result.title ?? source_url;
    const domain_authority = getDomainAuthority(source_domain);

    return { source_url, source_domain, anchor_text, domain_authority };
  });
}

// ── Core sync logic ───────────────────────────────────────────────────────────

async function runBacklinkSync(): Promise<void> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    throw new Error('SERPER_API_KEY environment variable is not set');
  }

  const targetUrl = `https://${TARGET_DOMAIN}/`;
  const now = new Date().toISOString();

  // 1. Fetch fresh backlinks from Serper
  const freshLinks = await fetchBacklinksFromSerper(apiKey);
  console.log(`[backlink-sync] Found ${freshLinks.length} backlink(s) via Serper.`);

  const freshUrls = new Set(freshLinks.map((l) => l.source_url));

  // 2. Fetch existing backlinks from DB
  const { data: existing, error: fetchError } = await supabaseAdmin
    .from('backlinks')
    .select('id, source_url, source_domain, domain_authority, status')
    .eq('target_url', targetUrl);

  if (fetchError) {
    throw new Error(`Failed to fetch existing backlinks: ${fetchError.message}`);
  }

  const existingLinks = (existing ?? []) as DbBacklink[];
  const existingByUrl = new Map(existingLinks.map((l) => [l.source_url, l]));

  // 3. Mark lost links (in DB but not in fresh results)
  const lostLinks = existingLinks.filter(
    (l) => l.status === 'active' && !freshUrls.has(l.source_url),
  );

  for (const lost of lostLinks) {
    const { error } = await supabaseAdmin
      .from('backlinks')
      .update({ status: 'lost', lost_at: now })
      .eq('id', lost.id);

    if (error) {
      console.error(
        `[backlink-sync] Failed to mark link as lost (${lost.source_url}): ${error.message}`,
      );
      continue;
    }

    // Alert for high-DA lost links
    const da = lost.domain_authority ?? 0;
    if (da >= 40) {
      console.warn(
        `[backlink-sync] ALERT: High-DA backlink lost! ` +
          `source=${lost.source_url} domain=${lost.source_domain} DA=${da}`,
      );
    }
  }

  // 4. Insert new links / update last_seen_at for existing ones
  for (const link of freshLinks) {
    const existing = existingByUrl.get(link.source_url);

    if (!existing) {
      // New backlink — insert
      const { error } = await supabaseAdmin.from('backlinks').insert({
        source_domain: link.source_domain,
        source_url: link.source_url,
        target_url: targetUrl,
        anchor_text: link.anchor_text,
        domain_authority: link.domain_authority,
        status: 'active',
        first_seen_at: now,
        last_seen_at: now,
      });

      if (error) {
        console.error(
          `[backlink-sync] Failed to insert backlink (${link.source_url}): ${error.message}`,
        );
      }
    } else {
      // Existing link — refresh last_seen_at (and re-activate if it was lost)
      const update: Record<string, unknown> = { last_seen_at: now };
      if (existing.status === 'lost') {
        update.status = 'active';
        update.lost_at = null;
      }

      const { error } = await supabaseAdmin
        .from('backlinks')
        .update(update)
        .eq('id', existing.id);

      if (error) {
        console.error(
          `[backlink-sync] Failed to update backlink (${link.source_url}): ${error.message}`,
        );
      }
    }
  }

  console.log(
    `[backlink-sync] Sync complete. ` +
      `new=${freshLinks.filter((l) => !existingByUrl.has(l.source_url)).length} ` +
      `lost=${lostLinks.length} ` +
      `updated=${freshLinks.filter((l) => existingByUrl.has(l.source_url)).length}`,
  );
}

// ── Worker registration ───────────────────────────────────────────────────────

export { runBacklinkSync };

export async function registerBacklinkSyncWorker(boss: PgBoss): Promise<void> {
  await boss.createQueue('backlink-sync');
  await boss.schedule('backlink-sync', BACKLINK_SYNC_CRON, {});

  await boss.work('backlink-sync', async (_job) => {
    try {
      await runBacklinkSync();
    } catch (err) {
      console.error(
        '[backlink-sync] Worker failed:',
        err instanceof Error ? err.message : String(err),
      );
      throw err;
    }
  });

  console.log('[backlink-sync] Worker registered (cron: bi-weekly).');
}
