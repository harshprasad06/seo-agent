import type { Config } from 'drizzle-kit';

export default {
  schema: './src/lib/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.SUPABASE_DB_URL ?? 'postgresql://barbar_user:barbar123@localhost:5432/seo_agent',
  },
} satisfies Config;
