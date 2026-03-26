/**
 * GET /api/init
 *
 * Bootstraps the pg-boss queue and registers all cron workers.
 * Called once on app startup (e.g. from layout.tsx server component or a
 * deployment health-check ping).
 *
 * In production, trigger this via a startup script or Railway's deploy hook.
 * In development, hit this endpoint once after `npm run dev` starts.
 *
 * Validates: Requirements 1.5, 2.3, 4.1, 6.1, 7.1
 */

import { NextResponse } from 'next/server';
import { startWorkers } from '../../../workers';

// Prevent multiple initializations within the same Node.js process
let initialized = false;

export async function GET(): Promise<NextResponse> {
  if (initialized) {
    return NextResponse.json({ status: 'already_initialized' });
  }

  try {
    await startWorkers();
    initialized = true;
    console.log('[init] pg-boss queue started and all workers registered.');
    return NextResponse.json({ status: 'ok' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[init] Failed to start workers:', message);
    // Non-fatal in development — direct TCP to Supabase free tier is blocked.
    // Workers won't run but the dashboard remains functional.
    return NextResponse.json({ status: 'workers_unavailable', message });
  }
}
