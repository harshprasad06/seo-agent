/**
 * POST /api/agent/run
 * Starts the SEO agent — initialises workers, queues all jobs,
 * and streams a live log back to the dashboard via Server-Sent Events.
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

  const stream = new ReadableStream({
    async start(controller) {
      const log = (step: string, status: 'ok' | 'error' | 'info', detail: string) => {
        controller.enqueue(encode({ step, status, detail, ts: new Date().toISOString() }));
      };

      try {
        // ── 1. Seed baseline data ──────────────────────────────────────────
        log('Seeding keywords', 'info', 'Adding tracked keywords for learnwealthx.in…');
        try {
          const { error } = await supabaseAdmin.from('keywords').upsert([
            { keyword: 'learnwealthx', is_tracked: true, is_approved: true, status: 'ranked' },
            { keyword: 'online courses india', is_tracked: true, is_approved: true, status: 'unranked_opportunity' },
            { keyword: 'stock market course online india', is_tracked: true, is_approved: true, status: 'unranked_opportunity' },
            { keyword: 'learn trading online india', is_tracked: true, is_approved: true, status: 'unranked_opportunity' },
            { keyword: 'best skill development courses india', is_tracked: true, is_approved: true, status: 'unranked_opportunity' },
          ], { onConflict: 'keyword' });
          if (error) throw error;
          log('Seeding keywords', 'ok', '5 keywords ready');
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

        // ── 5. Run site crawl directly (no pg-boss needed) ────────────────
        log('Site Crawl', 'info', `Crawling ${process.env.SITE_URL ?? 'learnwealthx.in'}…`);
        try {
          const { runFullSiteCrawlDirect } = await import('@/workers/site-crawl-direct');
          const { pagesFound, recommendations } = await runFullSiteCrawlDirect();
          log('Site Crawl', 'ok', `${pagesFound} page(s) crawled, ${recommendations} recommendation(s) created`);
        } catch (e: any) {
          log('Site Crawl', 'error', e.message);
        }

        // ── 6. Run keyword tracker directly ───────────────────────────────
        log('Keyword Tracker', 'info', 'Checking Google rankings via Serper…');
        try {
          const { runKeywordTrackerDirect } = await import('@/workers/keyword-tracker-direct');
          const count = await runKeywordTrackerDirect();
          log('Keyword Tracker', 'ok', `${count} keyword(s) updated with live positions`);
        } catch (e: any) {
          log('Keyword Tracker', 'error', e.message);
        }

        // ── 7. Backlink sync ───────────────────────────────────────────────
        log('Backlink Sync', 'info', 'Fetching backlinks via Serper…');
        try {
          const { runBacklinkSync } = await import('@/workers/backlink-sync');
          await runBacklinkSync();
          log('Backlink Sync', 'ok', 'Backlinks synced');
        } catch (e: any) {
          log('Backlink Sync', 'error', e.message);
        }

        // ── 7b. Competitor monitor ─────────────────────────────────────────
        log('Competitor Monitor', 'info', 'Checking competitor keyword rankings…');
        try {
          const { data: activeCompetitors } = await supabaseAdmin
            .from('competitors').select('id').eq('is_active', true);
          if (!activeCompetitors || (activeCompetitors as any[]).length === 0) {
            log('Competitor Monitor', 'info', 'No competitors added — skipping');
          } else {
            const { runCompetitorMonitorDirect } = await import('@/workers/competitor-monitor-direct');
            const count = await runCompetitorMonitorDirect();
            log('Competitor Monitor', 'ok', `${count} competitor(s) monitored`);
          }
        } catch (e: any) {
          log('Competitor Monitor', 'error', e.message);
        }

        // ── 7c. Outreach prospector ────────────────────────────────────────
        log('Outreach Prospector', 'info', 'Finding link-building prospects…');
        try {
          const { runOutreachProspector } = await import('@/agent/tools/outreach-prospector');
          const count = await runOutreachProspector();
          log('Outreach Prospector', 'ok', `${count} new prospect(s) found`);
        } catch (e: any) {
          log('Outreach Prospector', 'error', e.message);
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

        // ── 8. PageSpeed / CWV audit ───────────────────────────────────────
        log('PageSpeed Audit', 'info', 'Fetching Core Web Vitals via PageSpeed Insights…');
        try {
          const { runPageSpeedAuditDirect } = await import('@/workers/pagespeed-audit-direct');
          const audited = await runPageSpeedAuditDirect();
          log('PageSpeed Audit', 'ok', `${audited} page(s) audited for CWV`);
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
