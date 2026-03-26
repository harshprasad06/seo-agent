'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc';

// ── Agent state persisted in localStorage ────────────────────────────────────

const LS_LOG = 'seo_agent_log';
const LS_STATUS = 'seo_agent_status'; // 'idle' | 'running' | 'done'

interface LogEntry { step: string; status: 'ok' | 'error' | 'info'; detail: string; ts: string; }

function loadLog(): LogEntry[] {
  if (typeof window === 'undefined') return [];
  try { return JSON.parse(localStorage.getItem(LS_LOG) ?? '[]'); } catch { return []; }
}
function saveLog(log: LogEntry[]) {
  localStorage.setItem(LS_LOG, JSON.stringify(log.slice(-100))); // keep last 100 entries
}
function loadStatus(): 'idle' | 'running' | 'done' {
  if (typeof window === 'undefined') return 'idle';
  return (localStorage.getItem(LS_STATUS) as any) ?? 'idle';
}
function saveStatus(s: 'idle' | 'running' | 'done') {
  localStorage.setItem(LS_STATUS, s);
  // Broadcast to other tabs/pages
  window.dispatchEvent(new CustomEvent('agent-status', { detail: s }));
}

// ── Nav ───────────────────────────────────────────────────────────────────────

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: '⬛' },
  { href: '/keywords', label: 'Keywords', icon: '🔑' },
  { href: '/content', label: 'Blog Posts', icon: '✍️' },
  { href: '/pages', label: 'Pages', icon: '📄' },
  { href: '/technical', label: 'Technical', icon: '⚙️' },
  { href: '/backlinks', label: 'Backlinks', icon: '🔗' },
  { href: '/competitors', label: 'Competitors', icon: '📊' },
  { href: '/reports', label: 'Reports', icon: '📈' },
];

