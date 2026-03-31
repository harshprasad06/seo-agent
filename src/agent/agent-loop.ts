/**
 * Real Agent Loop — ReAct (Reason + Act) pattern.
 *
 * The LLM observes the current SEO state, reasons about what to do next,
 * picks a tool, executes it, observes the result, and repeats until done.
 *
 * Loop: OBSERVE → THINK → ACT → OBSERVE → THINK → ACT → ... → DONE
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { supabaseAdmin } from '../lib/supabase';

// ── Tool definitions ──────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'crawl_site',
    description: 'Crawl all pages on the site, detect on-page issues (missing H1, meta, title), create recommendations',
  },
  {
    name: 'track_keywords',
    description: 'Check live Google rankings for all tracked keywords via Serper',
  },
  {
    name: 'discover_keywords',
    description: 'Find new keyword opportunities from GSC search query data',
  },
  {
    name: 'sync_backlinks',
    description: 'Fetch backlinks via Serper link: search, detect lost high-DA links',
  },
  {
    name: 'audit_cro',
    description: 'Score pages for CTA presence, social proof, trust signals — create CRO recommendations',
  },
  {
    name: 'optimize_ctr',
    description: 'Find pages with high impressions but low CTR in GSC, generate better title/meta suggestions',
  },
  {
    name: 'monitor_competitors',
    description: 'Track competitor keyword rankings and detect new threats',
  },
  {
    name: 'find_outreach_prospects',
    description: 'Find link-building prospects by searching who links to competitors',
  },
  {
    name: 'audit_pagespeed',
    description: 'Fetch Core Web Vitals (LCP, INP, CLS) for all pages via PageSpeed Insights',
  },
  {
    name: 'generate_blog',
    description: 'Generate AI blog post drafts targeting high-opportunity keywords',
  },
  {
    name: 'sync_gsc',
    description: 'Sync Google Search Console data (clicks, impressions, CTR, position)',
  },
  {
    name: 'sync_ga4',
    description: 'Sync Google Analytics 4 organic traffic data',
  },
  {
    name: 'done',
    description: 'All important tasks are complete for this run',
  },
] as const;

type ToolName = typeof TOOLS[number]['name'];

// ── State observation ─────────────────────────────────────────────────────────

async function observeState(): Promise<string> {
  const [
    { data: keywords },
    { data: pendingRecs },
    { data: pages },
    { data: backlinks },
    { data: gscData },
    { data: cwvData },
    { data: blogDrafts },
  ] = await Promise.all([
    supabaseAdmin.from('keywords').select('keyword, current_position, status').eq('is_tracked', true),
    supabaseAdmin.from('recommendations').select('type, priority').eq('status', 'pending').order('priority', { ascending: false }).limit(10),
    supabaseAdmin.from('pages').select('url, http_status, h1, title_tag').limit(20),
    supabaseAdmin.from('backlinks').select('status').eq('status', 'active'),
    supabaseAdmin.from('gsc_data_points').select('query, impressions, position').gte('impressions', 20).order('impressions', { ascending: false }).limit(10),
    supabaseAdmin.from('cwv_results').select('lcp_ms, lcp_rating').order('measured_at', { ascending: false }).limit(5),
    supabaseAdmin.from('blog_posts').select('status').eq('status', 'draft'),
  ]);

  const kwList = (keywords as any[] ?? []).map((k: any) =>
    `${k.keyword}: pos=${k.current_position ?? 'unranked'} (${k.status})`
  ).join(', ');

  const recList = (pendingRecs as any[] ?? []).slice(0, 5).map((r: any) =>
    `${r.type} (priority ${r.priority})`
  ).join(', ');

  const pagesWithIssues = (pages as any[] ?? []).filter((p: any) => !p.h1 || !p.title_tag).length;
  const activeBacklinks = (backlinks as any[] ?? []).length;
  const gscQueries = (gscData as any[] ?? []).length;
  const slowPages = (cwvData as any[] ?? []).filter((c: any) => c.lcp_rating === 'SLOW').length;
  const draftCount = (blogDrafts as any[] ?? []).length;

  return `
CURRENT SEO STATE:
- Tracked keywords: ${(keywords as any[] ?? []).length} (${kwList || 'none'})
- Pending recommendations: ${(pendingRecs as any[] ?? []).length} (${recList || 'none'})
- Pages with missing H1 or title: ${pagesWithIssues}
- Active backlinks: ${activeBacklinks}
- GSC queries available: ${gscQueries}
- Slow pages (LCP): ${slowPages}
- Blog drafts pending review: ${draftCount}
`.trim();
}

// ── LLM reasoning ─────────────────────────────────────────────────────────────

async function think(
  state: string,
  history: Array<{ tool: string; result: string }>,
  iteration: number,
): Promise<{ tool: ToolName; reasoning: string }> {
  const geminiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GEMINI_API_KEY ?? '';
  const groqKey = process.env.GROQ_API_KEY ?? '';

  const toolList = TOOLS.map(t => `- ${t.name}: ${t.description}`).join('\n');
  const historyText = history.length > 0
    ? '\nACTIONS TAKEN THIS RUN:\n' + history.map(h => `- ${h.tool}: ${h.result}`).join('\n')
    : '';

  const siteName = process.env.SITE_NAME ?? new URL(process.env.SITE_URL ?? 'https://example.com').hostname.replace(/^www\./, '');
  const siteDesc = process.env.SITE_DESCRIPTION ?? 'a website';

  const prompt = `You are an autonomous SEO agent for ${siteName}.

Your goal: Improve SEO performance by taking the most impactful actions.

${state}
${historyText}

AVAILABLE TOOLS:
${toolList}

RULES:
- Pick the single most impactful tool to run next
- Don't repeat a tool you already ran this session (unless state changed significantly)
- If all critical tasks are done, use "done"
- Prioritize: crawl_site > track_keywords > sync_backlinks > audit_cro > generate_blog > done

Respond in this exact JSON format:
{"tool": "tool_name", "reasoning": "one sentence why"}`;

  // Try Gemini first
  if (geminiKey) {
    try {
      const genAI = new GoogleGenerativeAI(geminiKey);
      const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
      const result = await model.generateContent(prompt);
      const text = result.response.text().trim()
        .replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
      const parsed = JSON.parse(text);
      return { tool: parsed.tool as ToolName, reasoning: parsed.reasoning };
    } catch (err: any) {
      if (!err.message?.includes('429') && !err.message?.includes('quota')) throw err;
    }
  }

  // Groq fallback
  if (groqKey) {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        response_format: { type: 'json_object' },
      }),
    });
    if (res.ok) {
      const json: any = await res.json();
      const parsed = JSON.parse(json.choices?.[0]?.message?.content ?? '{}');
      return { tool: parsed.tool as ToolName, reasoning: parsed.reasoning };
    }
  }

  // Fallback: sequential default order
  const defaultOrder: ToolName[] = [
    'crawl_site', 'track_keywords', 'sync_backlinks',
    'monitor_competitors', 'audit_cro', 'audit_pagespeed', 'generate_blog', 'done',
  ];
  const alreadyRan = new Set(history.map(h => h.tool));
  const next = defaultOrder.find(t => !alreadyRan.has(t)) ?? 'done';
  return { tool: next, reasoning: 'Fallback sequential order (AI unavailable)' };
}

// ── Tool executor ─────────────────────────────────────────────────────────────

async function executeTool(tool: ToolName): Promise<string> {
  switch (tool) {
    case 'crawl_site': {
      const { runFullSiteCrawlDirect } = await import('../workers/site-crawl-direct');
      const { pagesFound, recommendations } = await runFullSiteCrawlDirect();
      return `Crawled ${pagesFound} pages, created ${recommendations} recommendations`;
    }
    case 'track_keywords': {
      const { runKeywordTrackerDirect } = await import('../workers/keyword-tracker-direct');
      const count = await runKeywordTrackerDirect();
      return `Updated positions for ${count} keywords`;
    }
    case 'discover_keywords': {
      const { runKeywordDiscovery } = await import('./tools/keyword-discovery');
      const count = await runKeywordDiscovery();
      return `Discovered ${count} new keyword opportunities`;
    }
    case 'sync_backlinks': {
      const { runBacklinkSync } = await import('../workers/backlink-sync');
      await runBacklinkSync();
      return 'Backlinks synced';
    }
    case 'audit_cro': {
      const { runCROAudit } = await import('./tools/cro-auditor');
      const count = await runCROAudit();
      return `Created ${count} CRO recommendations`;
    }
    case 'optimize_ctr': {
      const { runCTROptimizer } = await import('./tools/ctr-optimizer');
      const count = await runCTROptimizer();
      return `Created ${count} CTR improvement recommendations`;
    }
    case 'monitor_competitors': {
      const { runCompetitorMonitorDirect } = await import('../workers/competitor-monitor-direct');
      const count = await runCompetitorMonitorDirect();
      return `Monitored ${count} competitors`;
    }
    case 'find_outreach_prospects': {
      const { runOutreachProspector } = await import('./tools/outreach-prospector');
      const count = await runOutreachProspector();
      return `Found ${count} new outreach prospects`;
    }
    case 'audit_pagespeed': {
      const { runPageSpeedAuditDirect } = await import('../workers/pagespeed-audit-direct');
      const count = await runPageSpeedAuditDirect();
      return `Audited ${count} pages for Core Web Vitals`;
    }
    case 'generate_blog': {
      const { autoGenerateBlogDrafts } = await import('./tools/blog-writer');
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      const { data: todayBlogs } = await supabaseAdmin.from('blog_posts').select('id').gte('created_at', todayStart.toISOString());
      const remaining = 3 - ((todayBlogs as any[])?.length ?? 0);
      if (remaining <= 0) return 'Daily blog limit reached (3/3)';
      const ids = await autoGenerateBlogDrafts(remaining);
      return `Generated ${ids.length} blog draft(s)`;
    }
    case 'sync_gsc': {
      const { data: token } = await supabaseAdmin.from('oauth_tokens').select('provider').eq('provider', 'gsc').single();
      if (!token) return 'No GSC token — connect Google in Settings';
      // GSC sync runs via pg-boss in background
      return 'GSC sync queued';
    }
    case 'sync_ga4': {
      if (!process.env.GA4_PROPERTY_ID) return 'GA4_PROPERTY_ID not set';
      const { runGaSyncDirect } = await import('../workers/ga-sync-direct');
      const rows = await runGaSyncDirect();
      return `Synced ${rows} GA4 rows`;
    }
    case 'done':
      return 'All tasks complete';
    default:
      return `Unknown tool: ${tool}`;
  }
}

// ── Main agent loop ───────────────────────────────────────────────────────────

export interface AgentLoopOptions {
  maxIterations?: number;
  onStep?: (step: { iteration: number; tool: string; reasoning: string; result: string }) => void;
}

export async function runAgentLoop(options: AgentLoopOptions = {}): Promise<void> {
  const { maxIterations = 10, onStep } = options;
  const history: Array<{ tool: string; result: string }> = [];

  console.log('[agent-loop] Starting ReAct agent loop...');

  for (let i = 0; i < maxIterations; i++) {
    // 1. OBSERVE
    const state = await observeState();

    // 2. THINK
    const { tool, reasoning } = await think(state, history, i);
    console.log(`[agent-loop] Iteration ${i + 1}: ${tool} — ${reasoning}`);

    if (tool === 'done') {
      onStep?.({ iteration: i + 1, tool: 'done', reasoning, result: 'Agent completed all tasks' });
      break;
    }

    // 3. ACT
    let result: string;
    try {
      result = await executeTool(tool);
    } catch (err: any) {
      result = `Error: ${err.message}`;
    }

    console.log(`[agent-loop] ${tool} → ${result}`);
    history.push({ tool, result });
    onStep?.({ iteration: i + 1, tool, reasoning, result });

    // Small delay between iterations to avoid rate limits
    await new Promise(r => setTimeout(r, 500));
  }

  console.log('[agent-loop] Loop complete.');
}
