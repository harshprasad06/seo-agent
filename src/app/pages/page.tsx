'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import SharedLayout from '../SharedLayout';

const ON_PAGE_TYPES = [
  'update_title_tag', 'update_meta_description', 'add_schema_markup', 'fix_heading_structure',
  'improve_content', 'add_internal_links', 'optimize_images',
  'add_missing_meta_description', 'change_h1_heading', 'add_missing_alt_text', 'title_tag_too_long',
];

const STATUS_COLORS: Record<string, string> = {
  pending: 'var(--warning)',
  applied: 'var(--success)',
  rejected: 'var(--danger)',
};

const PRIORITY_LABELS: Record<number, string> = { 1: 'Critical', 2: 'High', 3: 'Medium', 4: 'Low' };
const PRIORITY_BADGES: Record<number, string> = { 1: 'badge-danger', 2: 'badge-warning', 3: 'badge-info', 4: 'badge-neutral' };

export default function PagesPage() {
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const { data: rawData, isLoading, error, refetch } = trpc.recommendations.queue.useQuery();
  const { data: pagesData } = trpc.pages.list.useQuery();
  const data = rawData as any[] | undefined;

  const pageUrlMap = ((pagesData as any[]) ?? []).reduce((acc: Record<string, string>, p: any) => {
    acc[p.id] = p.url;
    return acc;
  }, {});

  const onPageRecs = (data ?? []).filter((r: any) => ON_PAGE_TYPES.includes(r.type));
  const approveMutation = trpc.recommendations.approve.useMutation({ onSuccess: () => refetch() });
  const rejectMutation = trpc.recommendations.reject.useMutation({
    onSuccess: () => { setRejectId(null); setRejectReason(''); refetch(); },
  });

  const grouped = onPageRecs.reduce((acc: Record<string, any[]>, rec: any) => {
    const key = rec.page_id ?? '__unknown__';
    if (!acc[key]) acc[key] = [];
    acc[key].push(rec);
    return acc;
  }, {});

  return (
    <SharedLayout>
      <div className="page-header">
        <h1 className="page-title">On-Page Audit</h1>
        <p className="page-subtitle">Pending on-page recommendations grouped by page.</p>
      </div>

      {isLoading && <p className="text-muted">Loading…</p>}
      {error && <p className="text-error">Error: {error.message}</p>}

      {!isLoading && !error && Object.keys(grouped).length === 0 && (
        <div className="empty-state">
          <div className="empty-state-icon">▤</div>
          <p style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>No pending on-page recommendations.</p>
          <p>Run the agent to generate audits.</p>
        </div>
      )}

      {Object.entries(grouped).map(([pageId, recs]) => {
        const url = pageUrlMap[pageId] ?? (recs[0] as any)?.url ?? null;
        const label = url ?? (pageId === '__unknown__' ? 'Unknown page' : pageId);
        return (
          <section key={pageId} className="section" style={{ border: '1px solid var(--border-primary)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
            <h2 style={{ margin: 0, padding: '0.8rem 1rem', background: 'var(--bg-tertiary)', fontSize: '0.95rem', fontWeight: 600, borderBottom: '1px solid var(--border-primary)', wordBreak: 'break-all', color: 'var(--text-primary)' }} title={pageId !== '__unknown__' ? pageId : undefined}>
              {label}
            </h2>
            <table className="table">
              <thead><tr><th>Type</th><th>Reason</th><th>Priority</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>
                {(recs as any[]).map((rec: any) => (
                  <tr key={rec.id}>
                    <td><span className="code">{rec.type}</span></td>
                    <td>{rec.reason ?? '—'}</td>
                    <td style={{ textAlign: 'center' }}>
                      <span className={`badge ${PRIORITY_BADGES[rec.priority] ?? 'badge-neutral'}`}>
                        {PRIORITY_LABELS[rec.priority] ?? rec.priority ?? '—'}
                      </span>
                    </td>
                    <td><span style={{ color: STATUS_COLORS[rec.status] ?? 'var(--text-primary)', fontWeight: 600 }}>{rec.status}</span></td>
                    <td>
                      {rec.status === 'pending' && (
                        rejectId === rec.id ? (
                          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
                            <input className="input" placeholder="Reason…" value={rejectReason} onChange={e => setRejectReason(e.target.value)} style={{ width: 160, fontSize: '0.82rem', padding: '0.3rem 0.5rem' }} />
                            <button className="btn btn-danger btn-sm" disabled={!rejectReason.trim() || rejectMutation.isPending} onClick={() => rejectMutation.mutate({ id: rec.id, reason: rejectReason })}>Confirm</button>
                            <button className="btn btn-ghost btn-sm" onClick={() => { setRejectId(null); setRejectReason(''); }}>Cancel</button>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', gap: '0.4rem' }}>
                            <button className="btn btn-success btn-sm" disabled={approveMutation.isPending} onClick={() => approveMutation.mutate({ id: rec.id })}>Approve</button>
                            <button className="btn btn-danger btn-sm" onClick={() => setRejectId(rec.id)}>Reject</button>
                          </div>
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
    </SharedLayout>
  );
}
