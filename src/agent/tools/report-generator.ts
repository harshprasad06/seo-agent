import { GoogleGenerativeAI } from '@google/generative-ai';
import { supabaseAdmin } from '../../lib/supabase';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WeeklyReportContent {
  organic_traffic_trends: {
    current_week_sessions: number;
    prior_week_sessions: number;
    change_pct: number;
  };
  keyword_ranking_changes: {
    improved: number;
    declined: number;
    new_rankings: number;
  };
  technical_audit_status: {
    open_issues: number;
    auto_fixed: number;
    pending_recommendations: number;
  };
  content_published: {
    new_pages: number;
    updated_pages: number;
  };
  backlinks_gained_lost: {
    gained: number;
    lost: number;
    net: number;
  };
  competitor_movements: {
    alerts: number;
    displacement_opportunities: number;
  };
}

export interface MonthlyReportContent {
  organic_traffic_trends: {
    current_month_sessions: number;
    prior_month_sessions: number;
    baseline_sessions: number;
    current_vs_prior_pct: number;
    current_vs_baseline_pct: number;
  };
  keyword_ranking_changes: {
    current_month: { improved: number; declined: number; new_rankings: number };
    prior_month: { improved: number; declined: number; new_rankings: number };
    baseline: { improved: number; declined: number; new_rankings: number };
  };
  technical_audit_status: {
    current_month: { open_issues: number; auto_fixed: number; pending_recommendations: number };
    prior_month: { open_issues: number; auto_fixed: number; pending_recommendations: number };
    baseline: { open_issues: number; auto_fixed: number; pending_recommendations: number };
  };
  content_published: {
    current_month: { new_pages: number; updated_pages: number };
    prior_month: { new_pages: number; updated_pages: number };
    baseline: { new_pages: number; updated_pages: number };
  };
  backlinks_gained_lost: {
    current_month: { gained: number; lost: number; net: number };
    prior_month: { gained: number; lost: number; net: number };
    baseline: { gained: number; lost: number; net: number };
  };
  competitor_movements: {
    current_month: { alerts: number; displacement_opportunities: number };
    prior_month: { alerts: number; displacement_opportunities: number };
    baseline: { alerts: number; displacement_opportunities: number };
  };
}

// ── Date helpers ──────────────────────────────────────────────────────────────

/** Returns the most recent Monday (or today if today is Monday) */
function getLastMonday(from: Date = new Date()): Date {
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0=Sun, 1=Mon, …, 6=Sat
  const diff = day === 0 ? 6 : day - 1; // days since last Monday
  d.setDate(d.getDate() - diff);
  return d;
}

/** Returns the Sunday immediately before the given Monday */
function getSundayBefore(monday: Date): Date {
  const d = new Date(monday);
  d.setDate(d.getDate() - 1);
  return d;
}

function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
  const result = new Date(d);
  result.setDate(result.getDate() + n);
  return result;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

function addMonths(d: Date, n: number): Date {
  const result = new Date(d);
  result.setMonth(result.getMonth() + n);
  return result;
}

// ── Data fetchers ─────────────────────────────────────────────────────────────

async function fetchOrganicSessions(start: string, end: string): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from('ga_data_points')
    .select('organic_sessions')
    .gte('date', start)
    .lte('date', end);

  if (error) throw new Error(`Failed to fetch GA data: ${error.message}`);
  return (data ?? []).reduce(
    (sum: number, row: { organic_sessions: number }) => sum + (row.organic_sessions ?? 0),
    0,
  );
}

