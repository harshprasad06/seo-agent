/**
 * Approval Queue Manager — creates, approves, and rejects recommendations.
 * Validates: Requirements 3.3, 3.5, 9.4, 9.5, 9.6
 */

import { supabaseAdmin } from '@/lib/supabase';
import { executeAutoFix } from './auto-fix-executor';

export interface CreateRecommendationParams {
  type: string;
  pageId?: string;
  keywordId?: string;
  currentState: Record<string, unknown>;
  proposedChange: Record<string, unknown>;
  reason: string;
  expectedImpact?: string;
  priority?: number;
}

/**
 * Inserts a new recommendation into the approval queue.
 * reason and expectedImpact must be non-empty strings.
 * Returns the new record's id.
 */
export async function createRecommendation(
  params: CreateRecommendationParams,
): Promise<string> {
  const {
    type,
    pageId,
    keywordId,
    currentState,
    proposedChange,
    reason,
    expectedImpact,
    priority = 5,
  } = params;

  if (!reason || reason.trim() === '') {
    throw new Error('reason must be a non-empty string');
  }
  if (expectedImpact !== undefined && expectedImpact.trim() === '') {
    throw new Error('expectedImpact must be non-empty when provided');
  }

  // Dedup: skip if a pending recommendation of the same type+page already exists
  const dupCheck = supabaseAdmin
    .from('recommendations')
    .select('id')
    .eq('type', type)
    .eq('status', 'pending');

  if (pageId) dupCheck.eq('page_id', pageId);
  dupCheck.limit(1);

  const { data: existing } = await dupCheck;
  if (existing && (existing as any[]).length > 0) {
    return (existing as any[])[0].id as string;
  }

  const { data, error } = await supabaseAdmin
    .from('recommendations')
    .insert({
      type,
      classification: 'RECOMMENDATION',
      page_id: pageId ?? null,
      keyword_id: keywordId ?? null,
      current_state: currentState,
      proposed_change: proposedChange,
      reason,
      expected_impact: expectedImpact ?? null,
      priority,
      status: 'pending',
    })
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(`Failed to create recommendation: ${error?.message}`);
  }

  return data.id as string;
}

/**
 * Approves a recommendation: sets status='approved', records decided_at,
 * then executes the proposed change via executeAutoFix.
 */
export async function approveRecommendation(recommendationId: string): Promise<void> {
  const { data: rec, error: fetchError } = await supabaseAdmin
    .from('recommendations')
    .select('type, page_id, current_state, proposed_change')
    .eq('id', recommendationId)
    .single();

  if (fetchError || !rec) {
    throw new Error(`Recommendation not found: ${fetchError?.message}`);
  }

  const { error: updateError } = await supabaseAdmin
    .from('recommendations')
    .update({ status: 'approved', decided_at: new Date().toISOString() })
    .eq('id', recommendationId);

  if (updateError) {
    throw new Error(`Failed to approve recommendation: ${updateError.message}`);
  }

  await executeAutoFix({
    actionType: rec.type as string,
    pageId: rec.page_id as string | undefined,
    beforeState: rec.current_state as Record<string, unknown>,
    afterState: rec.proposed_change as Record<string, unknown>,
    recommendationId,
  });
}

/**
 * Rejects a recommendation: sets status='rejected', records rejection_reason,
 * decided_at, and suppressed_until = now() + 30 days.
 */
export async function rejectRecommendation(
  recommendationId: string,
  rejectionReason: string,
): Promise<void> {
  const now = new Date();
  const suppressedUntil = new Date(now);
  suppressedUntil.setDate(suppressedUntil.getDate() + 30);

  const { error } = await supabaseAdmin
    .from('recommendations')
    .update({
      status: 'rejected',
      rejection_reason: rejectionReason,
      decided_at: now.toISOString(),
      suppressed_until: suppressedUntil.toISOString(),
    })
    .eq('id', recommendationId);

  if (error) {
    throw new Error(`Failed to reject recommendation: ${error.message}`);
  }
}