function Sidebar({ email }: { email: string }) {
  const path = typeof window !== 'undefined' ? window.location.pathname : '';
  const [agentStatus, setAgentStatus] = useState<'idle' | 'running' | 'done'>('idle');

  useEffect(() => {
    setAgentStatus(loadStatus());
    const handler = (e: Event) => setAgentStatus((e as CustomEvent).detail);
    window.addEventListener('agent-status', handler);
    return () => window.removeEventListener('agent-status', handler);
  }, []);

  const running = agentStatus === 'running';

  return (
    <aside style={sidebarStyle}>
      <div style={{ padding: '1.5rem 1.25rem 1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
          <span style={{ fontSize: '1.25rem' }}>{running ? '🟢' : '🤖'}</span>
          <span style={{ fontWeight: 700, fontSize: '1rem', color: '#fff' }}>SEO Agent</span>
        </div>
        <p style={{ fontSize: '0.7rem', color: running ? '#4ade80' : '#94a3b8', margin: 0 }}>
          {running ? '● Running…' : 'learnwealthx.in'}
        </p>
      </div>
      <nav style={{ padding: '0 0.75rem', flex: 1 }}>
        {NAV_ITEMS.map(item => (
          <a key={item.href} href={item.href} style={{
            display: 'flex', alignItems: 'center', gap: '0.6rem',
            padding: '0.55rem 0.75rem', borderRadius: 6, marginBottom: '0.15rem',
            textDecoration: 'none', fontSize: '0.875rem',
            background: path === item.href ? 'rgba(255,255,255,0.12)' : 'transparent',
            color: path === item.href ? '#fff' : '#94a3b8',
            fontWeight: path === item.href ? 600 : 400,
          }}>
            <span style={{ fontSize: '0.9rem' }}>{item.icon}</span>
            {item.label}
          </a>
        ))}
      </nav>
      <div style={{ padding: '1rem 1.25rem', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
        <p style={{ fontSize: '0.75rem', color: '#64748b', margin: '0 0 0.5rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{email}</p>
        <button onClick={() => signOut({ callbackUrl: '/auth/signin' })} style={signOutBtn}>Sign out</button>
      </div>
    </aside>
  );
}

// ── Agent Control Panel ───────────────────────────────────────────────────────

// Singleton reader — survives re-renders but not page navigation
let activeReader: ReadableStreamDefaultReader<Uint8Array> | null = null;

function AgentPanel() {
  const [status, setStatus] = useState<'idle' | 'running' | 'done'>('idle');
  const [log, setLog] = useState<LogEntry[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  // Restore state from localStorage on mount
  useEffect(() => {
    const savedStatus = loadStatus();
    const savedLog = loadLog();
    setStatus(savedStatus);
    setLog(savedLog);
  }, []);

  // Auto-scroll log
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
    if (status === 'running') return; // prevent double-run

    // Clear previous log
    setLog([]);
    saveLog([]);
    setStatus('running');
    saveStatus('running');

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
            if (entry.step === '__done__') {
              setStatus('done');
              saveStatus('done');
              continue;
            }
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
    setLog([]);
    saveLog([]);
    setStatus('idle');
    saveStatus('idle');
  }

  const statusIcon = (s: LogEntry['status']) => s === 'ok' ? '✓' : s === 'error' ? '✕' : '›';
  const statusColor = (s: LogEntry['status']) => s === 'ok' ? '#16a34a' : s === 'error' ? '#dc2626' : '#2563eb';
  const running = status === 'running';
  const done = status === 'done';

  return (
    <div style={{ ...panelStyle, marginBottom: '1.25rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: log.length > 0 ? '1rem' : 0 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <span style={{ fontWeight: 700, fontSize: '1rem', color: '#0f172a' }}>SEO Agent</span>
            {running && (
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.78rem', color: '#2563eb', fontWeight: 600 }}>
                <span style={pulsingDot} />Running…
              </span>
            )}
            {done && (
              <span style={{ fontSize: '0.78rem', color: '#16a34a', fontWeight: 600 }}>✓ Done</span>
            )}
          </div>
          <p style={{ margin: '0.15rem 0 0', fontSize: '0.8rem', color: '#64748b' }}>
            Crawls your site, tracks keywords, syncs backlinks, and generates blog drafts
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {(done || log.length > 0) && (
            <button onClick={clearLog} style={{ ...startBtn, background: '#f1f5f9', color: '#64748b', fontSize: '0.8rem', padding: '0.5rem 0.75rem' }}>
              Clear
            </button>
          )}
          <button
            onClick={startAgent}
            disabled={running}
            style={{ ...startBtn, background: running ? '#94a3b8' : '#2563eb', cursor: running ? 'not-allowed' : 'pointer', minWidth: 130 }}
          >
            {running ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <span style={spinnerStyle} />Running…
              </span>
            ) : done ? '↺ Run Again' : '▶ Start Agent'}
          </button>
        </div>
      </div>

      {log.length > 0 && (
        <div ref={logRef} style={logBox}>
          {log.map((entry, i) => (
            <div key={i} style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start', padding: '0.3rem 0', borderBottom: i < log.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none' }}>
              <span style={{ color: statusColor(entry.status), fontWeight: 700, fontSize: '0.8rem', minWidth: 14, marginTop: 1 }}>
                {statusIcon(entry.status)}
              </span>
              <div style={{ flex: 1 }}>
                <span style={{ color: '#e2e8f0', fontSize: '0.82rem', fontWeight: 600 }}>{entry.step}</span>
                {entry.detail && <span style={{ color: '#94a3b8', fontSize: '0.8rem' }}> — {entry.detail}</span>}
              </div>
              <span style={{ color: '#475569', fontSize: '0.72rem', flexShrink: 0 }}>
                {new Date(entry.ts).toLocaleTimeString()}
              </span>
            </div>
          ))}
          {running && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', paddingTop: '0.4rem' }}>
              <span style={pulsingDot} />
              <span style={{ color: '#64748b', fontSize: '0.8rem' }}>Working…</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}


// ── Stat Card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div style={statCardStyle}>
      <p style={{ margin: '0 0 0.35rem', fontSize: '0.8rem', color: '#64748b', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</p>
      <p style={{ margin: 0, fontSize: '2rem', fontWeight: 700, color: color ?? '#0f172a', lineHeight: 1 }}>{value}</p>
      {sub && <p style={{ margin: '0.35rem 0 0', fontSize: '0.8rem', color: '#64748b' }}>{sub}</p>}
    </div>
  );
}

// ── Health Score ──────────────────────────────────────────────────────────────

function HealthScore() {
  const { data: rawData, isLoading } = trpc.insights.feed.useQuery();
  const data = rawData as any[] | undefined;
  const score = data ? Math.max(0, 100 - data.length * 10) : null;
  const color = score === null ? '#64748b' : score >= 80 ? '#16a34a' : score >= 50 ? '#d97706' : '#dc2626';
  const label = score === null ? '—' : score >= 80 ? 'Good' : score >= 50 ? 'Needs Work' : 'Poor';
  return (
    <div style={statCardStyle}>
      <p style={{ margin: '0 0 0.35rem', fontSize: '0.8rem', color: '#64748b', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>SEO Health Score</p>
      {isLoading ? <p style={{ color: '#94a3b8', margin: 0 }}>Loading…</p> : (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
            <span style={{ fontSize: '2rem', fontWeight: 700, color, lineHeight: 1 }}>{score ?? '—'}</span>
            <span style={{ color: '#94a3b8', fontSize: '0.9rem' }}>/100</span>
          </div>
          <div style={{ marginTop: '0.5rem', height: 6, background: '#e2e8f0', borderRadius: 99 }}>
            <div style={{ height: '100%', width: `${score ?? 0}%`, background: color, borderRadius: 99, transition: 'width 0.5s' }} />
          </div>
          <p style={{ margin: '0.35rem 0 0', fontSize: '0.8rem', color }}>{label} · {data?.length ?? 0} pending</p>
        </>
      )}
    </div>
  );
}

// ── Action Queue ──────────────────────────────────────────────────────────────

function ActionQueue() {
  const { data: rawData, isLoading, refetch } = trpc.recommendations.queue.useQuery();
  const data = rawData as any[] | undefined;
  const approve = trpc.recommendations.approve.useMutation({ onSuccess: () => refetch() });
  const reject = trpc.recommendations.reject.useMutation({ onSuccess: () => refetch() });
  const [reasons, setReasons] = useState<Record<string, string>>({});
  return (
    <div style={panelStyle}>
      <div style={panelHeader}>
        <span style={panelTitle}>Action Queue</span>
        {data && data.length > 0 && <span style={badgeStyle}>{data.length}</span>}
      </div>
      {isLoading && <p style={mutedText}>Loading…</p>}
      {data?.length === 0 && <p style={mutedText}>No pending actions — all clear ✓</p>}
      {data?.map((rec: any) => (
        <div key={rec.id} style={queueItemStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', marginBottom: '0.25rem' }}>
                <span style={{ ...tagStyle, background: rec.classification === 'AUTO_FIX' ? '#dbeafe' : '#fef9c3', color: rec.classification === 'AUTO_FIX' ? '#1e40af' : '#854d0e' }}>
                  {rec.classification}
                </span>
                <span style={{ ...tagStyle, background: '#f1f5f9', color: '#475569' }}>P{rec.priority}</span>
              </div>
              <p style={{ margin: 0, fontSize: '0.875rem', fontWeight: 500, color: '#0f172a' }}>
                {rec.recommendation_text ?? rec.type ?? rec.id}
              </p>
              {rec.reason && <p style={{ margin: '0.2rem 0 0', fontSize: '0.8rem', color: '#64748b' }}>{rec.reason}</p>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <button onClick={() => approve.mutate({ id: rec.id })} disabled={approve.isPending} style={approveBtn}>✓ Approve</button>
            <input placeholder="Reject reason…" value={reasons[rec.id] ?? ''} onChange={e => setReasons(r => ({ ...r, [rec.id]: e.target.value }))} style={smallInput} />
            <button onClick={() => reject.mutate({ id: rec.id, reason: reasons[rec.id] ?? '' })} disabled={reject.isPending || !reasons[rec.id]} style={rejectBtn}>✕</button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Auto-Fix Feed ─────────────────────────────────────────────────────────────

function AutoFixFeed() {
  const { data: rawData, isLoading } = trpc.auditLog.feed.useQuery();
  const data = rawData as any[] | undefined;
  return (
    <div style={panelStyle}>
      <div style={panelHeader}><span style={panelTitle}>Auto-Fix Feed</span></div>
      {isLoading && <p style={mutedText}>Loading…</p>}
      {data?.length === 0 && <p style={mutedText}>No auto-fixes yet — start the agent to begin.</p>}
      {data?.slice(0, 8).map((entry: any) => (
        <div key={entry.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0', borderBottom: '1px solid #f1f5f9' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ color: '#16a34a', fontSize: '0.9rem' }}>✓</span>
            <span style={{ fontSize: '0.875rem', color: '#334155', fontWeight: 500 }}>{entry.action_type}</span>
            {entry.after_state?.pr_url && (
              <a href={entry.after_state.pr_url} target="_blank" rel="noreferrer" style={{ fontSize: '0.75rem', color: '#2563eb' }}>PR →</a>
            )}
          </div>
          <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
            {entry.executed_at ? new Date(entry.executed_at).toLocaleString() : ''}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Top Insights ──────────────────────────────────────────────────────────────

function TopInsights() {
  const { data: rawData, isLoading } = trpc.insights.feed.useQuery();
  const data = rawData as any[] | undefined;
  return (
    <div style={panelStyle}>
      <div style={panelHeader}><span style={panelTitle}>Top Insights</span></div>
      {isLoading && <p style={mutedText}>Loading…</p>}
      {data?.length === 0 && <p style={mutedText}>No insights yet — start the agent to generate recommendations.</p>}
      {data?.map((insight: any, i: number) => (
        <div key={insight.id ?? i} style={{ display: 'flex', gap: '0.75rem', padding: '0.6rem 0', borderBottom: '1px solid #f1f5f9', alignItems: 'flex-start' }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#fff', background: '#2563eb', borderRadius: '50%', width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 }}>{i + 1}</span>
          <div>
            <p style={{ margin: 0, fontSize: '0.875rem', color: '#334155', fontWeight: 500 }}>{insight.recommendation_text ?? insight.type ?? insight.id}</p>
            {insight.reason && <p style={{ margin: '0.15rem 0 0', fontSize: '0.78rem', color: '#64748b' }}>{insight.reason}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/auth/signin');
  }, [status, router]);

  if (status === 'loading' || !session) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#f8fafc' }}>
        <p style={{ color: '#94a3b8' }}>Loading…</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#f8fafc', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <Sidebar email={session.user?.email ?? ''} />
      <main style={{ flex: 1, padding: '2rem', overflowY: 'auto' }}>
        <div style={{ marginBottom: '1.75rem' }}>
          <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, color: '#0f172a' }}>Dashboard</h1>
          <p style={{ margin: '0.25rem 0 0', color: '#64748b', fontSize: '0.875rem' }}>
            {new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>

        {/* Agent control */}
        <AgentPanel />

        {/* Stats row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
          <HealthScore />
          <StatCard label="Site" value="learnwealthx.in" sub="Active monitoring" />
          <StatCard label="Workers" value="7" sub="Cron jobs registered" color="#2563eb" />
          <StatCard label="Stack" value="Free tier" sub="Gemini · Serper · Groq" />
        </div>

        {/* Main panels */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem', marginBottom: '1.25rem' }}>
          <ActionQueue />
          <AutoFixFeed />
        </div>
        <TopInsights />
      </main>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const sidebarStyle: React.CSSProperties = {
  width: 220, background: '#0f172a', display: 'flex', flexDirection: 'column',
  minHeight: '100vh', position: 'sticky', top: 0, flexShrink: 0,
};
const signOutBtn: React.CSSProperties = {
  width: '100%', background: 'rgba(255,255,255,0.07)', border: 'none',
  color: '#94a3b8', borderRadius: 6, padding: '0.4rem', cursor: 'pointer', fontSize: '0.8rem',
};
const statCardStyle: React.CSSProperties = {
  background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10,
  padding: '1.1rem 1.25rem', boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
};
const panelStyle: React.CSSProperties = {
  background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10,
  padding: '1.25rem', boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
};
const panelHeader: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem',
};
const panelTitle: React.CSSProperties = { fontWeight: 600, fontSize: '0.95rem', color: '#0f172a' };
const badgeStyle: React.CSSProperties = {
  background: '#ef4444', color: '#fff', borderRadius: 99,
  fontSize: '0.7rem', fontWeight: 700, padding: '0.1rem 0.45rem',
};
const queueItemStyle: React.CSSProperties = {
  padding: '0.75rem', background: '#f8fafc', borderRadius: 8,
  marginBottom: '0.5rem', border: '1px solid #e2e8f0',
};
const tagStyle: React.CSSProperties = {
  fontSize: '0.7rem', fontWeight: 600, padding: '0.1rem 0.4rem', borderRadius: 4,
};
const approveBtn: React.CSSProperties = {
  background: '#16a34a', color: '#fff', border: 'none', borderRadius: 6,
  padding: '0.3rem 0.75rem', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 500,
};
const rejectBtn: React.CSSProperties = {
  background: '#ef4444', color: '#fff', border: 'none', borderRadius: 6,
  padding: '0.3rem 0.6rem', cursor: 'pointer', fontSize: '0.8rem',
};
const smallInput: React.CSSProperties = {
  padding: '0.3rem 0.5rem', border: '1px solid #e2e8f0', borderRadius: 6,
  fontSize: '0.8rem', flex: 1, minWidth: 120,
};
const mutedText: React.CSSProperties = { color: '#94a3b8', fontSize: '0.875rem', margin: 0 };
const startBtn: React.CSSProperties = {
  color: '#fff', border: 'none', borderRadius: 8,
  padding: '0.6rem 1.25rem', fontSize: '0.9rem', fontWeight: 600,
  display: 'flex', alignItems: 'center', gap: '0.4rem',
};
const logBox: React.CSSProperties = {
  background: '#0f172a', borderRadius: 8, padding: '0.85rem 1rem',
  maxHeight: 280, overflowY: 'auto', fontFamily: 'monospace',
};
const pulsingDot: React.CSSProperties = {
  display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
  background: '#2563eb', animation: 'pulse 1.2s ease-in-out infinite',
};
const spinnerStyle: React.CSSProperties = {
  display: 'inline-block', width: 14, height: 14, border: '2px solid rgba(255,255,255,0.3)',
  borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.7s linear infinite',
};
