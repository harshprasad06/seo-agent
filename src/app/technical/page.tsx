'use client';

import { trpc } from '@/lib/trpc';

const TECHNICAL_TYPES = [
  'fix_server_error',
  'fix_noindex',
  'fix_broken_internal_link',
  'correct_redirect_chain',
  'change_canonical_tag',
  'fix_structured_data',
  'cwv_performance',
];

const SEVERITY_ORDER = ['fix_server_error', 'fix_noindex', 'fix_broken_internal_link', 'correct_redirect_chain', 'change_canonical_tag', 'fix_structured_data', 'cwv_performance'];

const SEVERITY_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  fix_server_error:         { label: 'Critical', color: '#991b1b', bg: '#fee2e2' },
  fix_noindex:              { label: 'High',     color: '#92400e', bg: '#fef3c7' },
  fix_broken_internal_link: { label: 'High',     color: '#92400e', bg: '#fef3c7' },
  correct_redirect_chain:   { label: 'Medium',   color: '#1e40af', bg: '#dbeafe' },
  change_canonical_tag:     { label: 'Medium',   color: '#1e40af', bg: '#dbeafe' },
  fix_structured_data:      { label: 'Low',      color: '#065f46', bg: '#d1fae5' },
  cwv_performance:          { label: 'Low',      color: '#065f46', bg: '#d1fae5' },
};

const CWV_RATING_STYLE: Record<string, React.CSSProperties> = {
  good:             { background: '#d1fae5', color: '#065f46', padding: '0.15rem 0.5rem', borderRadius: 12, fontWeight: 600, fontSize: '0.75rem' },
  needs_improvement:{ background: '#fef3c7', color: '#92400e', padding: '0.15rem 0.5rem', borderRadius: 12, fontWeight: 600, fontSize: '0.75rem' },
  poor:             { background: '#fee2e2', color: '#991b1b', padding: '0.15rem 0.5rem', borderRadius: 12, fontWeight: 600, fontSize: '0.75rem' },
};

function RatingBadge({ rating }: { rating: string | null }) {
  if (!rating) return <span style={{ color: '#6b7280' }}>—</span>;
  const style = CWV_RATING_STYLE[rating] ?? { fontWeight: 600, fontSize: '0.75rem' };
  return <span style={style}>{rating.replace('_', ' ')}</span>;
}

