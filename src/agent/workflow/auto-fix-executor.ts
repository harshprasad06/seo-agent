/**
 * Auto-Fix Executor — writes audit log entry, applies fix via GitHub PR, and triggers re-audit.
 * Validates: Requirements 3.2, 4.3, 9.2, 9.6
 */

import { supabaseAdmin } from '@/lib/supabase';
import { getQueue } from '@/lib/queue';
import { applyMetadataFix } from '../tools/metadata-fixer';

export interface AutoFixParams {
  actionType: string;
  pageId?: string;
  beforeState: Record<string, unknown>;
  afterState: Record<string, unknown>;
  recommendationId?: string;
}

const METADATA_FIX_TYPES = ['title_tag_change', 'meta_description', 'keywords'];

/**
 * Writes an append-only audit_log entry, applies the fix via GitHub PR
 * for metadata changes, then enqueues a 'site-crawl-single' job to re-audit.
 */
export async function executeAutoFix(params: AutoFixParams): Promise<void> {
  const { actionType, pageId, beforeState, afterState, recommendationId } = params;

  let prUrl: string | undefined;

  // Apply metadata fixes via GitHub PR if page info is available
  if (METADATA_FIX_TYPES.includes(actionType) && pageId) {
    try {
      // Fetch the page URL to determine the file path
      const { data: page } = await supabaseAdmin
        .from('pages')
        .select('url')
        .eq('id', pageId)
        .single();

      if (page?.url) {
        const filePath = urlToFilePath(page.url as string);
        const fixType = actionType === 'title_tag_change' ? 'title_tag'
          : actionType === 'meta_description' ? 'meta_description'
          : 'keywords';

        const result = await applyMetadataFix({
          filePath,
          fixType,
          currentValue: String(Object.values(beforeState)[0] ?? ''),
          proposedValue: String(Object.values(afterState)[0] ?? ''),
          recommendationId: recommendationId ?? 'unknown',
        });

        if (result.applied) {
          prUrl = result.prUrl;
          console.log(`[auto-fix] PR opened: ${prUrl}`);
        }
      }
    } catch (err) {
      // Non-fatal — log but still record in audit log
      console.error('[auto-fix] GitHub PR failed:', err instanceof Error ? err.message : err);
    }
  }

  const { error } = await supabaseAdmin.from('audit_log').insert({
    action_type: actionType,
    classification: 'AUTO_FIX',
    page_id: pageId ?? null,
    recommendation_id: recommendationId ?? null,
    before_state: beforeState,
    after_state: { ...afterState, pr_url: prUrl },
    executed_at: new Date().toISOString(),
  });

  if (error) {
    throw new Error(`Failed to write audit log: ${error.message}`);
  }

  if (pageId) {
    const queue = await getQueue();
    await queue.send('site-crawl-single', { pageId });
  }
}

/**
 * Maps a page URL to its Next.js file path in the repo.
 * e.g. https://www.learnwealthx.in/courses → app/courses/page.tsx
 */
function urlToFilePath(url: string): string {
  try {
    const { pathname } = new URL(url);
    const clean = pathname.replace(/^\/|\/$/g, '');
    if (!clean) return 'app/page.tsx';
    return `app/${clean}/page.tsx`;
  } catch {
    return 'app/page.tsx';
  }
}
