-- Enable pgcrypto for UUID generation
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- oauth_tokens
-- Stores GSC/GA OAuth tokens encrypted at rest
-- ============================================================
CREATE TABLE IF NOT EXISTS oauth_tokens (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider        TEXT NOT NULL UNIQUE,   -- 'gsc' | 'ga'
    access_token    TEXT NOT NULL,          -- encrypted at rest (AES-256)
    refresh_token   TEXT NOT NULL,          -- encrypted at rest (AES-256)
    expires_at      TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Add unique constraint if table already exists without it
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'oauth_tokens_provider_key'
  ) THEN
    ALTER TABLE oauth_tokens ADD CONSTRAINT oauth_tokens_provider_key UNIQUE (provider);
  END IF;
END $$;

-- ============================================================
-- gsc_data_points
-- GSC search analytics data per URL/query/date
-- ============================================================
CREATE TABLE IF NOT EXISTS gsc_data_points (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    url             TEXT NOT NULL,
    query           TEXT,                   -- null for URL-level aggregates
    date            DATE NOT NULL,
    clicks          INTEGER NOT NULL DEFAULT 0,
    impressions     INTEGER NOT NULL DEFAULT 0,
    ctr             NUMERIC(5,4),
    position        NUMERIC(6,2),
    synced_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(url, query, date)
);

-- ============================================================
-- ga_data_points
-- GA4 organic traffic data per landing page/date
-- ============================================================
CREATE TABLE IF NOT EXISTS ga_data_points (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    landing_page    TEXT NOT NULL,
    date            DATE NOT NULL,
    organic_sessions INTEGER NOT NULL DEFAULT 0,
    bounce_rate     NUMERIC(5,4),
    goal_completions INTEGER NOT NULL DEFAULT 0,
    synced_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(landing_page, date)
);

-- ============================================================
-- keywords
-- Keyword tracking with intent cluster, volume, difficulty, position
-- ============================================================
CREATE TABLE IF NOT EXISTS keywords (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    keyword             TEXT NOT NULL UNIQUE,
    intent_cluster      TEXT,               -- 'informational' | 'navigational' | 'commercial' | 'transactional'
    search_volume       INTEGER,
    difficulty          INTEGER,            -- 0-100
    current_position    INTEGER,            -- null if unranked (>100)
    previous_position   INTEGER,
    position_updated_at TIMESTAMPTZ,
    is_tracked          BOOLEAN NOT NULL DEFAULT false,
    is_approved         BOOLEAN NOT NULL DEFAULT false,
    status              TEXT,               -- 'ranked' | 'unranked_opportunity'
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- pages
-- Indexed pages with on-page SEO fields
-- ============================================================
CREATE TABLE IF NOT EXISTS pages (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    url                 TEXT NOT NULL UNIQUE,
    title_tag           TEXT,
    meta_description    TEXT,
    h1                  TEXT,
    canonical_url       TEXT,
    primary_keyword_id  UUID REFERENCES keywords(id),
    last_crawled_at     TIMESTAMPTZ,
    indexable           BOOLEAN,
    http_status         INTEGER,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- page_crawl_results
-- Raw crawl output per page
-- ============================================================
CREATE TABLE IF NOT EXISTS page_crawl_results (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    page_id             UUID NOT NULL REFERENCES pages(id),
    crawled_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    title_tag           TEXT,
    meta_description    TEXT,
    h1                  TEXT,
    h2_tags             TEXT[],
    h3_tags             TEXT[],
    alt_text_missing    INTEGER,            -- count of images missing alt text
    canonical_url       TEXT,
    http_status         INTEGER,
    redirect_chain      JSONB,              -- array of redirect hops
    structured_data     JSONB,              -- extracted JSON-LD blocks
    internal_links      TEXT[],
    broken_links        TEXT[],
    word_count          INTEGER
);

-- ============================================================
-- cwv_results
-- Core Web Vitals per page (LCP, INP, CLS with ratings)
-- ============================================================
CREATE TABLE IF NOT EXISTS cwv_results (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    page_id     UUID NOT NULL REFERENCES pages(id),
    measured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    lcp_ms      INTEGER,                    -- Largest Contentful Paint in ms
    inp_ms      INTEGER,                    -- Interaction to Next Paint in ms
    cls_score   NUMERIC(6,4),              -- Cumulative Layout Shift
    lcp_rating  TEXT,                       -- 'good' | 'needs_improvement' | 'poor'
    inp_rating  TEXT,
    cls_rating  TEXT
);