export default function TechnicalPage() {
  const { data: recs, isLoading: recsLoading, error: recsError } = trpc.recommendations.queue.useQuery();
  const { data: cwvData, isLoading: cwvLoading, error: cwvError } = trpc.pages.cwv.useQuery();

  const technicalRecs = (recs ?? []).filter((r: any) => TECHNICAL_TYPES.includes(r.type));

  // Group by type
  const grouped = technicalRecs.reduce((acc: Record<string, any[]>, rec: any) => {
    if (!acc[rec.type]) acc[rec.type] = [];
    acc[rec.type].push(rec);
    return acc;
  }, {});

  const sortedTypes = SEVERITY_ORDER.filter(t => grouped[t]);

  const isLoading = recsLoading || cwvLoading;
  const error = recsError || cwvError;

  return (
    <main style={pageStyle}>
      <h1 style={{ marginBottom: '0.5rem' }}>Technical Audit</h1>
      <p style={mutedStyle}>Technical issues grouped by type, plus Core Web Vitals per page.</p>

      {isLoading && <p style={mutedStyle}>Loading…</p>}
      {error && <p style={errorStyle}>Error: {(error as any).message}</p>}

      {/* Technical Issues */}
      {!isLoading && !error && (
        <>
          <h2 style={sectionHeadingStyle}>Issues by Type</h2>
          {sortedTypes.length === 0 && (
            <p style={mutedStyle}>No pending technical issues.</p>
          )}
          {sortedTypes.map(type => {
            const items = grouped[type];
            const sev = SEVERITY_LABELS[type];
            return (
              <section key={type} style={sectionStyle}>
                <div style={sectionHeaderStyle}>
                  <span style={typeCodeStyle}>{type}</span>
                  {sev && (
                    <span style={{ background: sev.bg, color: sev.color, padding: '0.15rem 0.6rem', borderRadius: 12, fontSize: '0.75rem', fontWeight: 600 }}>
                      {sev.label}
                    </span>
                  )}
                  <span style={countBadgeStyle}>{items.length} issue{items.length !== 1 ? 's' : ''}</span>
                </div>
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      <th style={thStyle}>Page ID</th>
                      <th style={thStyle}>Reason</th>
                      <th style={thStyle}>Priority</th>
                      <th style={thStyle}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((rec: any, i: number) => (
                      <tr key={rec.id} style={i % 2 === 0 ? {} : { background: '#f9fafb' }}>
                        <td style={tdStyle}><code style={codeStyle}>{rec.page_id ?? '—'}</code></td>
                        <td style={tdStyle}>{rec.reason ?? '—'}</td>
                        <td style={{ ...tdStyle, textAlign: 'center' }}>{rec.priority ?? '—'}</td>
                        <td style={tdStyle}>
                          <span style={{ color: STATUS_COLORS[rec.status] ?? '#374151', fontWeight: 600 }}>
                            {rec.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            );
          })}

          {/* CWV Section */}
          <h2 style={{ ...sectionHeadingStyle, marginTop: '2rem' }}>Core Web Vitals</h2>
          {(!cwvData || cwvData.length === 0) ? (
            <p style={mutedStyle}>No CWV data available.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>URL</th>
                    <th style={thStyle}>LCP (ms)</th>
                    <th style={thStyle}>LCP Rating</th>
                    <th style={thStyle}>INP (ms)</th>
                    <th style={thStyle}>INP Rating</th>
                    <th style={thStyle}>CLS Score</th>
                    <th style={thStyle}>CLS Rating</th>
                    <th style={thStyle}>Measured At</th>
                  </tr>
                </thead>
                <tbody>
                  {cwvData.map((row: any, i: number) => (
                    <tr key={`${row.page_id}-${row.measured_at}`} style={i % 2 === 0 ? {} : { background: '#f9fafb' }}>
                      <td style={{ ...tdStyle, maxWidth: 280, wordBreak: 'break-all' }}>{row.url ?? row.page_id}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{row.lcp_ms ?? '—'}</td>
                      <td style={{ ...tdStyle, textAlign: 'center' }}><RatingBadge rating={row.lcp_rating} /></td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{row.inp_ms ?? '—'}</td>
                      <td style={{ ...tdStyle, textAlign: 'center' }}><RatingBadge rating={row.inp_rating} /></td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{row.cls_score ?? '—'}</td>
                      <td style={{ ...tdStyle, textAlign: 'center' }}><RatingBadge rating={row.cls_rating} /></td>
                      <td style={tdStyle}>{row.measured_at ? new Date(row.measured_at).toLocaleString() : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </main>
  );
}

// --- Styles ---
const pageStyle: React.CSSProperties = {
  fontFamily: 'system-ui, sans-serif',
  padding: '2rem',
  maxWidth: 1200,
  margin: '0 auto',
};

const sectionHeadingStyle: React.CSSProperties = {
  fontSize: '1.1rem',
  fontWeight: 600,
  marginBottom: '0.75rem',
  marginTop: '1.5rem',
};

const sectionStyle: React.CSSProperties = {
  marginBottom: '1.5rem',
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  overflow: 'hidden',
};

const sectionHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.75rem',
  padding: '0.65rem 1rem',
  background: '#f3f4f6',
  borderBottom: '1px solid #e5e7eb',
};

const typeCodeStyle: React.CSSProperties = {
  fontFamily: 'monospace',
  fontSize: '0.875rem',
  fontWeight: 600,
};

const countBadgeStyle: React.CSSProperties = {
  marginLeft: 'auto',
  background: '#e5e7eb',
  color: '#374151',
  padding: '0.1rem 0.5rem',
  borderRadius: 12,
  fontSize: '0.75rem',
  fontWeight: 500,
};

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '0.875rem',
};

const thStyle: React.CSSProperties = {
  padding: '0.6rem 0.75rem',
  background: '#f9fafb',
  border: '1px solid #e5e7eb',
  textAlign: 'left',
  fontWeight: 600,
  whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = {
  padding: '0.5rem 0.75rem',
  border: '1px solid #e5e7eb',
  verticalAlign: 'middle',
};

const codeStyle: React.CSSProperties = {
  background: '#f3f4f6',
  padding: '0.1rem 0.35rem',
  borderRadius: 3,
  fontSize: '0.8rem',
};

const STATUS_COLORS: Record<string, string> = {
  pending: '#d97706',
  applied: '#16a34a',
  rejected: '#dc2626',
};

const mutedStyle: React.CSSProperties = { color: '#6b7280', fontSize: '0.875rem' };
const errorStyle: React.CSSProperties = { color: '#dc2626', fontSize: '0.875rem' };
