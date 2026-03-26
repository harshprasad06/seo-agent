'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';

type ReportType = 'daily' | 'weekly' | 'monthly';

const TABS: { key: ReportType; label: string }[] = [
  { key: 'daily',   label: 'Daily'   },
  { key: 'weekly',  label: 'Weekly'  },
  { key: 'monthly', label: 'Monthly' },
];

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: '1rem 1.25rem', minWidth: 130 }}>
      <div style={{ fontSize: '0.75rem', color: '#6b7280', fontWeight: 500, marginBottom: '0.3rem' }}>{label}</div>
      <div style={{ fontSize: '1.6rem', fontWeight: 700, color: color ?? '#111827', lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: '0.72rem', color: '#9ca3af', marginTop: '0.25rem' }}>{sub}</div>}
    </div>
  );
}

// ── Mini bar chart (SVG) ──────────────────────────────────────────────────────
function MiniBar({ items, color = '#3b82f6' }: { items: { label: string; value: number }[]; color?: string }) {
  const max = Math.max(...items.map(i => i.value), 1);
  const W = 220, H = 80, barW = Math.floor((W - (items.length - 1) * 6) / items.length);
  return (
    <svg width={W} height={H + 20} style={{ overflow: 'visible' }}>
      {items.map((item, i) => {
        const h = Math.max(4, Math.round((item.value / max) * H));
        const x = i * (barW + 6);
        const y = H - h;
        return (
          <g key={i}>
            <rect x={x} y={y} width={barW} height={h} rx={3} fill={color} opacity={0.85} />
            <text x={x + barW / 2} y={H + 14} textAnchor="middle" fontSize={9} fill="#9ca3af">{item.label}</text>
            {item.value > 0 && <text x={x + barW / 2} y={y - 3} textAnchor="middle" fontSize={9} fill="#374151">{item.value}</text>}
          </g>
        );
      })}
    </svg>
  );
}

// ── Progress bar ──────────────────────────────────────────────────────────────
function ProgressBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max === 0 ? 0 : Math.min(100, Math.round((value / max) * 100));
  return (
    <div style={{ background: '#f3f4f6', borderRadius: 4, height: 8, overflow: 'hidden', flex: 1 }}>
      <div style={{ width: `${pct}%`, background: color, height: '100%', borderRadius: 4, transition: 'width 0.4s' }} />
    </div>
  );
}

