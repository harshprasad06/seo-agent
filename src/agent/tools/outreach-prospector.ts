/**
 * Outreach Prospector — finds link-building prospects via:
 * 1. Niche-specific searches for sites that cover your topic
 * 2. Guest post opportunity searches
 * 3. Competitor backlink searches (when competitors have enough authority)
 */

import { supabaseAdmin } from '../../lib/supabase';

const SERPER_URL = 'https://google.serper.dev/search';

const MEGA_DOMAINS = new Set([
  'youtube.com', 'instagram.com', 'facebook.com', 'twitter.com', 'x.com',
  'tiktok.com', 'linkedin.com', 'reddit.com', 'wikipedia.org', 'quora.com',
  'github.com', 'stackoverflow.com', 'google.com', 'amazon.com', 'flipkart.com',
  'zerodha.com', 'groww.in', 'nseindia.com', 'bseindia.com', 'angelone.in',
  'moneycontrol.com', 'economictimes.com', 'ndtv.com', 'timesofindia.com',
  'play.google.com', 'apps.apple.com', 'shopify.com', 'salesforce.com',
  'scribd.com', 'medium.com', 'forbes.com',
]);

// Government, academic, and research domains — they don't link to commercial sites
function isNonLinkable(domain: string): boolean {
  return (
    domain.endsWith('.gov.in') ||
    domain.endsWith('.ac.in') ||
    domain.endsWith('.edu.in') ||
    domain.endsWith('.gov') ||
    domain.endsWith('.edu') ||
    domain.endsWith('.nic.in') ||
    domain.includes('ncbi.nlm.nih') ||
    domain.includes('tumblr.com') ||
    domain.includes('amebaownd.com') ||
    domain.includes('blogspot.com') ||
    /^xn--/.test(domain) // punycode/non-latin domains
  );
}

function extractDomain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

function estimateDA(domain: string): number {
  const highDA = new Set(['forbes.com', 'techcrunch.com', 'producthunt.com', 'dev.to', 'entrepreneur.com', 'inc.com']);
  if (highDA.has(domain)) return 75;
  if (domain.endsWith('.edu') || domain.endsWith('.gov')) return 70;
  if (domain.endsWith('.org')) return 55;
  return 40;
}

async function findContactEmail(domain: string): Promise<{ email: string | null; contactUrl: string | null }> {
  const pagesToTry = [
    `https://${domain}/contact`,
    `https://${domain}/contact-us`,
    `https://${domain}/about`,
    `https://www.${domain}/contact`,
  ];

  const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  const skipPatterns = /\.(png|jpg|gif|svg|css|js)@|@sentry|@example|noreply@|no-reply@|@2x|@3x/i;

  for (const url of pagesToTry) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(6000),
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SEOAgent/1.0)' },
      });
      if (!res.ok) continue;
      const html = await res.text();
      const decoded = html.replace(/&#64;/g, '@').replace(/&#x40;/g, '@');
      const matches = decoded.match(emailRegex) ?? [];
      const valid = matches.find(e => !skipPatterns.test(e) && e.includes(domain.split('.')[0]));
      const fallback = matches.find(e => !skipPatterns.test(e));
      const email = valid ?? fallback ?? null;
      // Return the contact page URL even if no email found
      const contactUrl = url;
      return { email, contactUrl };
    } catch {}
  }
  return { email: null, contactUrl: `https://${domain}/contact` };
}

async function serperSearch(q: string, apiKey: string): Promise<any[]> {
  try {
    const res = await fetch(SERPER_URL, {
      method: 'POST',
      headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q, num: 10 }),
    });
    if (!res.ok) return [];
    const json: any = await res.json();
    return json.organic ?? [];
  } catch {
    return [];
  }
}

export async function runOutreachProspector(): Promise<number> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) throw new Error('SERPER_API_KEY not set');

  const siteUrl = process.env.SITE_URL ?? '';
  const ownDomain = siteUrl ? new URL(siteUrl).hostname.replace(/^www\./, '') : '';

  // Get existing prospects to avoid duplicates
  const { data: existing } = await supabaseAdmin
    .from('outreach_opportunities').select('source_domain');
  const existingDomains = new Set(((existing ?? []) as any[]).map((o: any) => o.source_domain));

  // Get active competitors for link: searches
  const { data: competitors } = await supabaseAdmin
    .from('competitors').select('domain').eq('is_active', true);
  const competitorDomains = ((competitors ?? []) as any[]).map((c: any) => c.domain);

  const prospects: Record<string, {
    domain: string;
    linksToCompetitors: string[];
    relevance: number;
  }> = {};

  const addProspect = (domain: string, relevance: number, competitorLinked?: string) => {
    if (domain === ownDomain || MEGA_DOMAINS.has(domain) || existingDomains.has(domain)) return;
    if (isNonLinkable(domain)) return;
    if (!prospects[domain]) {
      prospects[domain] = { domain, linksToCompetitors: [], relevance };
    }
    if (competitorLinked && !prospects[domain].linksToCompetitors.includes(competitorLinked)) {
      prospects[domain].linksToCompetitors.push(competitorLinked);
      prospects[domain].relevance = Math.min(0.99, prospects[domain].relevance + 0.15);
    }
  };

  // 1. Niche content sites — always returns results
  const nicheQueries = [
    'best online course platforms india blog',
    'affiliate marketing india blog site',
    'online education india resources',
    'earn money online india courses blog',
    'digital skills india learning platform review',
  ];

  for (const q of nicheQueries) {
    const results = await serperSearch(q, apiKey);
    for (const r of results) {
      addProspect(extractDomain(r.link), 0.55);
    }
  }

  // 2. Guest post opportunities
  const guestPostQueries = [
    '"write for us" online education india',
    '"guest post" affiliate marketing india',
    '"submit a post" online courses india',
    '"contribute" digital learning india',
  ];

  for (const q of guestPostQueries) {
    const results = await serperSearch(q, apiKey);
    for (const r of results) {
      addProspect(extractDomain(r.link), 0.75);
    }
  }

  // 3. Competitor backlinks (only for non-gov/non-tiny domains)
  for (const domain of competitorDomains.slice(0, 3)) {
    const results = await serperSearch(`link:${domain}`, apiKey);
    for (const r of results) {
      addProspect(extractDomain(r.link), 0.65, domain);
    }
  }

  // 4. Resource pages in niche
  const resourceQueries = [
    'online course resources india inurl:resources',
    'affiliate marketing tools india inurl:links',
  ];
  for (const q of resourceQueries) {
    const results = await serperSearch(q, apiKey);
    for (const r of results) {
      addProspect(extractDomain(r.link), 0.6);
    }
  }

  // Upsert into DB
  let inserted = 0;
  for (const [domain, p] of Object.entries(prospects)) {
    // Try to find contact email + contact page URL
    const { email: contactEmail, contactUrl } = await findContactEmail(domain);

    const { error } = await supabaseAdmin
      .from('outreach_opportunities')
      .upsert({
        source_domain: domain,
        domain_authority: estimateDA(domain),
        relevance_score: p.relevance,
        links_to_competitors: p.linksToCompetitors,
        contact_email: contactEmail,
        email_draft: contactUrl ? `Contact page: ${contactUrl}` : null,
        status: 'not_contacted',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'source_domain' });

    if (!error) inserted++;
    else console.error(`[outreach-prospector] upsert failed for ${domain}: ${error.message}`);
  }

  console.log(`[outreach-prospector] Upserted ${inserted} prospect(s) from ${Object.keys(prospects).length} found`);
  return inserted;
}
