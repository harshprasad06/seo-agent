import { GoogleGenerativeAI } from '@google/generative-ai';
import { supabaseAdmin } from '../../lib/supabase';

type IntentCluster = 'informational' | 'navigational' | 'commercial' | 'transactional';

const VALID_INTENTS = new Set<IntentCluster>([
  'informational',
  'navigational',
  'commercial',
  'transactional',
]);

const INTENT_PROMPT = (keyword: string) =>
  `Classify the following search keyword into exactly one of these four intent categories:
- informational: the user wants to learn or find information
- navigational: the user wants to reach a specific website or page
- commercial: the user is researching products/services before buying
- transactional: the user wants to complete a purchase or specific action

Keyword: "${keyword}"

Respond with only one word — the category name. No explanation.`;

/**
 * Classifies a keyword's search intent using Gemini 2.0 Flash.
 * Defaults to 'informational' if the model returns an unexpected value.
 */
export async function classifyKeywordIntent(keyword: string): Promise<IntentCluster> {
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GOOGLE_GEMINI_API_KEY environment variable is not set');
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

  const result = await model.generateContent(INTENT_PROMPT(keyword));
  const raw = result.response.text().trim().toLowerCase() as IntentCluster;

  return VALID_INTENTS.has(raw) ? raw : 'informational';
}

interface UnrankedKeyword {
  id: string;
  keyword: string;
}

/**
 * Flags all keywords with no ranking in the top 100 as 'unranked_opportunity'
 * and creates a content_opportunity recommendation for each.
 */
export async function flagUnrankedOpportunities(): Promise<void> {
  // 1. Find all unranked keywords
  const { data: keywords, error: fetchError } = await supabaseAdmin
    .from('keywords')
    .select('id, keyword')
    .or('current_position.is.null,current_position.gt.100');

  if (fetchError) {
    throw new Error(`Failed to fetch unranked keywords: ${fetchError.message}`);
  }

  if (!keywords || keywords.length === 0) {
    console.log('[intent-classifier] No unranked keywords found.');
    return;
  }

  const keywordIds = (keywords as UnrankedKeyword[]).map((k) => k.id);

  // 2. Bulk-update status to 'unranked_opportunity'
  const { error: updateError } = await supabaseAdmin
    .from('keywords')
    .update({ status: 'unranked_opportunity' })
    .in('id', keywordIds);

  if (updateError) {
    throw new Error(`Failed to update keyword statuses: ${updateError.message}`);
  }

  // 3. Create a recommendation for each unranked keyword
  const recommendations = (keywords as UnrankedKeyword[]).map((kw) => ({
    type: 'content_opportunity',
    classification: 'RECOMMENDATION',
    keyword_id: kw.id,
    current_state: { current_position: null },
    proposed_change: { action: 'create_content_brief' },
    reason: 'Keyword has no ranking in top 100',
    status: 'pending',
  }));

  const { error: recError } = await supabaseAdmin
    .from('recommendations')
    .insert(recommendations);

  if (recError) {
    throw new Error(`Failed to insert recommendations: ${recError.message}`);
  }

  console.log(
    `[intent-classifier] Flagged ${keywords.length} unranked keyword(s) and created recommendations.`,
  );
}
