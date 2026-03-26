import { GoogleGenerativeAI } from '@google/generative-ai';
import { supabaseAdmin } from '../../lib/supabase';

interface KeywordRow {
  id: string;
  keyword: string;
  intent_cluster: string | null;
  search_volume: number | null;
  difficulty: number | null;
}

interface CompetitorKeywordRow {
  keyword: string;
  position: number;
  competitors: { domain: string } | { domain: string }[] | null;
}

interface ContentBriefJson {
  title: string;
  secondary_keywords: string[];
  h2_outline: string[];
  estimated_word_count: number;
  competitor_references: string[];
  conversion_notes: string | null;
}

/**
 * Validates the parsed JSON from Gemini has all required fields with valid values.
 */
function validateBrief(brief: unknown): brief is ContentBriefJson {
  if (!brief || typeof brief !== 'object') return false;
  const b = brief as Record<string, unknown>;

  if (typeof b.title !== 'string' || b.title.trim() === '') return false;
  if (!Array.isArray(b.secondary_keywords) || b.secondary_keywords.length < 1) return false;
  if (!Array.isArray(b.h2_outline) || b.h2_outline.length < 1) return false;
  if (typeof b.estimated_word_count !== 'number' || b.estimated_word_count <= 0) return false;
  if (!Array.isArray(b.competitor_references) || b.competitor_references.length < 1) return false;
  if (b.conversion_notes !== null && typeof b.conversion_notes !== 'string') return false;

  return true;
}

/**
 * Generates a content brief for a given keyword using Gemini 2.0 Flash,
 * persists it to the content_briefs table, and returns the new record id.
 *
 * Validates: Requirements 5.2, 5.4, 5.6
 */
export async function generateContentBrief(keywordId: string): Promise<string> {
  // 1. Fetch keyword details
  const { data: keyword, error: kwError } = await supabaseAdmin
    .from('keywords')
    .select('id, keyword, intent_cluster, search_volume, difficulty')
    .eq('id', keywordId)
    .single();

  if (kwError || !keyword) {
    throw new Error(`Failed to fetch keyword ${keywordId}: ${kwError?.message ?? 'not found'}`);
  }

  const kw = keyword as KeywordRow;

  // 2. Fetch top 3 competitor pages ranking for this keyword
  const { data: competitorKeywords, error: compError } = await supabaseAdmin
    .from('competitor_keywords')
    .select('keyword, position, competitors!inner(domain)')
    .eq('keyword', kw.keyword)
    .order('position', { ascending: true })
    .limit(3);

  if (compError) {
    throw new Error(`Failed to fetch competitor keywords: ${compError.message}`);
  }

  const competitorDomains: string[] = [];
  for (const row of (competitorKeywords ?? []) as CompetitorKeywordRow[]) {
    const comp = row.competitors;
    const domain = Array.isArray(comp) ? (comp[0]?.domain ?? null) : (comp?.domain ?? null);
    if (domain) competitorDomains.push(domain);
  }

  // 3. Build prompt
  const isCommercialOrTransactional =
    kw.intent_cluster === 'commercial' || kw.intent_cluster === 'transactional';

  const prompt = `You are an expert SEO content strategist. Generate a content brief for the following keyword.

Keyword: "${kw.keyword}"
Intent cluster: ${kw.intent_cluster ?? 'unknown'}
Search volume: ${kw.search_volume ?? 'unknown'}
Difficulty: ${kw.difficulty ?? 'unknown'}/100
Top competitor domains ranking for this keyword: ${competitorDomains.length > 0 ? competitorDomains.join(', ') : 'none available'}

Return ONLY a valid JSON object (no markdown, no code fences) with exactly these fields:
{
  "title": "<SEO-optimized article title>",
  "secondary_keywords": ["<related keyword 1>", "<related keyword 2>"],
  "h2_outline": ["<H2 heading 1>", "<H2 heading 2>", "<H2 heading 3>"],
  "estimated_word_count": <positive integer between 800 and 2500>,
  "competitor_references": [${competitorDomains.length > 0 ? competitorDomains.map((d) => `"${d}"`).join(', ') : '"example-competitor.com"'}],
  "conversion_notes": ${isCommercialOrTransactional ? '"<specific conversion-focused notes for this commercial/transactional keyword>"' : 'null'}
}

Requirements:
- title must be SEO-optimized and compelling
- secondary_keywords must have at least 1 entry
- h2_outline must have at least 1 entry
- estimated_word_count must be a positive integer (typically 800-2500)
- competitor_references must include at least 1 domain from the provided competitor list${isCommercialOrTransactional ? '\n- conversion_notes MUST be a non-null string with actionable CTA/conversion guidance (intent is ' + kw.intent_cluster + ')' : '\n- conversion_notes MUST be null (intent is not commercial or transactional)'}`;

  // 4. Call Gemini 2.0 Flash
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable is not set');
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

  const result = await model.generateContent(prompt);
  const responseText = result.response.text().trim();

  // 5. Parse and validate JSON response
  let brief: ContentBriefJson;
  try {
    // Strip markdown code fences if Gemini wraps the JSON anyway
    const cleaned = responseText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    brief = JSON.parse(cleaned) as ContentBriefJson;
  } catch {
    throw new Error(`Gemini returned invalid JSON: ${responseText.slice(0, 200)}`);
  }

  if (!validateBrief(brief)) {
    throw new Error(`Gemini response failed validation: ${JSON.stringify(brief).slice(0, 300)}`);
  }

  // 6. Persist to content_briefs table
  const { data: inserted, error: insertError } = await supabaseAdmin
    .from('content_briefs')
    .insert({
      target_keyword_id: keywordId,
      title: brief.title,
      secondary_keywords: brief.secondary_keywords,
      h2_outline: brief.h2_outline,
      estimated_word_count: brief.estimated_word_count,
      competitor_references: brief.competitor_references,
      conversion_notes: brief.conversion_notes,
      status: 'draft',
    })
    .select('id')
    .single();

  if (insertError || !inserted) {
    throw new Error(`Failed to persist content brief: ${insertError?.message ?? 'unknown error'}`);
  }

  // 7. Return the created record id
  return (inserted as { id: string }).id;
}
