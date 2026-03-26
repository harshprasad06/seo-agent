'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import SharedLayout from '../SharedLayout';

type ReportType = 'daily' | 'weekly' | 'monthly';

const TABS: { key: ReportType; label: string }[] = [
  { key: 'daily',   label: 'Daily'   },
  { key: 'weekly',  label: 'Weekly'  },
  { key: 'monthly', label: 'Monthly' },
];

function StatCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="stat-card" style={{ padding: '0.85rem 1.1rem', minWidth: 130 }}>
      <div className="stat-label" style={{ marginBottom: '0.2rem' }}>{label}</div>
      <div className="stat-value" style={{ fontSize: '1.5rem', color: color ?? 'var(--text-primary)' }}>{value}</div>
      {sub && <div className="stat-sub" style={{ marginTop: '0.2rem' }}>{sub}</div>}
    </div>
  );
}

function MiniBar({ items, color = 'var(--info)' }: { items: { label: string; value: number }[]; color?: string }) {
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
            <text x={x + barW / 2} y={H + 14} textAnchor="middle" fontSize={9} fill="var(--text-tertiary)">{item.label}</text>
            {item.value > 0 && <text x={x + barW / 2} y={y - 3} textAnchor="middle" fontSize={9} fill="var(--text-primary)">{item.value}</text>}
          </g>
        );
      })}
    </svg>
  );
}

function ProgressBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max === 0 ? 0 : Math.min(100, Math.round((value / max) * 100));
  return (
    <div className="progress-bar">
      <div className="progress-fill" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

function ReportDetail({ r }: { r: any }) {
  const c = r.content ?? {};
  const traffic = c.organic_traffic_trends ?? {};
  const keywords = c.keyword_ranking_changes ?? {};
  const audit = c.technical_audit_status ?? {};
  const content = c.content_published ?? {};
  const backlinks = c.backlinks_gained_lost ?? {};
  const competitors = c.competitor_movements ?? {};

  const changePct = traffic.change_pct ?? 0;
  const changeColor = changePct > 0 ? 'var(--success)' : changePct < 0 ? 'var(--danger)' : 'var(--text-tertiary)';
  const changeSign = changePct > 0 ? '+' : '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {r.summary_text && (
        <div className="ai-summary-box">
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--info-text)', marginBottom: '0.4rem' }}>🤖 AI Summary</div>
          <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-primary)', lineHeight: 1.7 }}>{r.summary_text}</p>
        </div>
      )}

      {'organic_traffic_trends' in c && (
        <div>
          <div className="section-subtitle">Organic Traffic</div>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <StatCard label="This Period" value={traffic.current_week_sessions ?? 0} sub="sessions" />
            <StatCard label="Prior Period" value={traffic.prior_week_sessions ?? 0} sub="sessions" />
            <StatCard label="Change" value={`${changeSign}${changePct}%`} color={changeColor} sub={changePct === 0 ? 'no change' : changePct > 0 ? 'growth' : 'decline'} />
          </div>
          <div style={{ marginTop: '0.75rem' }}>
            <MiniBar color="var(--info)" items={[{ label: 'Prior', value: traffic.prior_week_sessions ?? 0 }, { label: 'Current', value: traffic.current_week_sessions ?? 0 }]} />
          </div>
        </div>
      )}

      {'keyword_ranking_changes' in c && (
        <div>
          <div className="section-subtitle">Keyword Rankings</div>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
            <StatCard label="Improved" value={keywords.improved ?? 0} color="var(--success)" />
            <StatCard label="Declined" value={keywords.declined ?? 0} color="var(--danger)" />
            <StatCard label="New" value={keywords.new_rankings ?? 0} color="var(--purple)" />
          </div>
          <MiniBar color="var(--success)" items={[{ label: 'Improved', value: keywords.improved ?? 0 }, { label: 'Declined', value: keywords.declined ?? 0 }, { label: 'New', value: keywords.new_rankings ?? 0 }]} />
        </div>
      )}

      {'technical_audit_status' in c && (
        <div>
          <div className="section-subtitle">Technical Audit</div>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
            <StatCard label="Open Issues" value={audit.open_issues ?? 0} color="var(--danger)" />
            <StatCard label="Pending Recs" value={audit.pending_recommendations ?? 0} color="var(--warning)" />
            <StatCard label="Auto Fixed" value={audit.auto_fixed ?? 0} color="var(--success)" />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxWidth: 320 }}>
            {[
              { label: 'Open Issues', value: audit.open_issues ?? 0, color: 'var(--danger)' },
              { label: 'Pending', value: audit.pending_recommendations ?? 0, color: 'var(--warning)' },
              { label: 'Auto Fixed', value: audit.auto_fixed ?? 0, color: 'var(--success)' },
            ].map(item => (
              <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem' }}>
                <span style={{ width: 90, color: 'var(--text-secondary)' }}>{item.label}</span>
                <ProgressBar value={item.value} max={Math.max(audit.open_issues ?? 0, audit.pending_recommendations ?? 0, 1)} color={item.color} />
                <span style={{ width: 24, textAlign: 'right', fontWeight: 600, color: item.color }}>{item.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {'backlinks_gained_lost' in c && (
        <div>
          <div className="section-subtitle">Backlinks</div>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
            <StatCard label="Gained" value={backlinks.gained ?? 0} color="var(--success)" />
            <StatCard label="Lost" value={backlinks.lost ?? 0} color="var(--danger)" />
            <StatCard label="Net" value={(backlinks.net ?? 0) >= 0 ? `+${backlinks.net ?? 0}` : String(backlinks.net ?? 0)} color={(backlinks.net ?? 0) >= 0 ? 'var(--success)' : 'var(--danger)'} />
          </div>
          <MiniBar color="var(--purple)" items={[{ label: 'Gained', value: backlinks.gained ?? 0 }, { label: 'Lost', value: backlinks.lost ?? 0 }]} />
        </div>
      )}

      {'content_published' in c && (
        <div>
          <div className="section-subtitle">Content Published</div>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <StatCard label="New Pages" value={content.new_pages ?? 0} />
            <StatCard label="Updated Pages" value={content.updated_pages ?? 0} color="var(--purple)" />
          </div>
        </div>
      )}

      {'competitor_movements' in c && (
        <div>
          <div className="section-subtitle">Competitor Movements</div>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <StatCard label="Alerts" value={competitors.alerts ?? 0} color="var(--warning)" />
            <StatCard label="Displacement Opps" value={competitors.displacement_opportunities ?? 0} color="var(--info)" />
          </div>
        </div>
      )}
    </div>
  );
}

function TypeBadge({ type }: { type: string }) {
  const map: Record<string, string> = { daily: 'badge-warning', weekly: 'badge-info', monthly: 'badge-purple' };
  const cls = map[type] ?? 'badge-neutral';
  return <span className={`badge ${cls}`}>{type}</span>;
}

export default function ReportsPage() {
  const [activeTab, setActiveTab] = useState<ReportType>('weekly');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const reports = trpc.reports.list.useQuery({ type: activeTab });
  const generate = trpc.reports.generate.useMutation({
    onSuccess: (data: any) => { reports.refetch(); setExpandedId(data?.id ?? null); },
  });

  return (
    <SharedLayout>
      <div className="page-header">
        <h1 className="page-title">Reports</h1>
        <p className="page-subtitle">AI-generated SEO reports with traffic, keyword, and backlink analytics.</p>
      </div>

      <div className="tab-bar">
        {TABS.map(t => (
          <button key={t.key} className={`tab-btn ${activeTab === t.key ? 'active' : ''}`} onClick={() => { setActiveTab(t.key); setExpandedId(null); }}>
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ margin: '0 0 1.5rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <button className="btn btn-primary" disabled={generate.isPending} onClick={() => generate.mutate({ topic: activeTab })}>
          {generate.isPending ? 'Generating…' : `Generate ${activeTab.charAt(0).toUpperCase() + activeTab.slice(1)} Report`}
        </button>
        {generate.error && <span className="text-error">{generate.error.message}</span>}
        {generate.isSuccess && <span className="text-success">✓ Report generated</span>}
      </div>

      {reports.isLoading && <p className="text-muted">Loading…</p>}
      {reports.error && <p className="text-error">{reports.error.message}</p>}
      {reports.data && (reports.data as any[]).length === 0 && (
        <p className="text-muted">No {activeTab} reports yet. Click Generate to create one.</p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {((reports.data ?? []) as any[]).map((r: any) => {
          const isOpen = expandedId === r.id;
          const start = r.period_start ? new Date(r.period_start).toLocaleDateString() : '—';
          const end = r.period_end ? new Date(r.period_end).toLocaleDateString() : '—';
          return (
            <div key={r.id} className={`report-card ${isOpen ? 'expanded' : ''}`}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                <TypeBadge type={r.type} />
                <span style={{ fontSize: '0.85rem', color: 'var(--text-primary)', fontWeight: 500 }}>{start} → {end}</span>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', marginLeft: 'auto' }}>
                  {r.created_at ? new Date(r.created_at).toLocaleString() : ''}
                </span>
                <button className="btn btn-ghost btn-sm" onClick={() => setExpandedId(isOpen ? null : r.id)}>
                  {isOpen ? '▲ Collapse' : '▼ View Report'}
                </button>
              </div>

              {!isOpen && r.summary_text && (
                <p style={{ margin: '0.5rem 0 0', fontSize: '0.82rem', color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
                  {r.summary_text.slice(0, 160)}{r.summary_text.length > 160 ? '…' : ''}
                </p>
              )}

              {isOpen && (
                <div style={{ marginTop: '1.25rem', borderTop: '1px solid var(--border-primary)', paddingTop: '1.25rem' }}>
                  <ReportDetail r={r} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </SharedLayout>
  );
}
