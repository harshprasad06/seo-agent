'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { trpc } from '@/lib/trpc';
import SharedLayout from '../SharedLayout';

// ── Agent state persisted in localStorage ────────────────────────────────────

const LS_LOG = 'seo_agent_log';
const LS_STATUS = 'seo_agent_status';

interface LogEntry { step: string; status: 'ok' | 'error' | 'info'; detail: string; ts: string; }

function loadLog(): LogEntry[] {
  if (typeof window === 'undefined') return [];
  try { return JSON.parse(localStorage.getItem(LS_LOG) ?? '[]'); } catch { return []; }
}
function saveLog(log: LogEntry[]) {
  localStorage.setItem(LS_LOG, JSON.stringify(log.slice(-100)));
}
function loadStatus(): 'idle' | 'running' | 'done' {
  if (typeof window === 'undefined') return 'idle';
  return (localStorage.getItem(LS_STATUS) as any) ?? 'idle';
}
function saveStatus(s: 'idle' | 'running' | 'done') {
  localStorage.setItem(LS_STATUS, s);
  window.dispatchEvent(new CustomEvent('agent-status', { detail: s }));
}

// Singleton reader
let activeReader: ReadableStreamDefaultReader<Uint8Array> | null = null;

// ── Agent Panel ──────────────────────────────────────────────────────────────

