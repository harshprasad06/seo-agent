#!/bin/bash
# Drizzle equivalent of `prisma db reset`
# Drops all schemas, recreates public, re-pushes schema

set -e

echo "⚠️  Resetting seo_agent database..."

psql -U apple -h localhost -p 5432 -d seo_agent -c "
  DROP SCHEMA public CASCADE;
  DROP SCHEMA IF EXISTS pgboss CASCADE;
  CREATE SCHEMA public;
  GRANT ALL ON SCHEMA public TO barbar_user;
  GRANT ALL ON SCHEMA public TO public;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO barbar_user;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO barbar_user;
"

echo "✓ Schemas dropped and recreated"

SUPABASE_DB_URL=postgresql://barbar_user:barbar123@localhost:5432/seo_agent npx drizzle-kit push

echo "✓ Schema pushed — database is clean and ready"