async function fetchKeywordRankingChanges(
  start: string,
  end: string,
): Promise<{ improved: number; declined: number; new_rankings: number }> {
  // We use position_updated_at to scope to the period
  const { data, error } = await supabaseAdmin
    .from('keywords')
    .select('current_position, previous_position')
    .gte('position_updated_at', start)
    .lte('position_updated_at', end + 'T23:59:59Z');

  if (error) throw new Error(`Failed to fetch keyword data: ${error.message}`);

  let improved = 0;
  let declined = 0;
  let new_rankings = 0;

  for (const row of data ?? []) {
    const curr = row.current_position as number | null;
    const prev = row.previous_position as number | null;

    if (prev === null && curr !== null) {
      new_rankings++;
    } else if (curr !== null && prev !== null) {
      if (curr < prev) improved++;
      else if (curr > prev) declined++;
    }
  }

  return { improved, declined, new_rankings };
}

async function fetchTechnicalAuditStatus(
  start: string,
  end: string,
): Promise<{ open_issues: number; auto_fixed: number; pending_recommendations: number }> {
  const { data: openData, error: openError } = await supabaseAdmin
    .from('recommendations')
    .select('id')
    .not('status', 'in', ['applied', 'rejected', 'suppressed']);

  if (openError) throw new Error(`Failed to fetch open issues: ${openError.message}`);

  const { data: autoFixData, error: autoFixError } = await supabaseAdmin
    .from('audit_log')
    .select('id')
    .eq('classification', 'AUTO_FIX')
    .gte('executed_at', start)
    .lte('executed_at', end + 'T23:59:59Z');

  if (autoFixError) throw new Error(`Failed to fetch auto-fix count: ${autoFixError.message}`);

  const { data: pendingData, error: pendingError } = await supabaseAdmin
    .from('recommendations')
    .select('id')
    .eq('status', 'pending');

  if (pendingError)
    throw new Error(`Failed to fetch pending recommendations: ${pendingError.message}`);

  return {
    open_issues: (openData as any[])?.length ?? 0,
    auto_fixed: (autoFixData as any[])?.length ?? 0,
    pending_recommendations: (pendingData as any[])?.length ?? 0,
  };
}

async function fetchContentPublished(
  start: string,
  end: string,
): Promise<{ new_pages: number; updated_pages: number }> {
  const { data: newData, error: newError } = await supabaseAdmin
    .from('pages')
    .select('id')
    .gte('created_at', start)
    .lte('created_at', end + 'T23:59:59Z');

  if (newError) throw new Error(`Failed to fetch new pages: ${newError.message}`);

  const { data: updatedData, error: updatedError } = await supabaseAdmin
    .from('pages')
    .select('id')
    .lt('created_at', start)
    .gte('updated_at', start)
    .lte('updated_at', end + 'T23:59:59Z');

  if (updatedError) throw new Error(`Failed to fetch updated pages: ${updatedError.message}`);

  return {
    new_pages: (newData as any[])?.length ?? 0,
    updated_pages: (updatedData as any[])?.length ?? 0,
  };
}

async function fetchBacklinksGainedLost(
  start: string,
  end: string,
): Promise<{ gained: number; lost: number; net: number }> {
  const { data: gainedData, error: gainedError } = await supabaseAdmin
    .from('backlinks')
    .select('id')
    .gte('first_seen_at', start)
    .lte('first_seen_at', end + 'T23:59:59Z');

  if (gainedError) throw new Error(`Failed to fetch gained backlinks: ${gainedError.message}`);

  const { data: lostData, error: lostError } = await supabaseAdmin
    .from('backlinks')
    .select('id')
    .eq('status', 'lost')
    .gte('lost_at', start)
    .lte('lost_at', end + 'T23:59:59Z');

  if (lostError) throw new Error(`Failed to fetch lost backlinks: ${lostError.message}`);

  const gained = (gainedData as any[])?.length ?? 0;
  const lost = (lostData as any[])?.length ?? 0;
  return { gained, lost, net: gained - lost };
}

