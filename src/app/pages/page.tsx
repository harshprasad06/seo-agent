'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';

const ON_PAGE_TYPES = [
  'update_title_tag',
  'update_meta_description',
  'add_schema_markup',
  'fix_heading_structure',
  'improve_content',
  'add_internal_links',
  'optimize_images',
  // types from on-page auditor
  'add_missing_meta_description',
  'change_h1_heading',
  'add_missing_alt_text',
  'title_tag_too_long',
];

const STATUS_COLORS: Record<string, string> = {
  pending: '#d97706',
  applied: '#16a34a',
  rejected: '#dc2626',
};

const PRIORITY_LABELS: Record<number, string> = {
  1: 'Critical',
  2: 'High',
  3: 'Medium',
  4: 'Low',
};

export default function PagesPage() {
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const { data: rawData, isLoading, error, refetch } = trpc.recommendations.queue.useQuery();
  const { data: pagesData } = trpc.pages.list.useQuery();
  const data = rawData as any[] | undefined;

  // Build page id → url map
  const pageUrlMap = ((pagesData as any[]) ?? []).reduce((acc: Record<string, string>, p: any) => {
    acc[p.id] = p.url;
    return acc;
  }, {});

  // Filter to on-page types only
  const onPageRecs = (data ?? []).filter((r: any) => ON_PAGE_TYPES.includes(r.type));

  const approveMutation = trpc.recommendations.approve.useMutation({ onSuccess: () => refetch() });
  const rejectMutation = trpc.recommendations.reject.useMutation({
    onSuccess: () => {
      setRejectId(null);
      setRejectReason('');
      refetch();
    },
  });
  const grouped = onPageRecs.reduce((acc: Record<string, any[]>, rec: any) => {
    const key = rec.page_id ?? '__unknown__';
    if (!acc[key]) acc[key] = [];
    acc[key].push(rec);
    return acc;
  }, {});

  return (
    <main style={pageStyle}>
      <h1 style={{ marginBottom: '0.5rem' }}>On-Page Audit</h1>
      <p style={mutedStyle}>Pending on-page recommendations grouped by page.</p>

      {isLoading && <p style={mutedStyle}>Loading…</p>}
      {error && <p style={errorStyle}>Error: {error.message}</p>}

      {!isLoading && !error && Object.keys(grouped).length === 0 && (
        <p style={mutedStyle}>No pending on-page recommendations.</p>
      )}

      {Object.entries(grouped).map(([pageId, recs]) => {
        const url = pageUrlMap[pageId] ?? (recs[0] as any)?.url ?? null;
        const label = url ?? (pageId === '__unknown__' ? 'Unknown page' : pageId);
        return (
          <section key={pageId} style={sectionStyle}>
            <h2 style={sectionTitleStyle} title={pageId !== '__unknown__' ? pageId : undefined}>
              {label}
            </h2>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Type</th>
                  <th style={thStyle}>Reason</th>
                  <th style={thStyle}>Priority</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {(recs as any[]).map((rec: any, i: number) => (
                  <tr key={rec.id} style={i % 2 === 0 ? {} : { background: '#f9fafb' }}>
                    <td style={tdStyle}><code style={codeStyle}>{rec.type}</code></td>
                    <td style={tdStyle}>{rec.reason ?? '—'}</td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                      {PRIORITY_LABELS[rec.priority] ?? rec.priority ?? '—'}
                    </td>
                    <td style={tdStyle}>
                      <span style={{ color: STATUS_COLORS[rec.status] ?? '#374151', fontWeight: 600 }}>
                        {rec.status}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      {rec.status === 'pending' && (
                        rejectId === rec.id ? (
                          <span style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
                            <input
                              style={inputStyle}
                              placeholder="Reason…"
                              value={rejectReason}
                              onChange={e => setRejectReason(e.target.value)}
                            />
                            <button
                              style={btnDanger}
                              disabled={!rejectReason.trim() || rejectMutation.isPending}
                              onClick={() => rejectMutation.mutate({ id: rec.id, reason: rejectReason })}
                            >
                              Confirm
                            </button>
                            <button style={btnSecondary} onClick={() => { setRejectId(null); setRejectReason(''); }}>
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <span style={{ display: 'flex', gap: '0.4rem' }}>
                            <button
                              style={btnSuccess}
                              disabled={approveMutation.isPending}
                              onClick={() => approveMutation.mutate({ id: rec.id })}
                            >
                              Approve
                            </button>
                            <button style={btnDanger} onClick={() => setRejectId(rec.id)}>
                              Reject
                            </button>
                          </span>
                        )
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}
    </main>
  );
}

// --- Styles ---
const pageStyle: React.CSSProperties = {
  fontFamily: 'system-ui, sans-serif',
  padding: '2rem',
  maxWidth: 1100,
  margin: '0 auto',
};

const sectionStyle: React.CSSProperties = {
  marginBottom: '2rem',
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  overflow: 'hidden',
};

const sectionTitleStyle: React.CSSProperties = {
  margin: 0,
  padding: '0.75rem 1rem',
  background: '#f3f4f6',
  fontSize: '0.95rem',
  fontWeight: 600,
  borderBottom: '1px solid #e5e7eb',
  wordBreak: 'break-all',
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

const inputStyle: React.CSSProperties = {
  padding: '0.3rem 0.5rem',
  border: '1px solid #d1d5db',
  borderRadius: 4,
  fontSize: '0.8rem',
  width: 160,
};

const btnBase: React.CSSProperties = {
  padding: '0.3rem 0.65rem',
  border: 'none',
  borderRadius: 4,
  fontSize: '0.8rem',
  cursor: 'pointer',
  fontWeight: 500,
};

const btnSuccess: React.CSSProperties = { ...btnBase, background: '#16a34a', color: '#fff' };
const btnDanger: React.CSSProperties = { ...btnBase, background: '#dc2626', color: '#fff' };
const btnSecondary: React.CSSProperties = { ...btnBase, background: '#e5e7eb', color: '#374151' };

const mutedStyle: React.CSSProperties = { color: '#6b7280', fontSize: '0.875rem' };
const errorStyle: React.CSSProperties = { color: '#dc2626', fontSize: '0.875rem' };
