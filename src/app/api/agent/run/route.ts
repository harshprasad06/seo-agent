/**
 * POST /api/agent/run
 * Starts the SEO agent.
 * mode=pipeline (default): hardcoded sequential pipeline
 * mode=agent: real ReAct agent loop — LLM decides what to do next
 */

import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { getQueue } from '@/lib/queue';

export const dynamic = 'force-dynamic';

function encode(data: object) {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response('Unauthorized', { status: 401 });

  // Check if caller wants the real agent loop
  let mode = 'pipeline';
  try {
    const body = await req.json();
    mode = body?.mode ?? 'pipeline';
  } catch {}

  if (mode === 'agent') {
    // ── Real ReAct agent loop ──────────────────────────────────────────────
    const stream = new ReadableStream({
      async start(controller) {
        const log = (step: string, status: 'ok' | 'error' | 'info', detail: string) => {
          controller.enqueue(encode({ step, status, detail, ts: new Date().toISOString() }));
        };

        try {
          log('Agent', 'info', 'Starting ReAct agent loop — LLM will decide what to do next…');

          // Seed keywords only if none exist yet
          const { data: existingKw } = await supabaseAdmin.from('keywords').select('id').limit(1);
          if (!(existingKw as any[])?.length) {
            // Parse seed keywords from env: "keyword1,keyword2,keyword3"
            const seedKws = (process.env.SITE_SEED_KEYWORDS ?? '').split(',').map(k => k.trim()).filter(Boolean);
            if (seedKws.length > 0) {
              await supabaseAdmin.from('keywords').upsert(
                seedKws.map((kw, i) => ({ keyword: kw, is_tracked: true, is_approved: true, status: i === 0 ? 'ranked' : 'unranked_opportunity' })),
                { onConflict: 'keyword' }
              );
              log('Agent', 'info', `Seeded ${seedKws.length} initial keywords (first run)`);
            }
          }

          const { runAgentLoop } = await import('@/agent/agent-loop');
          await runAgentLoop({
            maxIterations: 8,
            onStep: ({ iteration, tool, reasoning, result }) => {
              const status = result.startsWith('Error') ? 'error' : tool === 'done' ? 'ok' : 'ok';
              log(`[${iteration}] ${tool}`, status, `${reasoning} → ${result}`);
            },
          });

          log('Agent', 'ok', 'ReAct loop complete. All tasks dispatched.');
        } catch (err: any) {
          controller.enqueue(encode({ step: 'Agent', status: 'error', detail: err.message, ts: new Date().toISOString() }));
        } finally {
          controller.enqueue(encode({ step: '__done__', status: 'ok', detail: '', ts: new Date().toISOString() }));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
    });
  }

  // ── Legacy pipeline mode (default) ────────────────────────────────────────
  const stream = new ReadableStream({
    async start(controller) {
      const log = (step: string, status: 'ok' | 'error' | 'info', detail: string) => {
        controller.enqueue(encode({ step, status, detail, ts: new Date().toISOString() }));
      };

      try {
        // ── 1. Seed baseline data (only if keywords table is empty) ──────
        log('Seeding keywords', 'info', 'Checking keyword table…');
        try {
          const { data: existingKw } = await supabaseAdmin.from('keywords').select('id').limit(1);
          if (!(existingKw as any[])?.length) {
            const seedKws = (process.env.SITE_SEED_KEYWORDS ?? '').split(',').map(k => k.trim()).filter(Boolean);
            if (seedKws.length > 0) {
              const { error } = await supabaseAdmin.from('keywords').upsert(
                seedKws.map((kw, i) => ({ keyword: kw, is_tracked: true, is_approved: true, status: i === 0 ? 'ranked' : 'unranked_opportunity' })),
                { onConflict: 'keyword' }
              );
              if (error) throw error;
              log('Seeding keywords', 'ok', `${seedKws.length} initial keywords seeded`);
            } else {
              log('Seeding keywords', 'info', 'No SITE_SEED_KEYWORDS set — add keywords manually on the Keywords page');
            }
          } else {
            log('Seeding keywords', 'ok', 'Keywords already exist — skipping seed');
          }
        } catch (e: any) { log('Seeding keywords', 'error', e.message); }

        log('Seeding competitors', 'info', 'Skipped — manage competitors from the Competitors page');
        log('Seeding competitors', 'ok', 'Use /competitors to add and discover competitors');

        // ── 2. Connect pg-boss ─────────────────────────────────────────────
        log('Queue', 'info', 'Connecting to job queue…');
        let boss: Awaited<ReturnType<typeof getQueue>> | null = null;
        try {
          boss = await getQueue();
          log('Queue', 'ok', 'pg-boss connected');
        } catch (e: any) {
          log('Queue', 'error', `Failed: ${e.message}`);
        }

        // ── 3. Queue all workers ───────────────────────────────────────────
        const jobs = [
          { name: 'site-crawl', label: 'Site Crawl' },
          { name: 'keyword-tracker', label: 'Keyword Tracker' },
          { name: 'pagespeed-audit', label: 'PageSpeed Audit' },
          { name: 'backlink-sync', label: 'Backlink Sync' },
          { name: 'competitor-monitor', label: 'Competitor Monitor' },
        ];

        for (const job of jobs) {
          if (!boss) { log(job.label, 'error', 'Skipped — queue not connected'); continue; }
          try {
            await boss.send(job.name, {});
            log(job.label, 'ok', `Job queued — running in background`);
          } catch (e: any) { log(job.label, 'error', e.message); }
        }

        // ── 4. GSC sync if token exists ────────────────────────────────────
        try {
          const { data } = await supabaseAdmin
            .from('oauth_tokens').select('provider, expires_at').eq('provider', 'gsc').single();
          if (data && boss) {
            const expired = new Date((data as any).expires_at) < new Date();
            if (!expired) {
              await boss.send('gsc-sync', {});
              log('GSC Sync', 'ok', 'Google Search Console sync queued');
            } else {
              log('GSC Sync', 'error', 'Token expired — sign out and back in to refresh');
            }
          } else {
            log('GSC Sync', 'info', 'No GSC token — connect Google Search Console in Settings');
          }
        } catch { log('GSC Sync', 'info', 'GSC not connected yet'); }

        // ── 4b. GA4 sync directly ──────────────────────────────────────────
        try {
          const { data: tokenData } = await supabaseAdmin
            .from('oauth_tokens').select('provider').eq('provider', 'gsc').single();
          if (!tokenData) {
            log('GA4 Sync', 'info', 'No Google token — connect Google in Settings first');
          } else if (!process.env.GA4_PROPERTY_ID) {
            log('GA4 Sync', 'info', 'GA4_PROPERTY_ID not set in .env.local');
          } else {
            const { data: lastGa } = await supabaseAdmin
              .from('ga_data_points').select('synced_at').order('synced_at', { ascending: false }).limit(1).single();
            const gaAge = lastGa ? (Date.now() - new Date((lastGa as any).synced_at).getTime()) / 3600000 : 999;
            if (gaAge < 6) {
              log('GA4 Sync', 'info', `Skipped — synced ${gaAge.toFixed(1)}h ago (threshold: 6h)`);
            } else {
              log('GA4 Sync', 'info', 'Fetching organic traffic from Google Analytics…');
              const { runGaSyncDirect } = await import('@/workers/ga-sync-direct');
              const rows = await runGaSyncDirect();
              log('GA4 Sync', 'ok', `${rows} row(s) synced from GA4`);
            }
          }
        } catch (e: any) {
          log('GA4 Sync', 'error', e.message);
        }

        // ── 5. Run site crawl directly (no pg-boss needed) ────────────────
        try {
          const { data: lastCrawl } = await supabaseAdmin
            .from('pages').select('last_crawled_at').not('last_crawled_at', 'is', null)
            .order('last_crawled_at', { ascending: false }).limit(1).single();
          const crawledAt = lastCrawl ? new Date((lastCrawl as any).last_crawled_at) : null;
          const crawlAge = crawledAt ? (Date.now() - crawledAt.getTime()) / 3600000 : 999;
          if (crawlAge < 6) {
            log('Site Crawl', 'info', `Skipped — crawled ${crawlAge.toFixed(1)}h ago (threshold: 6h)`);
          } else {
            log('Site Crawl', 'info', `Crawling ${process.env.SITE_URL ?? 'learnwealthx.in'}…`);
            const { runFullSiteCrawlDirect } = await import('@/workers/site-crawl-direct');
            const { pagesFound, recommendations } = await runFullSiteCrawlDirect();
            log('Site Crawl', 'ok', `${pagesFound} page(s) crawled, ${recommendations} recommendation(s) created`);
          }
        } catch (e: any) {
          log('Site Crawl', 'error', e.message);
        }

        // ── 6. Run keyword tracker directly ───────────────────────────────
        try {
          const { data: lastKw } = await supabaseAdmin
            .from('keywords').select('position_updated_at').not('position_updated_at', 'is', null)
            .order('position_updated_at', { ascending: false }).limit(1).single();
          const kwAge = lastKw ? (Date.now() - new Date((lastKw as any).position_updated_at).getTime()) / 3600000 : 999;
          if (kwAge < 6) {
            log('Keyword Tracker', 'info', `Skipped — positions updated ${kwAge.toFixed(1)}h ago (threshold: 6h)`);
          } else {
            log('Keyword Tracker', 'info', 'Checking Google rankings via Serper…');
            const { runKeywordTrackerDirect } = await import('@/workers/keyword-tracker-direct');
            const count = await runKeywordTrackerDirect();
            log('Keyword Tracker', 'ok', `${count} keyword(s) updated with live positions`);
          }
        } catch (e: any) {
          log('Keyword Tracker', 'error', e.message);
        }

        // ── 6b. Keyword discovery from GSC ────────────────────────────────
        log('Keyword Discovery', 'info', 'Finding new opportunities from GSC queries…');
        try {
          const { runKeywordDiscovery } = await import('@/agent/tools/keyword-discovery');
          const count = await runKeywordDiscovery();
          log('Keyword Discovery', 'ok', count > 0 ? `${count} new keyword(s) discovered` : 'No new opportunities (need GSC data)');
        } catch (e: any) {
          log('Keyword Discovery', 'error', e.message);
        }

        // ── 7. Backlink sync ───────────────────────────────────────────────
        try {
          const { data: lastBl } = await supabaseAdmin
            .from('backlinks').select('last_seen_at').order('last_seen_at', { ascending: false }).limit(1).single();
          const blAge = lastBl ? (Date.now() - new Date((lastBl as any).last_seen_at).getTime()) / 3600000 : 999;
          if (blAge < 12) {
            log('Backlink Sync', 'info', `Skipped — synced ${blAge.toFixed(1)}h ago (threshold: 12h)`);
          } else {
            log('Backlink Sync', 'info', 'Fetching backlinks via Serper…');
            const { runBacklinkSync } = await import('@/workers/backlink-sync');
            await runBacklinkSync();
            log('Backlink Sync', 'ok', 'Backlinks synced');
          }
        } catch (e: any) {
          log('Backlink Sync', 'error', e.message);
        }

        // ── 7b. Competitor monitor ─────────────────────────────────────────
        try {
          const { data: activeCompetitors } = await supabaseAdmin
            .from('competitors').select('id').eq('is_active', true);
          if (!activeCompetitors || (activeCompetitors as any[]).length === 0) {
            log('Competitor Monitor', 'info', 'No competitors added — skipping');
          } else {
            const today = new Date().toISOString().split('T')[0];
            const { data: todayKw } = await supabaseAdmin
              .from('competitor_keywords').select('id').eq('tracked_at', today).limit(1);
            if ((todayKw as any[])?.length > 0) {
              log('Competitor Monitor', 'info', 'Skipped — already tracked today');
            } else {
              log('Competitor Monitor', 'info', 'Checking competitor keyword rankings…');
              const { runCompetitorMonitorDirect } = await import('@/workers/competitor-monitor-direct');
              const count = await runCompetitorMonitorDirect();
              log('Competitor Monitor', 'ok', `${count} competitor(s) monitored`);
            }
          }
        } catch (e: any) {
          log('Competitor Monitor', 'error', e.message);
        }

        // ── 7c. Outreach prospector ────────────────────────────────────────
        try {
          const { data: lastProspect } = await supabaseAdmin
            .from('outreach_opportunities').select('updated_at').order('updated_at', { ascending: false }).limit(1).single();
          const prospectAge = lastProspect ? (Date.now() - new Date((lastProspect as any).updated_at).getTime()) / 3600000 : 999;
          if (prospectAge < 24) {
            log('Outreach Prospector', 'info', `Skipped — ran ${prospectAge.toFixed(1)}h ago (threshold: 24h)`);
          } else {
            log('Outreach Prospector', 'info', 'Finding link-building prospects…');
            const { runOutreachProspector } = await import('@/agent/tools/outreach-prospector');
            const count = await runOutreachProspector();
            log('Outreach Prospector', 'ok', `${count} new prospect(s) found`);
          }
        } catch (e: any) {
          log('Outreach Prospector', 'error', e.message);
        }

        // ── 7c2. Follow-up check ───────────────────────────────────────────
        try {
          const sevenDaysAgo = new Date();
          sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
          const { data: overdue } = await supabaseAdmin
            .from('outreach_opportunities')
            .select('source_domain')
            .eq('status', 'contacted')
            .lte('updated_at', sevenDaysAgo.toISOString());
          const overdueCount = (overdue as any[])?.length ?? 0;
          if (overdueCount > 0) {
            log('Follow-up Check', 'info', `${overdueCount} prospect(s) need a follow-up — check Backlinks → Outreach Pipeline`);
          } else {
            log('Follow-up Check', 'ok', 'No overdue follow-ups');
          }
        } catch (e: any) {
          log('Follow-up Check', 'error', e.message);
        }

        // ── 7d. CRO audit ──────────────────────────────────────────────────
        log('CRO Audit', 'info', 'Scoring pages for conversion elements…');
        try {
          const { runCROAudit } = await import('@/agent/tools/cro-auditor');
          const count = await runCROAudit();
          log('CRO Audit', 'ok', `${count} CRO recommendation(s) created`);
        } catch (e: any) {
          log('CRO Audit', 'error', e.message);
        }

        // ── 7e. CTR optimizer ──────────────────────────────────────────────
        log('CTR Optimizer', 'info', 'Finding low-CTR pages in GSC data…');
        try {
          const { runCTROptimizer } = await import('@/agent/tools/ctr-optimizer');
          const count = await runCTROptimizer();
          log('CTR Optimizer', 'ok', count > 0 ? `${count} CTR improvement(s) queued` : 'No low-CTR pages found (need GSC data)');
        } catch (e: any) {
          log('CTR Optimizer', 'error', e.message);
        }

        // ── 7f. Internal link audit ────────────────────────────────────────
        log('Internal Links', 'info', 'Finding internal linking opportunities…');
        try {
          const { runInternalLinkAudit } = await import('@/agent/tools/internal-link-auditor');
          const count = await runInternalLinkAudit();
          log('Internal Links', 'ok', count > 0 ? `${count} internal link opportunity(ies) found` : 'No new opportunities');
        } catch (e: any) {
          log('Internal Links', 'error', e.message);
        }

        // ── 7g. Schema audit ───────────────────────────────────────────────
        log('Schema Audit', 'info', 'Checking structured data coverage…');
        try {
          const { runSchemaAudit } = await import('@/agent/tools/schema-injector');
          const count = await runSchemaAudit();
          log('Schema Audit', 'ok', count > 0 ? `${count} schema recommendation(s) created` : 'All pages have structured data');
        } catch (e: any) {
          log('Schema Audit', 'error', e.message);
        }

        // ── 8. PageSpeed / CWV audit ───────────────────────────────────────
        try {
          const { data: lastCwv } = await supabaseAdmin
            .from('cwv_results').select('measured_at').order('measured_at', { ascending: false }).limit(1).single();
          const cwvAge = lastCwv ? (Date.now() - new Date((lastCwv as any).measured_at).getTime()) / 3600000 : 999;
          if (cwvAge < 24) {
            log('PageSpeed Audit', 'info', `Skipped — audited ${cwvAge.toFixed(1)}h ago (threshold: 24h)`);
          } else {
            log('PageSpeed Audit', 'info', 'Fetching Core Web Vitals via PageSpeed Insights…');
            const { runPageSpeedAuditDirect } = await import('@/workers/pagespeed-audit-direct');
            const audited = await runPageSpeedAuditDirect();
            log('PageSpeed Audit', 'ok', `${audited} page(s) audited for CWV`);
          }
        } catch (e: any) {
          log('PageSpeed Audit', 'error', e.message);
        }

        // ── 9. Auto-generate blog drafts (max 3/day) ──────────────────────
        log('Blog Generator', 'info', 'Checking daily blog quota…');
        try {
          const { autoGenerateBlogDrafts } = await import('@/agent/tools/blog-writer');

          // Count blogs already created today
          const todayStart = new Date();
          todayStart.setHours(0, 0, 0, 0);
          const { data: todayBlogs } = await supabaseAdmin
            .from('blog_posts')
            .select('id')
            .gte('created_at', todayStart.toISOString());

          const DAILY_LIMIT = 3;
          const todayCount = (todayBlogs as any[])?.length ?? 0;
          const remaining = DAILY_LIMIT - todayCount;

          if (remaining <= 0) {
            log('Blog Generator', 'info', `Daily limit reached (${DAILY_LIMIT} blogs already created today) — skipping`);
          } else {
            log('Blog Generator', 'info', `Generating ${remaining} blog draft(s) (${todayCount}/${DAILY_LIMIT} today)…`);
            const ids = await autoGenerateBlogDrafts(remaining);
            if (ids.length > 0) {
              log('Blog Generator', 'ok', `${ids.length} blog draft(s) created — review in Blog Posts`);
            } else {
              log('Blog Generator', 'info', 'No new drafts (all slugs already exist)');
            }
          }
        } catch (e: any) {
          const msg = e.message ?? '';
          if (msg.includes('429') || msg.includes('quota')) {
            log('Blog Generator', 'error', 'AI quota exceeded — try again after midnight UTC');
          } else {
            log('Blog Generator', 'error', msg);
          }
        }

        log('Agent', 'ok', 'All tasks dispatched. Workers are running in the background.');
      } catch (err: any) {
        controller.enqueue(encode({ step: 'Agent', status: 'error', detail: err.message, ts: new Date().toISOString() }));
      } finally {
        controller.enqueue(encode({ step: '__done__', status: 'ok', detail: '', ts: new Date().toISOString() }));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