async function fetchCompetitorMovements(
  start: string,
  end: string,
): Promise<{ alerts: number; displacement_opportunities: number }> {
  const { data: alertData, error: alertError } = await supabaseAdmin
    .from('competitor_keywords')
    .select('id')
    .gte('tracked_at', start)
    .lte('tracked_at', end);

  if (alertError) throw new Error(`Failed to fetch competitor alerts: ${alertError.message}`);

  // displacement_opportunities = keywords where goodads.ai is within 5 positions of a competitor
  // We approximate by counting keywords where current_position is not null and <= 20 (top 20)
  // and there exists a competitor_keyword for the same keyword with position within 5
  const { data: ownKeywords, error: ownError } = await supabaseAdmin
    .from('keywords')
    .select('keyword, current_position')
    .not('current_position', 'is', null)
    .lte('current_position', 20);

  if (ownError) throw new Error(`Failed to fetch own keywords: ${ownError.message}`);

  let displacementCount = 0;

  if ((ownKeywords ?? []).length > 0) {
    const keywordList = (ownKeywords ?? []).map(
      (k: { keyword: string; current_position: number }) => k.keyword,
    );

    const { data: compKeywords, error: compError } = await supabaseAdmin
      .from('competitor_keywords')
      .select('keyword, position')
      .in('keyword', keywordList);

    if (compError) throw new Error(`Failed to fetch competitor keywords: ${compError.message}`);

    // Build map: keyword → min competitor position
    const compMinPos = new Map<string, number>();
    for (const ck of compKeywords ?? []) {
      const existing = compMinPos.get(ck.keyword);
      if (existing === undefined || ck.position < existing) {
        compMinPos.set(ck.keyword, ck.position);
      }
    }

    for (const ok of ownKeywords ?? []) {
      const compPos = compMinPos.get(ok.keyword);
      if (compPos !== undefined && Math.abs(ok.current_position - compPos) <= 5) {
        displacementCount++;
      }
    }
  }

  return { alerts: (alertData as any[])?.length ?? 0, displacement_opportunities: displacementCount };
}

// ── Gemini narrative generator ────────────────────────────────────────────────

async function generateNarrative(
  reportType: 'weekly' | 'monthly',
  content: WeeklyReportContent | MonthlyReportContent,
): Promise<string> {
  const prompt =
    reportType === 'weekly'
      ? `You are an SEO analyst. Write a concise 3-5 sentence executive summary for the following weekly SEO performance data. Focus on the most significant changes and actionable insights.\n\nData:\n${JSON.stringify(content, null, 2)}`
      : `You are an SEO analyst. Write a concise 4-6 sentence executive summary for the following monthly SEO performance report, comparing current month to prior month. Highlight trends and key takeaways.\n\nData:\n${JSON.stringify(content, null, 2)}`;

  // Try Gemini first
  const geminiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GEMINI_API_KEY;
  if (geminiKey) {
    try {
      const genAI = new GoogleGenerativeAI(geminiKey);
      const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
      const result = await model.generateContent(prompt);
      return result.response.text();
    } catch (err: any) {
      if (!err.message?.includes('429') && !err.message?.includes('quota')) throw err;
      console.warn('[report-generator] Gemini quota exceeded — falling back to Groq');
    }
  }

  // Groq fallback
  const groqKey = process.env.GROQ_API_KEY;
  if (groqKey) {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
      }),
    });
    if (res.ok) {
      const json: any = await res.json();
      return json.choices?.[0]?.message?.content?.trim() ?? '';
    }
  }

  console.warn('[report-generator] No AI available — skipping narrative');
  return '';
}

// ── Weekly report ─────────────────────────────────────────────────────────────

/**
 * Generates a weekly SEO performance report covering the last full Mon–Sun week.
 * Persists to the `reports` table and returns the report record id.
 *
 * Validates: Requirements 8.1, 8.2
 */