// ── Report detail view ────────────────────────────────────────────────────────
function ReportDetail({ r }: { r: any }) {
  const c = r.content ?? {};
  const traffic = c.organic_traffic_trends ?? {};
  const keywords = c.keyword_ranking_changes ?? {};
  const audit = c.technical_audit_status ?? {};
  const content = c.content_published ?? {};
  const backlinks = c.backlinks_gained_lost ?? {};
  const competitors = c.competitor_movements ?? {};

  const changePct = traffic.change_pct ?? 0;
  const changeColor = changePct > 0 ? '#16a34a' : changePct < 0 ? '#dc2626' : '#6b7280';
  const changeSign = changePct > 0 ? '+' : '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

      {/* AI Summary */}
      {r.summary_text && (
        <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 10, padding: '1rem 1.25rem' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#0369a1', marginBottom: '0.4rem' }}>🤖 AI Summary</div>
          <p style={{ margin: 0, fontSize: '0.875rem', color: '#0c4a6e', lineHeight: 1.7 }}>{r.summary_text}</p>
        </div>
      )}

      {/* Traffic */}
      {'organic_traffic_trends' in c && (
        <div>
          <SectionTitle>Organic Traffic</SectionTitle>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <StatCard label="This Period" value={traffic.current_week_sessions ?? 0} sub="sessions" />
            <StatCard label="Prior Period" value={traffic.prior_week_sessions ?? 0} sub="sessions" />
            <StatCard
              label="Change"
              value={`${changeSign}${changePct}%`}
              color={changeColor}
              sub={changePct === 0 ? 'no change' : changePct > 0 ? 'growth' : 'decline'}
            />
          </div>
          <div style={{ marginTop: '0.75rem' }}>
            <MiniBar
              color="#3b82f6"
              items={[
                { label: 'Prior', value: traffic.prior_week_sessions ?? 0 },
                { label: 'Current', value: traffic.current_week_sessions ?? 0 },
              ]}
            />
          </div>
        </div>
      )}

      {/* Keywords */}
      {'keyword_ranking_changes' in c && (
        <div>
          <SectionTitle>Keyword Rankings</SectionTitle>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
            <StatCard label="Improved" value={keywords.improved ?? 0} color="#16a34a" />
            <StatCard label="Declined" value={keywords.declined ?? 0} color="#dc2626" />
            <StatCard label="New" value={keywords.new_rankings ?? 0} color="#7c3aed" />
          </div>
          <MiniBar
            color="#10b981"
            items={[
              { label: 'Improved', value: keywords.improved ?? 0 },
              { label: 'Declined', value: keywords.declined ?? 0 },
              { label: 'New', value: keywords.new_rankings ?? 0 },
            ]}
          />
        </div>
      )}

      {/* Technical Audit */}
      {'technical_audit_status' in c && (
        <div>
          <SectionTitle>Technical Audit</SectionTitle>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
            <StatCard label="Open Issues" value={audit.open_issues ?? 0} color="#dc2626" />
            <StatCard label="Pending Recs" value={audit.pending_recommendations ?? 0} color="#f59e0b" />
            <StatCard label="Auto Fixed" value={audit.auto_fixed ?? 0} color="#16a34a" />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxWidth: 320 }}>
            {[
              { label: 'Open Issues', value: audit.open_issues ?? 0, color: '#ef4444' },
              { label: 'Pending', value: audit.pending_recommendations ?? 0, color: '#f59e0b' },
              { label: 'Auto Fixed', value: audit.auto_fixed ?? 0, color: '#22c55e' },
            ].map(item => (
              <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem' }}>
                <span style={{ width: 90, color: '#374151' }}>{item.label}</span>
                <ProgressBar value={item.value} max={Math.max(audit.open_issues ?? 0, audit.pending_recommendations ?? 0, 1)} color={item.color} />
                <span style={{ width: 24, textAlign: 'right', fontWeight: 600, color: item.color }}>{item.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Backlinks */}
      {'backlinks_gained_lost' in c && (
        <div>
          <SectionTitle>Backlinks</SectionTitle>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
            <StatCard label="Gained" value={backlinks.gained ?? 0} color="#16a34a" />
            <StatCard label="Lost" value={backlinks.lost ?? 0} color="#dc2626" />
            <StatCard
              label="Net"
              value={(backlinks.net ?? 0) >= 0 ? `+${backlinks.net ?? 0}` : String(backlinks.net ?? 0)}
              color={(backlinks.net ?? 0) >= 0 ? '#16a34a' : '#dc2626'}
            />
          </div>
          <MiniBar
            color="#8b5cf6"
            items={[
              { label: 'Gained', value: backlinks.gained ?? 0 },
              { label: 'Lost', value: backlinks.lost ?? 0 },
            ]}
          />
        </div>
      )}

      {/* Content */}
      {'content_published' in c && (
        <div>
          <SectionTitle>Content Published</SectionTitle>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <StatCard label="New Pages" value={content.new_pages ?? 0} />
            <StatCard label="Updated Pages" value={content.updated_pages ?? 0} color="#7c3aed" />
          </div>
        </div>
      )}

      {/* Competitors */}
      {'competitor_movements' in c && (
        <div>
          <SectionTitle>Competitor Movements</SectionTitle>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <StatCard label="Alerts" value={competitors.alerts ?? 0} color="#f59e0b" />
            <StatCard label="Displacement Opps" value={competitors.displacement_opportunities ?? 0} color="#3b82f6" />
          </div>
        </div>
      )}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#374151', marginBottom: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{children}</div>;
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ReportsPage() {
  const [activeTab, setActiveTab] = useState<ReportType>('weekly');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const reports = trpc.reports.list.useQuery({ type: activeTab });
  const generate = trpc.reports.generate.useMutation({
    onSuccess: (data: any) => {
      reports.refetch();
      setExpandedId(data?.id ?? null);
    },
  });

  return (
    <main style={pageStyle}>
      <h1 style={{ marginBottom: '1.5rem' }}>Reports</h1>

      {/* Tabs */}
      <div style={tabBarStyle}>
        {TABS.map(t => (
          <button
            key={t.key}
            style={{ ...tabBtnStyle, ...(activeTab === t.key ? tabActiveStyle : {}) }}
            onClick={() => { setActiveTab(t.key); setExpandedId(null); }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Generate */}
      <div style={{ margin: '1.25rem 0', display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <button
          style={btnStyle}
          disabled={generate.isPending}
          onClick={() => generate.mutate({ topic: activeTab })}
        >
          {generate.isPending ? 'Generating…' : `Generate ${activeTab.charAt(0).toUpperCase() + activeTab.slice(1)} Report`}
        </button>
        {generate.error && <span style={errorStyle}>{generate.error.message}</span>}
        {generate.isSuccess && <span style={{ color: '#16a34a', fontSize: '0.875rem' }}>✓ Report generated</span>}
      </div>

      {/* List */}
      {reports.isLoading && <p style={mutedStyle}>Loading…</p>}
      {reports.error && <p style={errorStyle}>{reports.error.message}</p>}
      {reports.data && (reports.data as any[]).length === 0 && (
        <p style={mutedStyle}>No {activeTab} reports yet. Click Generate to create one.</p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {((reports.data ?? []) as any[]).map((r: any) => {
          const isOpen = expandedId === r.id;
          const start = r.period_start ? new Date(r.period_start).toLocaleDateString() : '—';
          const end = r.period_end ? new Date(r.period_end).toLocaleDateString() : '—';
          return (
            <div key={r.id} style={{ ...cardStyle, ...(isOpen ? { borderColor: '#3b82f6' } : {}) }}>
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                <TypeBadge type={r.type} />
                <span style={{ fontSize: '0.85rem', color: '#374151', fontWeight: 500 }}>{start} → {end}</span>
                <span style={{ fontSize: '0.78rem', color: '#9ca3af', marginLeft: 'auto' }}>
                  {r.created_at ? new Date(r.created_at).toLocaleString() : ''}
                </span>
                <button style={toggleBtnStyle} onClick={() => setExpandedId(isOpen ? null : r.id)}>
                  {isOpen ? '▲ Collapse' : '▼ View Report'}
                </button>
              </div>

              {/* Summary preview */}
              {!isOpen && r.summary_text && (
                <p style={{ margin: '0.5rem 0 0', fontSize: '0.82rem', color: '#6b7280', lineHeight: 1.5 }}>
                  {r.summary_text.slice(0, 160)}{r.summary_text.length > 160 ? '…' : ''}
                </p>
              )}

              {/* Full report */}
              {isOpen && (
                <div style={{ marginTop: '1.25rem', borderTop: '1px solid #e5e7eb', paddingTop: '1.25rem' }}>
                  <ReportDetail r={r} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </main>
  );
}

function TypeBadge({ type }: { type: string }) {
  const colors: Record<string, { bg: string; color: string }> = {
    daily:   { bg: '#fef9c3', color: '#854d0e' },
    weekly:  { bg: '#dbeafe', color: '#1e40af' },
    monthly: { bg: '#ede9fe', color: '#5b21b6' },
  };
  const s = colors[type] ?? { bg: '#f3f4f6', color: '#374151' };
  return (
    <span style={{ background: s.bg, color: s.color, padding: '0.15rem 0.6rem', borderRadius: 12, fontSize: '0.75rem', fontWeight: 600 }}>
      {type}
    </span>
  );
}

const pageStyle: React.CSSProperties = { fontFamily: 'system-ui, sans-serif', padding: '2rem', maxWidth: 900, margin: '0 auto' };
const tabBarStyle: React.CSSProperties = { display: 'flex', gap: '0.25rem', borderBottom: '2px solid #e5e7eb' };
const tabBtnStyle: React.CSSProperties = { padding: '0.5rem 1.25rem', background: 'none', border: 'none', borderBottom: '2px solid transparent', marginBottom: '-2px', cursor: 'pointer', fontSize: '0.875rem', color: '#6b7280', fontWeight: 500 };
const tabActiveStyle: React.CSSProperties = { borderBottomColor: '#2563eb', color: '#2563eb', fontWeight: 600 };
const btnStyle: React.CSSProperties = { padding: '0.45rem 1.1rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.875rem', fontWeight: 500 };
const cardStyle: React.CSSProperties = { border: '1px solid #e5e7eb', borderRadius: 10, padding: '1rem 1.25rem', background: '#fff' };
const toggleBtnStyle: React.CSSProperties = { background: 'none', border: 'none', color: '#2563eb', fontSize: '0.8rem', cursor: 'pointer', padding: 0, fontWeight: 500 };
const mutedStyle: React.CSSProperties = { color: '#6b7280', fontSize: '0.875rem' };
const errorStyle: React.CSSProperties = { color: '#dc2626', fontSize: '0.875rem' };
