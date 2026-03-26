/**
 * Outreach email drafter — generates personalized outreach emails
 * using Gemini (with Groq fallback) for a given outreach opportunity.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { supabaseAdmin } from '../../lib/supabase';

const SITE_URL = process.env.SITE_URL ?? 'https://www.learnwealthx.in/';
const SITE_NAME = 'LearnWealthX';
const SITE_DESC = 'an online course platform where creators can sell courses and earn 100% affiliate commission';

async function callAI(prompt: string): Promise<string> {
  // Try Gemini first
  const geminiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GEMINI_API_KEY;
  if (geminiKey) {
    try {
      const genAI = new GoogleGenerativeAI(geminiKey);
      const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
      const result = await model.generateContent(prompt);
      return result.response.text().trim();
    } catch (err: any) {
      if (!err.message?.includes('429') && !err.message?.includes('quota')) throw err;
    }
  }
  // Groq fallback
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) throw new Error('No AI available (Gemini quota exceeded, GROQ_API_KEY not set)');
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.4,
    }),
  });
  if (!res.ok) throw new Error(`Groq error: ${await res.text()}`);
  const json: any = await res.json();
  return json.choices?.[0]?.message?.content?.trim() ?? '';
}

export async function generateOutreachDraft(opportunityId: string): Promise<string> {
  const { data: opp, error } = await supabaseAdmin
    .from('outreach_opportunities')
    .select('id, source_domain, domain_authority, links_to_competitors, relevance_score')
    .eq('id', opportunityId)
    .single();

  if (error || !opp) throw new Error(`Opportunity not found: ${error?.message}`);

  const o = opp as any;
  const competitors = (o.links_to_competitors ?? []).join(', ') || 'similar platforms';
  const isGuestPost = !o.links_to_competitors?.length;

  const prompt = isGuestPost
    ? `You are an outreach specialist for ${SITE_NAME} (${SITE_URL}), ${SITE_DESC}.

Write a guest post pitch email to the editor of ${o.source_domain}.

Requirements:
- Friendly, professional, under 180 words
- Propose 2-3 specific article ideas relevant to their audience and our niche (online courses, affiliate marketing, wealth building, India)
- Mention ${SITE_NAME} briefly as context for why we're a good fit
- Sign off as "The ${SITE_NAME} Team"
- Include subject line

Write only the email (subject + body).`
    : `You are an outreach specialist for ${SITE_NAME} (${SITE_URL}), ${SITE_DESC}.

Write a link-building outreach email to the webmaster of ${o.source_domain}.

Context:
- Their site links to ${competitors} but not to ${SITE_NAME}
- Domain authority: ${o.domain_authority ?? 'unknown'}

Requirements:
- Friendly, professional, under 180 words
- Mention they already link to similar platforms
- Explain briefly what ${SITE_NAME} offers and why it's valuable to their readers
- Politely ask them to consider adding a link
- Sign off as "The ${SITE_NAME} Team"
- Include subject line

Write only the email (subject + body).`;

  const draft = await callAI(prompt);

  if (draft.length < 50) throw new Error('AI returned a draft that is too short');

  await supabaseAdmin
    .from('outreach_opportunities')
    .update({ email_draft: draft, updated_at: new Date().toISOString() })
    .eq('id', opportunityId);

  return draft;
}