export async function generateWeeklyReport(): Promise<string> {
  // 1. Calculate period: last Monday → last Sunday
  const today = new Date();
  const lastMonday = getLastMonday(today);
  // If today IS Monday, we want the previous week (Mon–Sun)
  const periodEnd = getSundayBefore(lastMonday);
  const periodStart = addDays(periodEnd, -6); // 7-day window ending on Sunday

  const start = toDateString(periodStart);
  const end = toDateString(periodEnd);

  // 2–7. Fetch all sections in parallel
  const [
    trafficCurrent,
    trafficPrior,
    keywordChanges,
    auditStatus,
    contentPublished,
    backlinks,
    competitorMovements,
  ] = await Promise.all([
    fetchOrganicSessions(start, end),
    fetchOrganicSessions(toDateString(addDays(periodStart, -7)), toDateString(addDays(periodEnd, -7))),
    fetchKeywordRankingChanges(start, end),
    fetchTechnicalAuditStatus(start, end),
    fetchContentPublished(start, end),
    fetchBacklinksGainedLost(start, end),
    fetchCompetitorMovements(start, end),
  ]);

  const changePct =
    trafficPrior === 0
      ? 0
      : Math.round(((trafficCurrent - trafficPrior) / trafficPrior) * 10000) / 100;

  const content: WeeklyReportContent = {
    organic_traffic_trends: {
      current_week_sessions: trafficCurrent,
      prior_week_sessions: trafficPrior,
      change_pct: changePct,
    },
    keyword_ranking_changes: keywordChanges,
    technical_audit_status: auditStatus,
    content_published: contentPublished,
    backlinks_gained_lost: backlinks,
    competitor_movements: competitorMovements,
  };

  // 8. Generate Gemini narrative
  const summaryText = await generateNarrative('weekly', content);

  // 9. Persist to reports table
  const { data, error } = await supabaseAdmin
    .from('reports')
    .insert({
      type: 'weekly',
      period_start: start,
      period_end: end,
      content,
      summary_text: summaryText || null,
    })
    .select('id')
    .single();

  if (error) throw new Error(`Failed to persist weekly report: ${error.message}`);

  console.log(`[report-generator] Weekly report created: ${data.id} (${start} → ${end})`);

  // 10. Return report id
  return data.id as string;
}

// ── Daily report ──────────────────────────────────────────────────────────────

export async function generateDailyReport(): Promise<string> {
  const today = new Date();
  const end = toDateString(today);
  const start = toDateString(addDays(today, -1));

  const [auditStatus, keywordChanges, backlinks] = await Promise.all([
    fetchTechnicalAuditStatus(start, end),
    fetchKeywordRankingChanges(start, end),
    fetchBacklinksGainedLost(start, end),
  ]);

  const content = {
    period: { start, end },
    keyword_ranking_changes: keywordChanges,
    technical_audit_status: auditStatus,
    backlinks_gained_lost: backlinks,
  };

  const summaryText = await generateNarrative('weekly', content as any);

  const { data, error } = await supabaseAdmin
    .from('reports')
    .insert({
      type: 'daily',
      period_start: start,
      period_end: end,
      content,
      summary_text: summaryText || null,
    })
    .select('id')
    .single();

  if (error) throw new Error(`Failed to persist daily report: ${error.message}`);
  return (data as any).id as string;
}

/**
 * Generates a monthly SEO executive summary comparing:
 *   - current_month: the most recently completed calendar month
 *   - prior_month: the month before that
 *   - baseline: 3 months before current_month
 *
 * Persists to the `reports` table and returns the report record id.
 *
 * Validates: Requirements 8.1, 8.2
 */
