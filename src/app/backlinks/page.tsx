'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import SharedLayout from '../SharedLayout';

const OUTREACH_STATUSES = ['not_contacted', 'contacted', 'followed_up', 'link_acquired', 'declined'] as const;
type OutreachStatus = typeof OUTREACH_STATUSES[number];

const STATUS_BADGE: Record<OutreachStatus, string> = {
  not_contacted: 'badge-neutral',
  contacted: 'badge-info',
  followed_up: 'badge-warning',
  link_acquired: 'badge-success',
  declined: 'badge-danger',
};

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_BADGE[status as OutreachStatus] ?? 'badge-neutral';
  return <span className={`badge ${cls}`}>{status.replace(/_/g, ' ')}</span>;
}

function OutreachRow({ o, onStatusChange, statusPending }: {
  o: any;
  onStatusChange: (id: string, status: string) => void;
  statusPending: boolean;
}) {
  const [showDraft, setShowDraft] = useState(false);
  const [draft, setDraft] = useState<string>(o.email_draft ?? '');
  const [copied, setCopied] = useState(false);

  const generateDraft = trpc.backlinks.generateDraft.useMutation({
    onSuccess: (data: any) => { setDraft(data.draft); setShowDraft(true); },
  });

  const copy = () => {
    navigator.clipboard.writeText(draft);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <>
      <tr>
        <td>
          <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{o.source_domain}</div>
          {(o.links_to_competitors ?? []).length > 0 && (
            <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', marginTop: '0.15rem' }}>
              Links to: {(o.links_to_competitors as string[]).join(', ')}
            </div>
          )}
          {o.contact_email
            ? <div style={{ fontSize: '0.72rem', color: 'var(--primary)', marginTop: '0.15rem' }}>✉ {o.contact_email}</div>
            : <a href={'https://' + o.source_domain + '/contact'} target="_blank" rel="noopener noreferrer"
                style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', textDecoration: 'underline', display: 'block', marginTop: '0.15rem' }}>
                Find contact →
              </a>
          }
        </td>
        <td style={{ textAlign: 'center' }}>{o.domain_authority ?? '—'}</td>
        <td style={{ textAlign: 'center' }}>
          {o.relevance_score != null
            ? <span style={{ fontWeight: 600, color: Number(o.relevance_score) >= 0.7 ? 'var(--success)' : 'var(--text-primary)' }}>
                {(Number(o.relevance_score) * 100).toFixed(0)}%
              </span>
            : '—'}
        </td>
        <td><StatusBadge status={o.status} /></td>
        <td>
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            <select className="select" value={o.status} disabled={statusPending} onChange={e => onStatusChange(o.id, e.target.value)} style={{ fontSize: '0.8rem', padding: '0.25rem 0.5rem' }}>
              {OUTREACH_STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </select>
            <button className="btn btn-ghost btn-sm" disabled={generateDraft.isPending}
              onClick={() => { if (draft) setShowDraft(v => !v); else generateDraft.mutate({ id: o.id }); }}>
              {generateDraft.isPending ? '…' : draft ? (showDraft ? 'Hide' : 'View Email') : '✉ Draft Email'}
            </button>
          </div>
          {generateDraft.error && <div className="text-error" style={{ fontSize: '0.72rem', marginTop: '0.25rem' }}>{generateDraft.error.message}</div>}
        </td>
      </tr>
      {showDraft && draft && (
        <tr>
          <td colSpan={5} style={{ background: 'var(--bg-tertiary)', padding: '0.85rem 1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-primary)' }}>Generated Email Draft</span>
              <button className="btn btn-ghost btn-sm" onClick={copy}>{copied ? '✓ Copied' : '⎘ Copy'}</button>
            </div>
            <pre className="pre-block" style={{ margin: 0 }}>{draft}</pre>
          </td>
        </tr>
      )}
    </>
  );
}

export default function BacklinksPage() {
  const [activeTab, setActiveTab] = useState<'backlinks' | 'outreach'>('backlinks');

  const backlinks = trpc.backlinks.list.useQuery();
  const outreach = trpc.backlinks.outreach.useQuery();
  const updateStatus = trpc.backlinks.updateOutreachStatus.useMutation({ onSuccess: () => outreach.refetch() });
  const findProspects = trpc.backlinks.findProspects.useMutation({ onSuccess: () => outreach.refetch() });

  const outreachData = (outreach.data ?? []) as any[];
  const stats = {
    total: outreachData.length,
    pending: outreachData.filter((o: any) => o.status === 'not_contacted').length,
    contacted: outreachData.filter((o: any) => o.status === 'contacted' || o.status === 'followed_up').length,
    acquired: outreachData.filter((o: any) => o.status === 'link_acquired').length,
  };

  return (
    <SharedLayout>
      <div className="page-header">
        <h1 className="page-title">Backlinks & Outreach</h1>
        <p className="page-subtitle">Track your backlink profile and manage outreach pipeline.</p>
      </div>

      <div className="tab-bar">
        {(['backlinks', 'outreach'] as const).map(t => (
          <button key={t} className={`tab-btn ${activeTab === t ? 'active' : ''}`} onClick={() => setActiveTab(t)}>
            {t === 'backlinks' ? 'Backlink Profile' : 'Outreach Pipeline'}
          </button>
        ))}
      </div>

      {activeTab === 'backlinks' && (
        <section>
          {backlinks.isLoading && <p className="text-muted">Loading...</p>}
          {backlinks.error && <p className="text-error">{backlinks.error.message}</p>}
          <div className="table-wrapper">
            <table className="table">
              <thead><tr>
                <th>Source Domain</th>
                <th>Anchor Text</th>
                <th>DA</th>
                <th>Status</th>
                <th>First Seen</th>
              </tr></thead>
              <tbody>
                {(backlinks.data as any[] ?? []).length === 0 && (
                  <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-tertiary)' }}>No backlinks found. Run the agent to sync.</td></tr>
                )}
                {(backlinks.data as any[] ?? []).map((b: any) => (
                  <tr key={b.id}>
                    <td style={{ fontWeight: 500 }}>{b.source_domain}</td>
                    <td>{b.anchor_text ?? '—'}</td>
                    <td style={{ textAlign: 'center' }}>{b.domain_authority ?? '—'}</td>
                    <td><StatusBadge status={b.status} /></td>
                    <td>{b.first_seen_at ? new Date(b.first_seen_at).toLocaleDateString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {activeTab === 'outreach' && (
        <section>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1.25rem', alignItems: 'flex-end' }}>
            {[
              { label: 'Total Prospects', value: stats.total, color: 'var(--text-primary)' },
              { label: 'Pending', value: stats.pending, color: 'var(--warning)' },
              { label: 'In Progress', value: stats.contacted, color: 'var(--info)' },
              { label: 'Links Acquired', value: stats.acquired, color: 'var(--success)' },
            ].map(s => (
              <div key={s.label} className="stat-card" style={{ padding: '0.65rem 1rem', minWidth: 110 }}>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', marginBottom: '0.15rem' }}>{s.label}</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, color: s.color }}>{s.value}</div>
              </div>
            ))}
            <button className="btn btn-primary" style={{ marginLeft: 'auto' }} disabled={findProspects.isPending} onClick={() => findProspects.mutate()}>
              {findProspects.isPending ? 'Searching...' : 'Find New Prospects'}
            </button>
          </div>
          {findProspects.isSuccess && <p className="text-success" style={{ marginBottom: '0.75rem' }}>Found {(findProspects.data as any)?.count ?? 0} new prospect(s)</p>}
          {findProspects.error && <p className="text-error">{findProspects.error.message}</p>}
          {outreach.isLoading && <p className="text-muted">Loading...</p>}
          <div className="table-wrapper">
            <table className="table">
              <thead><tr>
                <th>Domain + Contact</th>
                <th>DA</th>
                <th>Relevance</th>
                <th>Status</th>
                <th>Actions</th>
              </tr></thead>
              <tbody>
                {outreachData.length === 0 && (
                  <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-tertiary)' }}>No prospects yet. Click Find New Prospects or run the agent.</td></tr>
                )}
                {outreachData.map((o: any) => (
                  <OutreachRow key={o.id} o={o}
                    onStatusChange={(id, status) => updateStatus.mutate({ id, status })}
                    statusPending={updateStatus.isPending} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </SharedLayout>
  );
}
