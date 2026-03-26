import {
  pgTable, uuid, text, integer, boolean, numeric,
  date, timestamp, jsonb, unique,
} from 'drizzle-orm/pg-core';

// ── oauth_tokens ──────────────────────────────────────────────────────────────
export const oauthTokens = pgTable('oauth_tokens', {
  id:           uuid('id').primaryKey().defaultRandom(),
  provider:     text('provider').notNull().unique(),
  accessToken:  text('access_token').notNull(),
  refreshToken: text('refresh_token').notNull(),
  expiresAt:    timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── gsc_data_points ───────────────────────────────────────────────────────────
export const gscDataPoints = pgTable('gsc_data_points', {
  id:          uuid('id').primaryKey().defaultRandom(),
  url:         text('url').notNull(),
  query:       text('query'),
  date:        date('date').notNull(),
  clicks:      integer('clicks').notNull().default(0),
  impressions: integer('impressions').notNull().default(0),
  ctr:         numeric('ctr', { precision: 5, scale: 4 }),
  position:    numeric('position', { precision: 6, scale: 2 }),
  syncedAt:    timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [unique().on(t.url, t.query, t.date)]);

// ── ga_data_points ────────────────────────────────────────────────────────────
export const gaDataPoints = pgTable('ga_data_points', {
  id:              uuid('id').primaryKey().defaultRandom(),
  landingPage:     text('landing_page').notNull(),
  date:            date('date').notNull(),
  organicSessions: integer('organic_sessions').notNull().default(0),
  bounceRate:      numeric('bounce_rate', { precision: 5, scale: 4 }),
  goalCompletions: integer('goal_completions').notNull().default(0),
  syncedAt:        timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [unique().on(t.landingPage, t.date)]);

// ── keywords ──────────────────────────────────────────────────────────────────
export const keywords = pgTable('keywords', {
  id:                uuid('id').primaryKey().defaultRandom(),
  keyword:           text('keyword').notNull().unique(),
  intentCluster:     text('intent_cluster'),
  searchVolume:      integer('search_volume'),
  difficulty:        integer('difficulty'),
  currentPosition:   integer('current_position'),
  previousPosition:  integer('previous_position'),
  positionUpdatedAt: timestamp('position_updated_at', { withTimezone: true }),
  isTracked:         boolean('is_tracked').notNull().default(false),
  isApproved:        boolean('is_approved').notNull().default(false),
  status:            text('status'),
  createdAt:         timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── pages ─────────────────────────────────────────────────────────────────────
export const pages = pgTable('pages', {
  id:               uuid('id').primaryKey().defaultRandom(),
  url:              text('url').notNull().unique(),
  titleTag:         text('title_tag'),
  metaDescription:  text('meta_description'),
  h1:               text('h1'),
  canonicalUrl:     text('canonical_url'),
  primaryKeywordId: uuid('primary_keyword_id').references(() => keywords.id),
  lastCrawledAt:    timestamp('last_crawled_at', { withTimezone: true }),
  indexable:        boolean('indexable'),
  httpStatus:       integer('http_status'),
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── page_crawl_results ────────────────────────────────────────────────────────
export const pageCrawlResults = pgTable('page_crawl_results', {
  id:              uuid('id').primaryKey().defaultRandom(),
  pageId:          uuid('page_id').notNull().references(() => pages.id),
  crawledAt:       timestamp('crawled_at', { withTimezone: true }).notNull().defaultNow(),
  titleTag:        text('title_tag'),
  metaDescription: text('meta_description'),
  h1:              text('h1'),
  h2Tags:          text('h2_tags').array(),
  h3Tags:          text('h3_tags').array(),
  altTextMissing:  integer('alt_text_missing'),
  canonicalUrl:    text('canonical_url'),
  httpStatus:      integer('http_status'),
  redirectChain:   jsonb('redirect_chain'),
  structuredData:  jsonb('structured_data'),
  internalLinks:   text('internal_links').array(),
  brokenLinks:     text('broken_links').array(),
  wordCount:       integer('word_count'),
});

// ── cwv_results ───────────────────────────────────────────────────────────────
export const cwvResults = pgTable('cwv_results', {
  id:         uuid('id').primaryKey().defaultRandom(),
  pageId:     uuid('page_id').notNull().references(() => pages.id),
  measuredAt: timestamp('measured_at', { withTimezone: true }).notNull().defaultNow(),
  lcpMs:      integer('lcp_ms'),
  inpMs:      integer('inp_ms'),
  clsScore:   numeric('cls_score', { precision: 6, scale: 4 }),
  lcpRating:  text('lcp_rating'),
  inpRating:  text('inp_rating'),
  clsRating:  text('cls_rating'),
});

// ── backlinks ─────────────────────────────────────────────────────────────────
export const backlinks = pgTable('backlinks', {
  id:              uuid('id').primaryKey().defaultRandom(),
  sourceDomain:    text('source_domain').notNull(),
  sourceUrl:       text('source_url').notNull(),
  targetUrl:       text('target_url').notNull(),
  anchorText:      text('anchor_text'),
  domainAuthority: integer('domain_authority'),
  status:          text('status').notNull(),
  firstSeenAt:     timestamp('first_seen_at', { withTimezone: true }).notNull(),
  lastSeenAt:      timestamp('last_seen_at', { withTimezone: true }).notNull(),
  lostAt:          timestamp('lost_at', { withTimezone: true }),
}, t => [unique().on(t.sourceUrl, t.targetUrl)]);

// ── competitors ───────────────────────────────────────────────────────────────
export const competitors = pgTable('competitors', {
  id:        uuid('id').primaryKey().defaultRandom(),
  domain:    text('domain').notNull().unique(),
  name:      text('name').notNull(),
  isActive:  boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── competitor_keywords ───────────────────────────────────────────────────────
export const competitorKeywords = pgTable('competitor_keywords', {
  id:           uuid('id').primaryKey().defaultRandom(),
  competitorId: uuid('competitor_id').notNull().references(() => competitors.id),
  keyword:      text('keyword').notNull(),
  position:     integer('position'),
  trackedAt:    date('tracked_at').notNull(),
}, t => [unique().on(t.competitorId, t.keyword, t.trackedAt)]);

// ── recommendations ───────────────────────────────────────────────────────────
export const recommendations = pgTable('recommendations', {
  id:              uuid('id').primaryKey().defaultRandom(),
  type:            text('type').notNull(),
  classification:  text('classification').notNull(),
  pageId:          uuid('page_id').references(() => pages.id),
  keywordId:       uuid('keyword_id').references(() => keywords.id),
  currentState:    jsonb('current_state').notNull(),
  proposedChange:  jsonb('proposed_change').notNull(),
  reason:          text('reason').notNull(),
  expectedImpact:  text('expected_impact'),
  status:          text('status').notNull().default('pending'),
  suppressedUntil: timestamp('suppressed_until', { withTimezone: true }),
  rejectionReason: text('rejection_reason'),
  priority:        integer('priority').notNull().default(5),
  createdAt:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  decidedAt:       timestamp('decided_at', { withTimezone: true }),
});

// ── audit_log ─────────────────────────────────────────────────────────────────
export const auditLog = pgTable('audit_log', {
  id:               uuid('id').primaryKey().defaultRandom(),
  actionType:       text('action_type').notNull(),
  classification:   text('classification').notNull(),
  recommendationId: uuid('recommendation_id').references(() => recommendations.id),
  pageId:           uuid('page_id').references(() => pages.id),
  beforeState:      jsonb('before_state'),
  afterState:       jsonb('after_state'),
  operatorDecision: text('operator_decision'),
  operatorReason:   text('operator_reason'),
  executedAt:       timestamp('executed_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── content_briefs ────────────────────────────────────────────────────────────
export const contentBriefs = pgTable('content_briefs', {
  id:                   uuid('id').primaryKey().defaultRandom(),
  targetKeywordId:      uuid('target_keyword_id').references(() => keywords.id),
  title:                text('title').notNull(),
  secondaryKeywords:    text('secondary_keywords').array(),
  h2Outline:            text('h2_outline').array(),
  h3Outline:            jsonb('h3_outline'),
  estimatedWordCount:   integer('estimated_word_count'),
  competitorReferences: text('competitor_references').array(),
  conversionNotes:      text('conversion_notes'),
  status:               text('status').notNull().default('draft'),
  createdAt:            timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── outreach_opportunities ────────────────────────────────────────────────────
export const outreachOpportunities = pgTable('outreach_opportunities', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  sourceDomain:       text('source_domain').notNull(),
  domainAuthority:    integer('domain_authority'),
  relevanceScore:     numeric('relevance_score', { precision: 4, scale: 3 }),
  linksToCompetitors: text('links_to_competitors').array(),
  emailDraft:         text('email_draft'),
  status:             text('status').notNull().default('not_contacted'),
  createdAt:          timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:          timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── reports ───────────────────────────────────────────────────────────────────
export const reports = pgTable('reports', {
  id:          uuid('id').primaryKey().defaultRandom(),
  type:        text('type').notNull(),
  periodStart: date('period_start').notNull(),
  periodEnd:   date('period_end').notNull(),
  content:     jsonb('content').notNull(),
  summaryText: text('summary_text'),
  s3Url:       text('s3_url'),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── health_scores ─────────────────────────────────────────────────────────────
export const healthScores = pgTable('health_scores', {
  id:             uuid('id').primaryKey().defaultRandom(),
  score:          integer('score').notNull(),
  technicalScore: integer('technical_score').notNull(),
  onpageScore:    integer('onpage_score').notNull(),
  keywordScore:   integer('keyword_score').notNull(),
  backlinkScore:  integer('backlink_score').notNull(),
  computedAt:     timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── blog_posts ────────────────────────────────────────────────────────────────
export const blogPosts = pgTable('blog_posts', {
  id:            uuid('id').primaryKey().defaultRandom(),
  targetKeyword: text('target_keyword').notNull(),
  title:         text('title').notNull(),
  slug:          text('slug').notNull().unique(),
  mdxContent:    text('mdx_content').notNull(),
  h2Outline:     text('h2_outline').array(),
  wordCount:     integer('word_count'),
  status:        text('status').notNull().default('draft'),
  prUrl:         text('pr_url'),
  rejectionNote: text('rejection_note'),
  createdAt:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
