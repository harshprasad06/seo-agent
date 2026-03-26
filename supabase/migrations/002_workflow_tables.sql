-- ============================================================
-- 002_workflow_tables.sql
-- Workflow, reporting, and monitoring tables for the SEO Agent
-- Depends on: 001_core_tables.sql (keywords, pages)
-- ============================================================

-- ============================================================
-- backlinks
-- Inbound backlinks with source domain, anchor text, DA, status
-- Validates: Requirement 6.1
-- ============================================================
CREATE TABLE IF NOT EXISTS backlinks (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_domain    TEXT NOT NULL,
    source_url       TEXT NOT NULL,
    target_url       TEXT NOT NULL,
    anchor_text      TEXT,
    domain_authority INTEGER,
    status           TEXT NOT NULL,         -- 'active' | 'lost'
    first_seen_at    TIMESTAMPTZ NOT NULL,
    last_seen_at     TIMESTAMPTZ NOT NULL,
    lost_at          TIMESTAMPTZ,
    UNIQUE(source_url, target_url)
);

-- ============================================================
-- competitors
-- Competitor domains to monitor
-- Validates: Requirement 7.1
-- ============================================================
CREATE TABLE IF NOT EXISTS competitors (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    domain     TEXT NOT NULL UNIQUE,
    name       TEXT NOT NULL,
    is_active  BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- competitor_keywords
-- Keyword rankings per competitor per week
-- Validates: Requirement 7.1
-- ============================================================
CREATE TABLE IF NOT EXISTS competitor_keywords (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    competitor_id UUID NOT NULL REFERENCES competitors(id),
    keyword       TEXT NOT NULL,
    position      INTEGER,
    tracked_at    DATE NOT NULL,
    UNIQUE(competitor_id, keyword, tracked_at)
);

-- ============================================================
-- recommendations
-- AI-generated recommendations with AUTO_FIX or RECOMMENDATION
-- classification and full approval workflow
-- Validates: Requirement 9.1
-- ============================================================
CREATE TABLE IF NOT EXISTS recommendations (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type             TEXT NOT NULL,          -- e.g. 'title_tag_change', 'h1_change', 'canonical_fix'
    classification   TEXT NOT NULL,          -- 'AUTO_FIX' | 'RECOMMENDATION'
    page_id          UUID REFERENCES pages(id),
    keyword_id       UUID REFERENCES keywords(id),
    current_state    JSONB NOT NULL,         -- snapshot of current value(s)
    proposed_change  JSONB NOT NULL,         -- proposed new value(s)
    reason           TEXT NOT NULL,
    expected_impact  TEXT,
    status           TEXT NOT NULL DEFAULT 'pending',
                                             -- 'pending' | 'approved' | 'rejected' | 'applied' | 'suppressed'
    suppressed_until TIMESTAMPTZ,
    rejection_reason TEXT,
    priority         INTEGER NOT NULL DEFAULT 5,  -- 1 (highest) to 10 (lowest)
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    decided_at       TIMESTAMPTZ
);

-- ============================================================
-- audit_log
-- Append-only log of all agent actions
-- Validates: Requirement 9.1
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_log (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    action_type       TEXT NOT NULL,
    classification    TEXT NOT NULL,         -- 'AUTO_FIX' | 'RECOMMENDATION'
    recommendation_id UUID REFERENCES recommendations(id),
    page_id           UUID REFERENCES pages(id),
    before_state      JSONB,
    after_state       JSONB,
    operator_decision TEXT,                  -- 'approved' | 'rejected' | null for auto-fixes
    operator_reason   TEXT,
    executed_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- content_briefs
-- Generated content briefs with keyword targets and outlines
-- Validates: Requirement 5.2
-- ============================================================
CREATE TABLE IF NOT EXISTS content_briefs (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target_keyword_id     UUID REFERENCES keywords(id),
    title                 TEXT NOT NULL,
    secondary_keywords    TEXT[],
    h2_outline            TEXT[],
    h3_outline            JSONB,             -- nested under H2s
    estimated_word_count  INTEGER,
    competitor_references TEXT[],
    conversion_notes      TEXT,              -- for commercial/transactional keywords
    status                TEXT NOT NULL DEFAULT 'draft',  -- 'draft' | 'in_progress' | 'published'
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- outreach_opportunities
-- Backlink outreach targets with email drafts
-- Validates: Requirement 6.1
-- ============================================================
CREATE TABLE IF NOT EXISTS outreach_opportunities (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_domain         TEXT NOT NULL,
    domain_authority      INTEGER,
    relevance_score       NUMERIC(4,3),
    links_to_competitors  TEXT[],            -- competitor domains it links to
    email_draft           TEXT,
    status                TEXT NOT NULL DEFAULT 'not_contacted',
                                             -- 'not_contacted' | 'contacted' | 'link_acquired' | 'declined'
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- reports
-- Weekly/monthly/on-demand SEO reports
-- Validates: Requirement 8.1
-- ============================================================
CREATE TABLE IF NOT EXISTS reports (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type         TEXT NOT NULL,              -- 'weekly' | 'monthly' | 'on_demand'
    period_start DATE NOT NULL,
    period_end   DATE NOT NULL,
    content      JSONB NOT NULL,             -- structured report data
    summary_text TEXT,                       -- LLM-generated narrative
    s3_url       TEXT,                       -- PDF export URL
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- health_scores
-- Computed SEO health scores (0-100) with component breakdown
-- Validates: Requirement 10.1
-- ============================================================
CREATE TABLE IF NOT EXISTS health_scores (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    score           INTEGER NOT NULL,        -- 0-100 composite score
    technical_score INTEGER NOT NULL,
    onpage_score    INTEGER NOT NULL,
    keyword_score   INTEGER NOT NULL,
    backlink_score  INTEGER NOT NULL,
    computed_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