export async function generateMonthlyReport(): Promise<string> {
  const today = new Date();

  // Current month = last completed calendar month
  const currentMonthEnd = endOfMonth(addMonths(today, -1));
  const currentMonthStart = startOfMonth(currentMonthEnd);

  const priorMonthEnd = endOfMonth(addMonths(currentMonthEnd, -1));
  const priorMonthStart = startOfMonth(priorMonthEnd);

  const baselineMonthEnd = endOfMonth(addMonths(currentMonthEnd, -3));
  const baselineMonthStart = startOfMonth(baselineMonthEnd);

  const periods = {
    current: { start: toDateString(currentMonthStart), end: toDateString(currentMonthEnd) },
    prior: { start: toDateString(priorMonthStart), end: toDateString(priorMonthEnd) },
    baseline: { start: toDateString(baselineMonthStart), end: toDateString(baselineMonthEnd) },
  };

  // Fetch all data for all three periods in parallel
  const [
    currentTraffic, priorTraffic, baselineTraffic,
    currentKeywords, priorKeywords, baselineKeywords,
    currentAudit, priorAudit, baselineAudit,
    currentContent, priorContent, baselineContent,
    currentBacklinks, priorBacklinks, baselineBacklinks,
    currentCompetitor, priorCompetitor, baselineCompetitor,
  ] = await Promise.all([
    fetchOrganicSessions(periods.current.start, periods.current.end),
    fetchOrganicSessions(periods.prior.start, periods.prior.end),
    fetchOrganicSessions(periods.baseline.start, periods.baseline.end),
    fetchKeywordRankingChanges(periods.current.start, periods.current.end),
    fetchKeywordRankingChanges(periods.prior.start, periods.prior.end),
    fetchKeywordRankingChanges(periods.baseline.start, periods.baseline.end),
    fetchTechnicalAuditStatus(periods.current.start, periods.current.end),
    fetchTechnicalAuditStatus(periods.prior.start, periods.prior.end),
    fetchTechnicalAuditStatus(periods.baseline.start, periods.baseline.end),
    fetchContentPublished(periods.current.start, periods.current.end),
    fetchContentPublished(periods.prior.start, periods.prior.end),
    fetchContentPublished(periods.baseline.start, periods.baseline.end),
    fetchBacklinksGainedLost(periods.current.start, periods.current.end),
    fetchBacklinksGainedLost(periods.prior.start, periods.prior.end),
    fetchBacklinksGainedLost(periods.baseline.start, periods.baseline.end),
    fetchCompetitorMovements(periods.current.start, periods.current.end),
    fetchCompetitorMovements(periods.prior.start, periods.prior.end),
    fetchCompetitorMovements(periods.baseline.start, periods.baseline.end),
  ]);

  const calcPct = (current: number, reference: number): number => {
    if (reference === 0) return 0;
    return Math.round(((current - reference) / reference) * 10000) / 100;
  };

  const content: MonthlyReportContent = {
    organic_traffic_trends: {
      current_month_sessions: currentTraffic,
      prior_month_sessions: priorTraffic,
      baseline_sessions: baselineTraffic,
      current_vs_prior_pct: calcPct(currentTraffic, priorTraffic),
      current_vs_baseline_pct: calcPct(currentTraffic, baselineTraffic),
    },
    keyword_ranking_changes: {
      current_month: currentKeywords,
      prior_month: priorKeywords,
      baseline: baselineKeywords,
    },
    technical_audit_status: {
      current_month: currentAudit,
      prior_month: priorAudit,
      baseline: baselineAudit,
    },
    content_published: {
      current_month: currentContent,
      prior_month: priorContent,
      baseline: baselineContent,
    },
    backlinks_gained_lost: {
      current_month: currentBacklinks,
      prior_month: priorBacklinks,
      baseline: baselineBacklinks,
    },
    competitor_movements: {
      current_month: currentCompetitor,
      prior_month: priorCompetitor,
      baseline: baselineCompetitor,
    },
  };

  const summaryText = await generateNarrative('monthly', content);

  const { data, error } = await supabaseAdmin
    .from('reports')
    .insert({
      type: 'monthly',
      period_start: periods.current.start,
      period_end: periods.current.end,
      content,
      summary_text: summaryText || null,
    })
    .select('id')
    .single();

  if (error) throw new Error(`Failed to persist monthly report: ${error.message}`);

  console.log(
    `[report-generator] Monthly report created: ${data.id} (${periods.current.start} → ${periods.current.end})`,
  );

  return data.id as string;
}
