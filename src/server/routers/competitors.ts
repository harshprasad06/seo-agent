import { z } from 'zod';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { router, protectedProcedure } from '../trpc';

/**
 * tRPC router for competitor tracking.
 * Validates: Requirement 7.3
 */
export const competitorsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const { data, error } = await ctx.db
      .from('competitors')
      .select('*')
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (error) throw new Error(`Failed to fetch competitors: ${error.message}`);
    return data ?? [];
  }),

  keywords: protectedProcedure
    .input(z.object({ competitor_id: z.string() }))
    .query(async ({ ctx, input }) => {
      const { data, error } = await ctx.db
        .from('competitor_keywords')
        .select('*')
        .eq('competitor_id', input.competitor_id)
        .order('position', { ascending: true });

      if (error) throw new Error(`Failed to fetch competitor keywords: ${error.message}`);
      return data ?? [];
    }),

  /**
   * Step 1: Fetch the site, build an AI summary of what it does,
   * then generate targeted search queries to find real competitors.
   */
  analyzeSite: protectedProcedure.mutation(async () => {
    const siteUrl = process.env.SITE_URL ?? '';
    if (!siteUrl) throw new Error('SITE_URL not set');

    const geminiKey = process.env.GOOGLE_GEMINI_API_KEY ?? process.env.GEMINI_API_KEY ?? '';
    if (!geminiKey) throw new Error('GOOGLE_GEMINI_API_KEY not set');

    // Fetch homepage + /about if available
    const pagesToFetch = [siteUrl, `${siteUrl.replace(/\/$/, '')}/about`];
    let rawText = '';

    for (const url of pagesToFetch) {
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SEOAgent/1.0)' },
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) continue;
        const html = await res.text();
        // Strip HTML tags, collapse whitespace
        const text = html
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 4000);
        rawText += `\n\n--- ${url} ---\n${text}`;
      } catch {}
    }

    if (!rawText.trim()) throw new Error('Could not fetch site content');

    const prompt = `You are an SEO analyst. Analyze this website content and return a JSON object.

Website content:
${rawText}

Return ONLY valid JSON (no markdown, no explanation) with this exact structure:
{
  "businessType": "one line — what type of business this is",
  "whatTheyDo": "2-3 sentences describing what the site does",
  "businessModel": "how they make money",
  "targetAudience": "who their customers are",
  "uniqueValueProp": "what makes them different",
  "niche": "the specific niche/industry",
  "searchQueries": [
    "5 to 8 highly specific Google search queries to find direct competitors",
    "each query should be specific to their exact business model and niche",
    "avoid generic terms, focus on what makes this site unique"
  ]
}`;

    // Try Gemini first, fall back to Groq
    let text = '';
    try {
      const genAI = new GoogleGenerativeAI(geminiKey);
      const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
      const result = await model.generateContent(prompt);
      text = result.response.text().trim();
    } catch (geminiErr: any) {
      if (!geminiErr.message?.includes('429') && !geminiErr.message?.includes('quota')) throw geminiErr;
      // Quota exceeded — fall back to Groq
      const groqKey = process.env.GROQ_API_KEY;
      if (!groqKey) throw new Error('Gemini quota exceeded and GROQ_API_KEY not set');
      const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama-3.1-8b-instant',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.3,
        }),
      });
      if (!groqRes.ok) throw new Error(`Groq error: ${await groqRes.text()}`);
      const groqJson: any = await groqRes.json();
      text = groqJson.choices?.[0]?.message?.content?.trim() ?? '';
    }

    // Parse JSON — strip markdown fences if present
    const jsonStr = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
    const summary = JSON.parse(jsonStr);

    return summary as {
      businessType: string;
      whatTheyDo: string;
      businessModel: string;
      targetAudience: string;
      uniqueValueProp: string;
      niche: string;
      searchQueries: string[];
    };
  }),

  /**
   * Step 2: Use the AI-generated queries + related: lookups to find competitors.
   */
  discover: protectedProcedure
    .input(z.object({
      searchQueries: z.array(z.string()),
      seeds: z.array(z.string()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const apiKey = process.env.SERPER_API_KEY;
      if (!apiKey) throw new Error('SERPER_API_KEY not set');

      const siteUrl = process.env.SITE_URL ?? '';
      const ownDomain = siteUrl ? new URL(siteUrl).hostname.replace(/^www\./, '') : '';

      const MEGA_DOMAINS = new Set([
        'youtube.com', 'instagram.com', 'facebook.com', 'twitter.com', 'x.com',
        'tiktok.com', 'linkedin.com', 'reddit.com', 'wikipedia.org', 'quora.com',
        'medium.com', 'substack.com', 'github.com', 'stackoverflow.com',
        'google.com', 'amazon.com', 'flipkart.com', 'snapdeal.com',
        'zerodha.com', 'groww.in', 'nseindia.com', 'bseindia.com', 'angelone.in',
        'moneycontrol.com', 'economictimes.com', 'livemint.com', 'ndtv.com',
        'timesofindia.com', 'hindustantimes.com',
      ]);

      const { data: existing } = await ctx.db.from('competitors').select('domain');
      const existingDomains = new Set(((existing ?? []) as any[]).map((c: any) => c.domain));

      const seeds = input.seeds ?? [];

      // Build weighted query list
      const queries: Array<{ q: string; weight: number }> = [
        { q: `related:${ownDomain}`, weight: 3 },
        ...seeds.map(s => ({ q: `related:${s}`, weight: 3 })),
        ...input.searchQueries.map(q => ({ q, weight: 2 })),
      ];

      const domainScores: Record<string, {
        count: number;
        name: string;
        queries: string[];
        relatedHit: boolean;
        weightedScore: number;
      }> = {};

      for (const { q, weight } of queries) {
        const res = await fetch('https://google.serper.dev/search', {
          method: 'POST',
          headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ q, num: 10 }),
        });
        if (!res.ok) continue;
        const json: any = await res.json();

        for (const result of json.organic ?? []) {
          try {
            const domain = new URL(result.link).hostname.replace(/^www\./, '');
            if (domain === ownDomain) continue;
            if (existingDomains.has(domain)) continue;
            if (MEGA_DOMAINS.has(domain)) continue;
            if (seeds.some(s => s.replace(/^www\./, '') === domain)) continue;
            if (!domainScores[domain]) {
              domainScores[domain] = { count: 0, name: result.title ?? domain, queries: [], relatedHit: false, weightedScore: 0 };
            }
            domainScores[domain].count++;
            domainScores[domain].weightedScore += weight;
            if (!domainScores[domain].queries.includes(q)) {
              domainScores[domain].queries.push(q);
            }
            if (q.startsWith('related:')) {
              domainScores[domain].relatedHit = true;
            }
          } catch {}
        }
      }

      const maxWeighted = Math.max(1, ...Object.values(domainScores).map(d => d.weightedScore));

      const scored = Object.entries(domainScores).map(([domain, d]) => {
        const score = Math.round((d.relatedHit ? 40 : 0) + (d.weightedScore / maxWeighted) * 60);
        return { domain, name: d.name, count: d.count, queries: d.queries, score };
      });

      return scored.sort((a, b) => b.score - a.score).slice(0, 10);
    }),

  add: protectedProcedure
    .input(z.object({ domain: z.string(), name: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.db
        .from('competitors')
        .upsert({ domain: input.domain, name: input.name, is_active: true }, { onConflict: 'domain' })
        .select()
        .single();

      if (error) throw new Error(`Failed to add competitor: ${error.message}`);
      return data;
    }),

  remove: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { error: kwError } = await ctx.db
        .from('competitor_keywords')
        .delete()
        .eq('competitor_id', input.id);

      if (kwError) throw new Error(`Failed to remove competitor keywords: ${kwError.message}`);

      const { error } = await ctx.db
        .from('competitors')
        .delete()
        .eq('id', input.id);

      if (error) throw new Error(`Failed to remove competitor: ${error.message}`);
      return { success: true };
    }),
});
