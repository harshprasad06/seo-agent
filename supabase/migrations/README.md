# Supabase Migrations

This directory contains SQL migration files for the SEO Agent database schema.

## Running Migrations

### Option 1: Supabase CLI (recommended)

1. Install the Supabase CLI:
   ```bash
   npm install -g supabase
   ```

2. Link your project:
   ```bash
   supabase link --project-ref <your-project-ref>
   ```
   Your project ref is in the Supabase dashboard URL: `https://app.supabase.com/project/<project-ref>`

3. Push all pending migrations:
   ```bash
   supabase db push
   ```

### Option 2: Supabase SQL Editor

1. Open your project at [app.supabase.com](https://app.supabase.com)
2. Navigate to **SQL Editor**
3. Open each migration file in order (e.g. `001_core_tables.sql`)
4. Paste the contents and click **Run**

### Option 3: psql directly

```bash
psql "$DATABASE_URL" -f supabase/migrations/001_core_tables.sql
```

Your `DATABASE_URL` is available in the Supabase dashboard under **Settings → Database → Connection string**.

## Migration Files

| File | Description |
|---|---|
| `001_core_tables.sql` | Core tables: `oauth_tokens`, `gsc_data_points`, `ga_data_points`, `keywords`, `pages`, `page_crawl_results`, `cwv_results` |
| `002_workflow_tables.sql` | Workflow & reporting tables: `backlinks`, `competitors`, `competitor_keywords`, `recommendations`, `audit_log`, `content_briefs`, `outreach_opportunities`, `reports`, `health_scores` |

## Notes

- Migrations are idempotent (`CREATE TABLE IF NOT EXISTS`) — safe to re-run.
- The `pgcrypto` extension is enabled for UUID generation via `gen_random_uuid()`.
- `oauth_tokens.access_token` and `refresh_token` are stored encrypted at rest using AES-256 — encryption/decryption is handled at the application layer before writing to and after reading from the database.
