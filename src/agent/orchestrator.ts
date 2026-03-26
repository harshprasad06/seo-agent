/**
 * SEO Agent Orchestrator
 * Uses Gemini 2.0 Flash to classify tasks and dispatch to the appropriate tool.
 *
 * Validates: Requirements 3.1, 4.1, 5.1, 6.1, 7.1, 8.1
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { keywordResearch } from './tools/keyword-research';
import { runOnPageAudit } from './tools/onpage-auditor';
import { runTechnicalAudit } from './tools/technical-auditor';
import { runStructuredDataValidation } from './tools/structured-data-validator';
import { analyzeContentGaps } from './tools/content-gap-analyzer';
import { generateContentBrief } from './tools/content-brief-generator';
import { analyzeBacklinks } from './tools/backlink-analyzer';
import { generateOutreachDraft } from './tools/outreach-drafter';
import { identifyDisplacementOpportunities } from './tools/displacement-identifier';
import { generateWeeklyReport, generateMonthlyReport } from './tools/report-generator';
import { calculateHealthScore } from './tools/health-score-calculator';
import { analyzeTrafficDrop } from './tools/root-cause-analyzer';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AgentResult {
  tool: string;
  result: unknown;
  error?: string;
}

type ToolName =
  | 'keyword_research'
  | 'onpage_auditor'
  | 'technical_auditor'
  | 'structured_data_validator'
  | 'content_gap_analyzer'
  | 'content_brief_generator'
  | 'backlink_analyzer'
  | 'outreach_drafter'
  | 'displacement_identifier'
  | 'report_generator_weekly'
  | 'report_generator_monthly'
  | 'health_score_calculator'
  | 'root_cause_analyzer'
  | 'full_audit';

// ── Tool registry ─────────────────────────────────────────────────────────────

/**
 * Maps tool names to their executor functions.
 * Each executor accepts an optional params object for tools that require arguments.
 */
const TOOL_REGISTRY: Record<string, (params?: Record<string, unknown>) => Promise<unknown>> = {
  keyword_research: (params) => keywordResearch((params?.topic as string) ?? ''),
  onpage_auditor: (params) => runOnPageAudit(params?.pageId as string | undefined),
  technical_auditor: (params) => runTechnicalAudit(params?.pageId as string | undefined),
  structured_data_validator: (params) =>
    runStructuredDataValidation(params?.pageId as string | undefined),
  content_gap_analyzer: () => analyzeContentGaps(),
  content_brief_generator: (params) =>
    generateContentBrief((params?.keywordId as string) ?? ''),
  backlink_analyzer: () => analyzeBacklinks(),
  outreach_drafter: (params) =>
    generateOutreachDraft((params?.opportunityId as string) ?? ''),
  displacement_identifier: () => identifyDisplacementOpportunities(),
  report_generator_weekly: () => generateWeeklyReport(),
  report_generator_monthly: () => generateMonthlyReport(),
  health_score_calculator: () => calculateHealthScore(),
  root_cause_analyzer: (params) =>
    analyzeTrafficDrop(
      (params?.current as number) ?? 0,
      (params?.prior as number) ?? 0,
    ),
};

const VALID_TOOL_NAMES = Object.keys(TOOL_REGISTRY).concat(['full_audit']) as ToolName[];

// ── Gemini task classifier ────────────────────────────────────────────────────

async function classifyTask(task: string): Promise<ToolName> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable is not set');
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

  const prompt = `You are an SEO agent task router. Given a task description, respond with ONLY the single most appropriate tool name from this list:

${VALID_TOOL_NAMES.join('\n')}

Tool descriptions:
- keyword_research: Find and research keywords for a topic
- onpage_auditor: Audit on-page SEO elements (title, meta, H1, alt text)
- technical_auditor: Audit technical SEO issues (broken links, redirects, canonicals, server errors)
- structured_data_validator: Validate JSON-LD structured data on pages
- content_gap_analyzer: Identify content gaps vs competitors
- content_brief_generator: Generate a content brief for a keyword
- backlink_analyzer: Analyze backlinks and find outreach opportunities
- outreach_drafter: Draft outreach emails for link building
- displacement_identifier: Identify keywords where we can displace competitors
- report_generator_weekly: Generate a weekly SEO performance report
- report_generator_monthly: Generate a monthly SEO executive summary
- health_score_calculator: Calculate the overall SEO health score
- root_cause_analyzer: Analyze the root cause of a traffic drop
- full_audit: Run a complete SEO audit (on-page + technical + structured data + health score)

Task: "${task}"

Respond with ONLY the tool name, nothing else.`;

  const result = await model.generateContent(prompt);
  const toolName = result.response.text().trim().toLowerCase() as ToolName;

  if (!VALID_TOOL_NAMES.includes(toolName)) {
    console.warn(
      `[orchestrator] Gemini returned unknown tool "${toolName}" — defaulting to full_audit`,
    );
    return 'full_audit';
  }

  return toolName;
}

// ── Full audit ────────────────────────────────────────────────────────────────

/**
 * Runs all audit tools in sequence: on-page, technical, structured data, health score.
 */
export async function runFullAudit(): Promise<void> {
  console.log('[orchestrator] Starting full audit...');

  const steps: Array<{ name: string; fn: () => Promise<unknown> }> = [
    { name: 'onpage_auditor', fn: () => runOnPageAudit() },
    { name: 'technical_auditor', fn: () => runTechnicalAudit() },
    { name: 'structured_data_validator', fn: () => runStructuredDataValidation() },
    { name: 'health_score_calculator', fn: () => calculateHealthScore() },
  ];

  for (const step of steps) {
    try {
      console.log(`[orchestrator] Running ${step.name}...`);
      await step.fn();
      console.log(`[orchestrator] ${step.name} complete.`);
    } catch (err) {
      console.error(
        `[orchestrator] ${step.name} failed:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  console.log('[orchestrator] Full audit complete.');
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Accepts a task description, uses Gemini to classify it into a tool,
 * executes the tool, and returns a structured result.
 */
export async function runAgentTask(task: string): Promise<AgentResult> {
  let toolName: ToolName;

  try {
    toolName = await classifyTask(task);
  } catch (err) {
    return {
      tool: 'unknown',
      result: null,
      error: `Failed to classify task: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  console.log(`[orchestrator] Task classified as: ${toolName}`);

  // Handle full_audit as a special case
  if (toolName === 'full_audit') {
    try {
      await runFullAudit();
      return { tool: 'full_audit', result: { status: 'completed' } };
    } catch (err) {
      return {
        tool: 'full_audit',
        result: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  const executor = TOOL_REGISTRY[toolName];
  if (!executor) {
    return {
      tool: toolName,
      result: null,
      error: `No executor found for tool "${toolName}"`,
    };
  }

  try {
    const result = await executor();
    return { tool: toolName, result };
  } catch (err) {
    return {
      tool: toolName,
      result: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
