'use client';

import { trpc } from '@/lib/trpc';
import SharedLayout from '../SharedLayout';

const TECHNICAL_TYPES = [
  'fix_server_error', 'fix_noindex', 'fix_broken_internal_link', 'correct_redirect_chain',
  'change_canonical_tag', 'fix_structured_data', 'cwv_performance',
];

const SEVERITY_ORDER = ['fix_server_error', 'fix_noindex', 'fix_broken_internal_link', 'correct_redirect_chain', 'change_canonical_tag', 'fix_structured_data', 'cwv_performance'];

const SEVERITY_LABELS: Record<string, { label: string; badge: string }> = {
  fix_server_error:         { label: 'Critical', badge: 'badge-danger' },
  fix_noindex:              { label: 'High',     badge: 'badge-warning' },
  fix_broken_internal_link: { label: 'High',     badge: 'badge-warning' },
  correct_redirect_chain:   { label: 'Medium',   badge: 'badge-info' },
  change_canonical_tag:     { label: 'Medium',   badge: 'badge-info' },
  fix_structured_data:      { label: 'Low',      badge: 'badge-success' },
  cwv_performance:          { label: 'Low',      badge: 'badge-success' },
};

const CWV_BADGE: Record<string, string> = {
  good: 'badge-success',
  needs_improvement: 'badge-warning',
  poor: 'badge-danger',
};

function RatingBadge({ rating }: { rating: string | null }) {
  if (!rating) return <span style={{ color: 'var(--text-tertiary)' }}>—</span>;
  const cls = CWV_BADGE[rating] ?? 'badge-neutral';
  return <span className={`badge ${cls}`}>{rating.replace('_', ' ')}</span>;
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'var(--warning)',
  applied: 'var(--success)',
  rejected: 'var(--danger)',
};

export default function TechnicalPage() {
  const { data: recs, isLoading: recsLoading, error: recsError } = trpc.recommendations.queue.useQuery();
  const { data: cwvData, isLoading: cwvLoading, error: cwvError } = trpc.pages.cwv.useQuery();

  const technicalRecs = (recs ?? []).filter((r: any) => TECHNICAL_TYPES.includes(r.type));

  const grouped = technicalRecs.reduce((acc: Record<string, any[]>, rec: any) => {
    if (!acc[rec.type]) acc[rec.type] = [];
    acc[rec.type].push(rec);
    return acc;
  }, {});

  const sortedTypes = SEVERITY_ORDER.filter(t => grouped[t]);
  const isLoading = recsLoading || cwvLoading;
  const error = recsError || cwvError;

  return (
    <SharedLayout>
      <div className="page-header">
        <h1 className="page-title">Technical Audit</h1>
        <p className="page-subtitle">Technical issues grouped by type, plus Core Web Vitals per page.</p>
      </div>

      {isLoading && <p className="text-muted">Loading…</p>}
      {error && <p className="text-error">Error: {(error as any).message}</p>}

      {!isLoading && !error && (
        <>
          <h2 className="section-title" style={{ marginTop: '0.5rem' }}>Issues by Type</h2>
          {sortedTypes.length === 0 && <p className="text-muted">No pending technical issues.</p>}
          {sortedTypes.map(type => {
            const items = grouped[type];
            const sev = SEVERITY_LABELS[type];
            return (
              <section key={type} className="section" style={{ border: '1px solid var(--border-primary)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.7rem 1rem', background: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border-primary)' }}>
                  <span className="code" style={{ fontWeight: 600 }}>{type}</span>
                  {sev && <span className={`badge ${sev.badge}`}>{sev.label}</span>}
                  <span className="badge badge-neutral" style={{ marginLeft: 'auto' }}>{items.length} issue{items.length !== 1 ? 's' : ''}</span>
                </div>
                <table className="table">
                  <thead><tr><th>Page ID</th><th>Reason</th><th>Priority</th><th>Status</th></tr></thead>
                  <tbody>
                    {items.map((rec: any) => (
                      <tr key={rec.id}>
                        <td><span className="code">{rec.page_id ?? '—'}</span></td>
                        <td>{rec.reason ?? '—'}</td>
                        <td style={{ textAlign: 'center' }}>{rec.priority ?? '—'}</td>
                        <td><span style={{ color: STATUS_COLORS[rec.status] ?? 'var(--text-primary)', fontWeight: 600 }}>{rec.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            );
          })}

          <h2 className="section-title" style={{ marginTop: '2rem' }}>Core Web Vitals</h2>
          {(!cwvData || cwvData.length === 0) ? (
            <p className="text-muted">No CWV data available.</p>
          ) : (
            <div className="table-wrapper">
              <table className="table">
                <thead><tr>
                  <th>URL</th><th>LCP (ms)</th><th>LCP Rating</th>
                  <th>INP (ms)</th><th>INP Rating</th>
                  <th>CLS Score</th><th>CLS Rating</th><th>Measured At</th>
                </tr></thead>
                <tbody>
                  {cwvData.map((row: any, i: number) => (
                    <tr key={`${row.page_id}-${row.measured_at}`}>
                      <td style={{ maxWidth: 280, wordBreak: 'break-all' }}>{row.url ?? row.page_id}</td>
                      <td style={{ textAlign: 'right' }}>{row.lcp_ms ?? '—'}</td>
                      <td style={{ textAlign: 'center' }}><RatingBadge rating={row.lcp_rating} /></td>
                      <td style={{ textAlign: 'right' }}>{row.inp_ms ?? '—'}</td>
                      <td style={{ textAlign: 'center' }}><RatingBadge rating={row.inp_rating} /></td>
                      <td style={{ textAlign: 'right' }}>{row.cls_score ?? '—'}</td>
                      <td style={{ textAlign: 'center' }}><RatingBadge rating={row.cls_rating} /></td>
                      <td>{row.measured_at ? new Date(row.measured_at).toLocaleString() : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </SharedLayout>
  );
}
