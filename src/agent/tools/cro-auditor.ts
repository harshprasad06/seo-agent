/**
 * CRO Auditor — scores pages on conversion elements:
 * - CTA presence and strength
 * - Social proof signals
 * - Trust signals
 * - Above-fold content quality
 * Creates recommendations for low-scoring pages.
 */

import { supabaseAdmin } from '../../lib/supabase';
import { createRecommendation } from '../workflow/approval-queue';

interface CROScore {
  url: string;
  pageId: string;
  score: number; // 0-100
  issues: string[];
  hasCTA: boolean;
  ctaStrength: 'strong' | 'weak' | 'none';
  hasSocialProof: boolean;
  hasTrustSignals: boolean;
  wordCount: number;
}

const STRONG_CTA_PATTERNS = [
  /get started/i, /sign up/i, /start free/i, /try now/i, /join now/i,
  /enroll now/i, /buy now/i, /get access/i, /start learning/i, /register/i,
];

const WEAK_CTA_PATTERNS = [
  /learn more/i, /read more/i, /click here/i, /submit/i, /contact us/i,
];

const SOCIAL_PROOF_PATTERNS = [
  /students/i, /learners/i, /members/i, /reviews/i, /testimonials/i,
  /rating/i, /stars/i, /trusted by/i, /\d+\+?\s*(students|users|learners)/i,
];

const TRUST_PATTERNS = [
  /secure/i, /guarantee/i, /refund/i, /certified/i, /verified/i,
  /ssl/i, /privacy/i, /money.back/i,
];

function scorePage(html: string, url: string, pageId: string): CROScore {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const issues: string[] = [];

  // CTA detection
  const hasStrongCTA = STRONG_CTA_PATTERNS.some(p => p.test(html));
  const hasWeakCTA = WEAK_CTA_PATTERNS.some(p => p.test(html));
  const hasCTA = hasStrongCTA || hasWeakCTA;
  const ctaStrength: CROScore['ctaStrength'] = hasStrongCTA ? 'strong' : hasWeakCTA ? 'weak' : 'none';

  // Social proof
  const hasSocialProof = SOCIAL_PROOF_PATTERNS.some(p => p.test(text));

  // Trust signals
  const hasTrustSignals = TRUST_PATTERNS.some(p => p.test(text));

  // Word count
  const wordCount = text.split(' ').filter(w => w.length > 2).length;

  // Score calculation
  let score = 0;
  if (hasStrongCTA) score += 35;
  else if (hasWeakCTA) score += 15;
  else issues.push('No call-to-action found — add a clear CTA button');

  if (hasSocialProof) score += 25;
  else issues.push('No social proof detected — add student count, reviews, or testimonials');

  if (hasTrustSignals) score += 20;
  else issues.push('No trust signals found — add guarantee, security badges, or certifications');

  if (wordCount >= 300) score += 20;
  else if (wordCount >= 100) score += 10;
  else issues.push(`Thin content (${wordCount} words) — add more value to this page`);

  return { url, pageId, score, issues, hasCTA, ctaStrength, hasSocialProof, hasTrustSignals, wordCount };
}

export async function runCROAudit(): Promise<number> {
  const siteUrl = (process.env.SITE_URL ?? 'https://www.learnwealthx.in/').replace(/\/$/, '');

  // Get crawled pages
  const { data: pages, error } = await supabaseAdmin
    .from('pages')
    .select('id, url')
    .not('last_crawled_at', 'is', null);

  if (error || !pages) return 0;

  let recsCreated = 0;

  for (const page of pages as any[]) {
    try {
      const res = await fetch(page.url, {
        signal: AbortSignal.timeout(10000),
        headers: { 'User-Agent': 'SEOAgent/1.0' },
      });
      if (!res.ok) continue;
      const html = await res.text();
      const scored = scorePage(html, page.url, page.id);

      // Only create recommendations for pages scoring below 60
      if (scored.score < 60 && scored.issues.length > 0) {
        for (const issue of scored.issues) {
          try {
            await createRecommendation({
              type: 'cro_improvement',
              pageId: page.id,
              currentState: {
                url: page.url,
                cro_score: scored.score,
                has_cta: scored.hasCTA,
                cta_strength: scored.ctaStrength,
                has_social_proof: scored.hasSocialProof,
                has_trust_signals: scored.hasTrustSignals,
                word_count: scored.wordCount,
              },
              proposedChange: { fix: issue },
              reason: issue,
              expectedImpact: `Improving CRO score from ${scored.score}/100 can increase conversion rate`,
              priority: scored.score < 30 ? 8 : 5,
            });
            recsCreated++;
          } catch {}
        }
      }
    } catch {}
  }

  console.log(`[cro-auditor] Created ${recsCreated} CRO recommendation(s)`);
  return recsCreated;
}
