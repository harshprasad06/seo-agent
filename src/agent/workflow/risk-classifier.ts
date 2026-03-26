/**
 * Risk Classifier — deterministic, rule-based (no LLM).
 * Validates: Requirements 9.1, 9.2, 9.3
 */

export type ActionType =
  // AUTO_FIX actions
  | 'add_missing_alt_text'
  | 'fix_broken_internal_link'
  | 'update_xml_sitemap'
  | 'correct_redirect_chain'
  | 'add_missing_meta_description'
  // RECOMMENDATION actions
  | 'change_primary_title_tag'
  | 'change_h1_heading'
  | 'change_canonical_tag'
  | 'modify_robots_txt'
  | 'publish_new_content'
  | 'content_opportunity'
  | 'cwv_performance';

export type Classification = 'AUTO_FIX' | 'RECOMMENDATION';

const AUTO_FIX_ACTIONS = new Set<string>([
  'add_missing_alt_text',
  'fix_broken_internal_link',
  'update_xml_sitemap',
  'correct_redirect_chain',
  'add_missing_meta_description',
]);

/**
 * Classifies a proposed action as AUTO_FIX or RECOMMENDATION.
 * Unknown action types default to RECOMMENDATION (fail-safe).
 */
export function classifyAction(actionType: ActionType | string): Classification {
  return AUTO_FIX_ACTIONS.has(actionType) ? 'AUTO_FIX' : 'RECOMMENDATION';
}