function AgentPanel() {
  const [status, setStatus] = useState<'idle' | 'running' | 'done'>('idle');
  const [log, setLog] = useState<LogEntry[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setStatus(loadStatus());
    setLog(loadLog());
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  const appendLog = useCallback((entry: LogEntry) => {
    setLog(prev => {
      const next = [...prev, entry];
      saveLog(next);
      return next;
    });
  }, []);

  async function startAgent() {
    if (status === 'running') return;
    setLog([]); saveLog([]);
    setStatus('running'); saveStatus('running');

    try {
      const res = await fetch('/api/agent/run', { method: 'POST' });
      if (!res.body) { setStatus('done'); saveStatus('done'); return; }

      activeReader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done: streamDone, value } = await activeReader.read();
        if (streamDone) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const entry = JSON.parse(line.slice(6)) as LogEntry & { step: string };
            if (entry.step === '__done__') { setStatus('done'); saveStatus('done'); continue; }
            appendLog(entry);
          } catch { /* ignore */ }
        }
      }
    } catch (e: any) {
      appendLog({ step: 'Agent', status: 'error', detail: e.message, ts: new Date().toISOString() });
    } finally {
      activeReader = null;
      setStatus(prev => prev === 'running' ? 'done' : prev);
      saveStatus('done');
    }
  }

  function clearLog() {
    setLog([]); saveLog([]);
    setStatus('idle'); saveStatus('idle');
  }

  const statusIcon = (s: LogEntry['status']) => s === 'ok' ? '✓' : s === 'error' ? '✕' : '›';
  const statusColor = (s: LogEntry['status']) => s === 'ok' ? 'var(--success)' : s === 'error' ? 'var(--danger)' : 'var(--primary)';
  const running = status === 'running';
  const done = status === 'done';

  return (
    <div className="card" style={{ marginBottom: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: log.length > 0 ? '1rem' : 0, flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <span style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-primary)' }}>SEO Agent</span>
            {running && (
              <span className="agent-status running">
                <span className="pulsing-dot" />Running…
              </span>
            )}
            {done && <span className="agent-status done">✓ Done</span>}
          </div>
          <p style={{ margin: '0.2rem 0 0', fontSize: '0.82rem', color: 'var(--text-tertiary)' }}>
            Crawls your site, tracks keywords, syncs backlinks, and generates blog drafts
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {(done || log.length > 0) && (
            <button className="btn btn-ghost btn-sm" onClick={clearLog}>Clear</button>
          )}
          <button
            className="btn btn-primary"
            onClick={startAgent}
            disabled={running}
            style={{ minWidth: 130 }}
          >
            {running ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <span className="spinner" />Running…
              </span>
            ) : done ? '↺ Run Again' : '▶ Start Agent'}
          </button>
        </div>
      </div>

      {log.length > 0 && (
        <div ref={logRef} className="terminal-box">
          {log.map((entry, i) => (
            <div key={i} className="terminal-line">
              <span style={{ color: statusColor(entry.status), fontWeight: 700, fontSize: '0.82rem', minWidth: 14, marginTop: 1 }}>
                {statusIcon(entry.status)}
              </span>
              <div style={{ flex: 1 }}>
                <span style={{ color: '#e2e8f0', fontSize: '0.82rem', fontWeight: 600 }}>{entry.step}</span>
                {entry.detail && <span style={{ color: '#94a3b8', fontSize: '0.82rem' }}> — {entry.detail}</span>}
              </div>
              <span style={{ color: '#475569', fontSize: '0.72rem', flexShrink: 0 }}>
                {new Date(entry.ts).toLocaleTimeString()}
              </span>
            </div>
          ))}
          {running && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', paddingTop: '0.4rem' }}>
              <span className="pulsing-dot" />
              <span style={{ color: 'var(--text-tertiary)', fontSize: '0.82rem' }}>Working…</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="stat-card">
      <p className="stat-label">{label}</p>
      <p className="stat-value" style={color ? { color } : undefined}>{value}</p>
      {sub && <p className="stat-sub">{sub}</p>}
    </div>
  );
}

// ── Health Score ──────────────────────────────────────────────────────────────

function HealthScore() {
  const { data: rawData, isLoading } = trpc.insights.feed.useQuery();
  const data = rawData as any[] | undefined;
  const score = data ? Math.max(0, 100 - data.length * 10) : null;
  const color = score === null ? 'var(--text-tertiary)' : score >= 80 ? 'var(--success)' : score >= 50 ? 'var(--warning)' : 'var(--danger)';
  const label = score === null ? '—' : score >= 80 ? 'Good' : score >= 50 ? 'Needs Work' : 'Poor';
  return (
    <div className="stat-card">
      <p className="stat-label">SEO Health Score</p>
      {isLoading ? <p className="text-muted">Loading…</p> : (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
            <span className="stat-value" style={{ color }}>{score ?? '—'}</span>
            <span style={{ color: 'var(--text-tertiary)', fontSize: '0.9rem' }}>/100</span>
          </div>
          <div className="progress-bar" style={{ marginTop: '0.5rem' }}>
            <div className="progress-fill" style={{ width: `${score ?? 0}%`, background: color }} />
          </div>
          <p className="stat-sub" style={{ color }}>{label} · {data?.length ?? 0} pending</p>
        </>
      )}
    </div>
  );
}

// ── Action Queue ─────────────────────────────────────────────────────────────

function ActionQueue() {
  const { data: rawData, isLoading, refetch } = trpc.recommendations.queue.useQuery();
  const data = rawData as any[] | undefined;
  const approve = trpc.recommendations.approve.useMutation({ onSuccess: () => refetch() });
  const reject = trpc.recommendations.reject.useMutation({ onSuccess: () => refetch() });
  const [reasons, setReasons] = useState<Record<string, string>>({});
  return (
    <div className="card-flat">
      <div className="card-header">
        <span className="card-title">Action Queue</span>
        {data && data.length > 0 && <span className="badge badge-count">{data.length}</span>}
      </div>
      {isLoading && <p className="text-muted">Loading…</p>}
      {data?.length === 0 && <p className="text-muted">No pending actions — all clear ✓</p>}
      {data?.map((rec: any) => (
        <div key={rec.id} className="queue-item">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', marginBottom: '0.3rem' }}>
                <span className={`badge ${rec.classification === 'AUTO_FIX' ? 'badge-info' : 'badge-warning'}`}>
                  {rec.classification}
                </span>
                <span className="badge badge-neutral">P{rec.priority}</span>
              </div>
              <p style={{ margin: 0, fontSize: '0.875rem', fontWeight: 500, color: 'var(--text-primary)' }}>
                {rec.recommendation_text ?? rec.type ?? rec.id}
              </p>
              {rec.reason && <p style={{ margin: '0.2rem 0 0', fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>{rec.reason}</p>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.65rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="btn btn-success btn-sm" onClick={() => approve.mutate({ id: rec.id })} disabled={approve.isPending}>✓ Approve</button>
            <input className="input" placeholder="Reject reason…" value={reasons[rec.id] ?? ''} onChange={e => setReasons(r => ({ ...r, [rec.id]: e.target.value }))} style={{ flex: 1, minWidth: 120, fontSize: '0.8rem', padding: '0.3rem 0.5rem' }} />
            <button className="btn btn-danger btn-sm" onClick={() => reject.mutate({ id: rec.id, reason: reasons[rec.id] ?? '' })} disabled={reject.isPending || !reasons[rec.id]}>✕</button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Auto-Fix Feed ────────────────────────────────────────────────────────────

function AutoFixFeed() {
  const { data: rawData, isLoading } = trpc.auditLog.feed.useQuery();
  const data = rawData as any[] | undefined;
  return (
    <div className="card-flat">
      <div className="card-header">
        <span className="card-title">Auto-Fix Feed</span>
      </div>
      {isLoading && <p className="text-muted">Loading…</p>}
      {data?.length === 0 && <p className="text-muted">No auto-fixes yet — start the agent to begin.</p>}
      {data?.slice(0, 8).map((entry: any) => (
        <div key={entry.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.55rem 0', borderBottom: '1px solid var(--border-secondary)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ color: 'var(--success)', fontSize: '0.9rem' }}>✓</span>
            <span style={{ fontSize: '0.875rem', color: 'var(--text-primary)', fontWeight: 500 }}>{entry.action_type}</span>
            {entry.after_state?.pr_url && (
              <a href={entry.after_state.pr_url} target="_blank" rel="noreferrer" style={{ fontSize: '0.75rem', color: 'var(--primary)' }}>PR →</a>
            )}
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
            {entry.executed_at ? new Date(entry.executed_at).toLocaleString() : ''}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Top Insights ─────────────────────────────────────────────────────────────

function TopInsights() {
  const { data: rawData, isLoading } = trpc.insights.feed.useQuery();
  const data = rawData as any[] | undefined;
  return (
    <div className="card-flat">
      <div className="card-header">
        <span className="card-title">Top Insights</span>
      </div>
      {isLoading && <p className="text-muted">Loading…</p>}
      {data?.length === 0 && <p className="text-muted">No insights yet — start the agent to generate recommendations.</p>}
      {data?.map((insight: any, i: number) => (
        <div key={insight.id ?? i} style={{ display: 'flex', gap: '0.75rem', padding: '0.6rem 0', borderBottom: '1px solid var(--border-secondary)', alignItems: 'flex-start' }}>
          <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'white', background: 'var(--primary)', borderRadius: '50%', width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 }}>{i + 1}</span>
          <div>
            <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-primary)', fontWeight: 500 }}>{insight.recommendation_text ?? insight.type ?? insight.id}</p>
            {insight.reason && <p style={{ margin: '0.15rem 0 0', fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>{insight.reason}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  return (
    <SharedLayout>
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
        <p className="page-subtitle">
          {new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </p>
      </div>

      <AgentPanel />

      <div className="stats-grid">
        <HealthScore />
        <StatCard label="Site" value="learnwealthx.in" sub="Active monitoring" />
        <StatCard label="Workers" value="7" sub="Cron jobs registered" color="var(--primary)" />
        <StatCard label="Stack" value="Free tier" sub="Gemini · Serper · Groq" />
      </div>

      <div className="panels-grid">
        <ActionQueue />
        <AutoFixFeed />
      </div>

      <TopInsights />
    </SharedLayout>
  );
}
