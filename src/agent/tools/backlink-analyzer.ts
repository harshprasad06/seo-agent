import { supabaseAdmin } from '../../lib/supabase';

const SERPER_API_URL = 'https://google.serper.dev/search';

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

export interface OutreachOpportunity {
  id: string;
  source_domain: string;
  domain_authority: number | null;
  relevance_score: number | null;
  links_to_competitors: string[] | null;
  email_draft: string | null;
  status: string;
}

interface SerperOrganicResult {
  link: string;
  domain?: string;
}

interface SerperResponse {
  organic?: SerperOrganicResult[];
}

interface CompetitorRow {
  id: string;
  domain: string;
  name: string;
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

/**
 * Calculates relevance score (0.5–1.0) based on how many competitors
 * a domain links to. More competitors = higher relevance.
 */
function calcRelevanceScore(competitorCount: number, totalCompetitors: number): number {
  if (totalCompetitors === 0) return 0.5;
  // Scale from 0.5 (links to 1 competitor) to 1.0 (links to all competitors)
  return 0.5 + 0.5 * (competitorCount / totalCompetitors);
}

async function fetchCompetitorBacklinks(
  apiKey: string,
  competitorDomain: string,
): Promise<string[]> {
  const response = await fetch(SERPER_API_URL, {
    method: 'POST',
    headers: {
      'X-API-KEY': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ q: `link:${competitorDomain}`, num: 10 }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Serper API error ${response.status} for ${competitorDomain}: ${body}`);
  }

  const data: SerperResponse = await response.json();
  const organic = data.organic ?? [];

  return organic.map((result) => result.domain ?? extractDomain(result.link));
}

// ── Core logic ────────────────────────────────────────────────────────────────

/**
 * Analyzes backlinks to identify outreach opportunities:
 * domains that link to competitors but not to goodads.ai.
 *
 * Validates: Requirements 6.3, 6.4
 */
export async function analyzeBacklinks(): Promise<OutreachOpportunity[]> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    throw new Error('SERPER_API_KEY environment variable is not set');
  }

  // 1. Fetch active backlinks for goodads.ai
  const { data: ownBacklinks, error: ownError } = await supabaseAdmin
    .from('backlinks')
    .select('source_domain')
    .eq('status', 'active');

  if (ownError) {
    throw new Error(`Failed to fetch own backlinks: ${ownError.message}`);
  }

  const ownDomains = new Set<string>(
    (ownBacklinks ?? []).map((row: { source_domain: string }) => row.source_domain),
  );

  // 2. Fetch active competitors
  const { data: competitors, error: compError } = await supabaseAdmin
    .from('competitors')
    .select('id, domain, name')
    .eq('is_active', true);

  if (compError) {
    throw new Error(`Failed to fetch competitors: ${compError.message}`);
  }

  const activeCompetitors = (competitors ?? []) as CompetitorRow[];

  if (activeCompetitors.length === 0) {
    return [];
  }

  // 3. Fetch competitor backlinks via Serper and build domain → competitor[] map
  const domainToCompetitors = new Map<string, string[]>();

  for (const competitor of activeCompetitors) {
    let domains: string[];
    try {
      domains = await fetchCompetitorBacklinks(apiKey, competitor.domain);
    } catch (err) {
      console.error(
        `[backlink-analyzer] Failed to fetch backlinks for ${competitor.domain}:`,
        err instanceof Error ? err.message : String(err),
      );
      continue;
    }

    for (const domain of domains) {
      if (!domainToCompetitors.has(domain)) {
        domainToCompetitors.set(domain, []);
      }
      const existing = domainToCompetitors.get(domain)!;
      if (!existing.includes(competitor.domain)) {
        existing.push(competitor.domain);
      }
    }
  }

  // 4. Find opportunity domains: link to competitors but NOT to goodads.ai
  const opportunities: {
    source_domain: string;
    domain_authority: number;
    relevance_score: number;
    links_to_competitors: string[];
  }[] = [];

  for (const [domain, linkedCompetitors] of Array.from(domainToCompetitors.entries())) {
    if (ownDomains.has(domain)) continue;

    opportunities.push({
      source_domain: domain,
      domain_authority: getDomainAuthority(domain),
      relevance_score: calcRelevanceScore(linkedCompetitors.length, activeCompetitors.length),
      links_to_competitors: linkedCompetitors,
    });
  }

  // 5. Upsert into outreach_opportunities table
  for (const opp of opportunities) {
    const { error } = await supabaseAdmin.from('outreach_opportunities').upsert(
      {
        source_domain: opp.source_domain,
        domain_authority: opp.domain_authority,
        relevance_score: opp.relevance_score,
        links_to_competitors: opp.links_to_competitors,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'source_domain' },
    );

    if (error) {
      console.error(
        `[backlink-analyzer] Failed to upsert opportunity for ${opp.source_domain}: ${error.message}`,
      );
    }
  }

  // 6. Sort by domain_authority DESC, relevance_score DESC as tiebreaker
  opportunities.sort((a, b) => {
    if (b.domain_authority !== a.domain_authority) {
      return b.domain_authority - a.domain_authority;
    }
    return b.relevance_score - a.relevance_score;
  });

  // 7. Return top 20 — fetch from DB to include id, email_draft, status
  const top20Domains = opportunities.slice(0, 20).map((o) => o.source_domain);

  if (top20Domains.length === 0) {
    return [];
  }

  const { data: rows, error: fetchError } = await supabaseAdmin
    .from('outreach_opportunities')
    .select('id, source_domain, domain_authority, relevance_score, links_to_competitors, email_draft, status')
    .in('source_domain', top20Domains);

  if (fetchError) {
    throw new Error(`Failed to fetch upserted opportunities: ${fetchError.message}`);
  }

  // Re-sort to match our computed order (DB may return in any order)
  const domainOrder = new Map(top20Domains.map((d, i) => [d, i]));
  const result = ((rows ?? []) as OutreachOpportunity[]).sort(
    (a, b) => (domainOrder.get(a.source_domain) ?? 99) - (domainOrder.get(b.source_domain) ?? 99),
  );

  console.log(`[backlink-analyzer] Found ${result.length} outreach opportunities.`);
  return result;
}
