import { GoogleGenerativeAI } from '@google/generative-ai';
import { supabaseAdmin } from '../../lib/supabase';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RootCauseAnalysis {
  triggered: boolean;
  drop_pct: number;
  root_causes: string[];
  report: string;
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

/**
 * Returns true iff prior > 0 AND current/prior <= 0.80 (≥20% drop).
 * Validates: Requirement 8.5
 */
export function isTrafficDrop(current: number, prior: number): boolean {
  if (prior <= 0) return false;
  return current / prior <= 0.80;
}

// ── Context fetchers ──────────────────────────────────────────────────────────

async function fetchRecentAuditLog(limit = 10): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('audit_log')
    .select('action_type, classification, executed_at')
    .order('executed_at', { ascending: false })
    .limit(limit);

  if (error) return 'Unable to fetch audit log.';
  if (!data || data.length === 0) return 'No recent audit log entries.';

  return data
    .map(
      (row: { action_type: string; classification: string; executed_at: string }) =>
        `[${row.executed_at}] ${row.classification}: ${row.action_type}`,
    )
    .join('\n');
}

async function fetchRecentRecommendations(limit = 10): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('recommendations')
    .select('type, reason, status, priority, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) return 'Unable to fetch recommendations.';
  if (!data || data.length === 0) return 'No recent recommendations.';

  return data
    .map(
      (row: { type: string; reason: string; status: string; priority: number; created_at: string }) =>
        `[${row.created_at}] ${row.type} (priority ${row.priority}, ${row.status}): ${row.reason}`,
    )
    .join('\n');
}

async function fetchKeywordRankingChanges(limit = 10): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('keywords')
    .select('keyword, current_position, previous_position, position_updated_at')
    .not('previous_position', 'is', null)
    .order('position_updated_at', { ascending: false })
    .limit(limit);

  if (error) return 'Unable to fetch keyword ranking changes.';
  if (!data || data.length === 0) return 'No recent keyword ranking changes.';

  return data
    .map(
      (row: {
        keyword: string;
        current_position: number | null;
        previous_position: number | null;
        position_updated_at: string;
      }) => {
        const delta =
          row.current_position !== null && row.previous_position !== null
            ? row.current_position - row.previous_position
            : 'N/A';
        return `"${row.keyword}": pos ${row.previous_position} → ${row.current_position} (delta: ${delta}) at ${row.position_updated_at}`;
      },
    )
    .join('\n');
}

// ── Gemini analysis ───────────────────────────────────────────────────────────

async function analyzeWithGemini(
  dropPct: number,
  auditLog: string,
  recommendations: string,
  keywordChanges: string,
): Promise<{ root_causes: string[]; report: string }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn('[root-cause-analyzer] GEMINI_API_KEY not set — returning empty analysis');
    return { root_causes: [], report: '' };
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

  const prompt = `You are an SEO analyst. Organic traffic has dropped by ${dropPct.toFixed(1)}% week-over-week (a ≥20% drop). Analyze the following context and identify the most likely root causes.

## Recent Audit Log (last 10 entries)
${auditLog}

## Recent Recommendations (last 10)
${recommendations}

## Recent Keyword Ranking Changes (last 10)
${keywordChanges}

Respond in JSON with this exact structure:
{
  "root_causes": ["<cause 1>", "<cause 2>", ...],
  "report": "<2-4 sentence narrative summary>"
}`;

  const result = await model.generateContent(prompt);
  const text = result.response.text().trim();

  // Strip markdown code fences if present
  const jsonText = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');

  try {
    const parsed = JSON.parse(jsonText) as { root_causes: string[]; report: string };
    return {
      root_causes: Array.isArray(parsed.root_causes) ? parsed.root_causes : [],
      report: typeof parsed.report === 'string' ? parsed.report : '',
    };
  } catch {
    // Fallback: return raw text as report
    return { root_causes: [], report: text };
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Analyzes a traffic drop if current/prior <= 0.80.
 * Uses Gemini 2.0 Flash to identify root causes from audit_log,
 * recommendations, and keyword ranking changes.
 *
 * Validates: Requirements 8.4, 8.5, 8.6
 */
export async function analyzeTrafficDrop(
  currentWeekSessions: number,
  priorWeekSessions: number,
): Promise<RootCauseAnalysis> {
  const triggered = isTrafficDrop(currentWeekSessions, priorWeekSessions);

  const drop_pct =
    priorWeekSessions > 0
      ? Math.round(((priorWeekSessions - currentWeekSessions) / priorWeekSessions) * 10000) / 100
      : 0;

  if (!triggered) {
    return { triggered: false, drop_pct, root_causes: [], report: '' };
  }

  const [auditLog, recommendations, keywordChanges] = await Promise.all([
    fetchRecentAuditLog(),
    fetchRecentRecommendations(),
    fetchKeywordRankingChanges(),
  ]);

  const { root_causes, report } = await analyzeWithGemini(
    drop_pct,
    auditLog,
    recommendations,
    keywordChanges,
  );

  return { triggered: true, drop_pct, root_causes, report };
}
