'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';

const OUTREACH_STATUSES = ['not_contacted', 'contacted', 'followed_up', 'link_acquired', 'declined'] as const;
type OutreachStatus = typeof OUTREACH_STATUSES[number];

const STATUS_COLORS: Record<OutreachStatus, { bg: string; color: string }> = {
  not_contacted: { bg: '#f3f4f6', color: '#374151' },
  contacted:     { bg: '#dbeafe', color: '#1e40af' },
  followed_up:   { bg: '#fef3c7', color: '#92400e' },
  link_acquired: { bg: '#d1fae5', color: '#065f46' },
  declined:      { bg: '#fee2e2', color: '#991b1b' },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_COLORS[status as OutreachStatus] ?? { bg: '#f3f4f6', color: '#374151' };
  return (
    <span style={{ background: s.bg, color: s.color, padding: '0.15rem 0.5rem', borderRadius: 12, fontSize: '0.75rem', fontWeight: 600 }}>
      {status.replace(/_/g, ' ')}
    </span>
  );
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
        <td style={tdStyle}>
          <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{o.source_domain}</div>
          {(o.links_to_competitors ?? []).length > 0 && (
            <div style={{ fontSize: '0.72rem', color: '#6b7280', marginTop: '0.15rem' }}>
              Links to: {(o.links_to_competitors as string[]).join(', ')}
            </div>
          )}
          {o.contact_email
            ? <div style={{ fontSize: '0.72rem', color: '#2563eb', marginTop: '0.15rem' }}>
                {'\u2709'} {o.contact_email}
              </div>
            : <a href={'https://' + o.source_domain + '/contact'} target="_blank" rel="noopener noreferrer"
                style={{ fontSize: '0.72rem', color: '#6b7280', textDecoration: 'underline', display: 'block', marginTop: '0.15rem' }}>
                Find contact {'\u2192'}
              </a>
          }
        </td>
        <td style={{ ...tdStyle, textAlign: 'center' }}>{o.domain_authority ?? '\u2014'}</td>
        <td style={{ ...tdStyle, textAlign: 'center' }}>
          {o.relevance_score != null
            ? <span style={{ fontWeight: 600, color: Number(o.relevance_score) >= 0.7 ? '#16a34a' : '#374151' }}>
                {(Number(o.relevance_score) * 100).toFixed(0)}%
              </span>
            : '\u2014'}
        </td>
        <td style={tdStyle}><StatusBadge status={o.status} /></td>
        <td style={tdStyle}>
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            <select value={o.status} disabled={statusPending} onChange={e => onStatusChange(o.id, e.target.value)} style={selectStyle}>
              {OUTREACH_STATUSES.map(s => (
                <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
              ))}
            </select>
            <button style={smallBtnStyle} disabled={generateDraft.isPending}
              onClick={() => { if (draft) setShowDraft(v => !v); else generateDraft.mutate({ id: o.id }); }}>
              {generateDraft.isPending ? '\u2026' : draft ? (showDraft ? 'Hide' : 'View Email') : '\u2709 Draft Email'}
            </button>
          </div>
          {generateDraft.error && (
            <div style={{ color: '#dc2626', fontSize: '0.72rem', marginTop: '0.25rem' }}>
              {generateDraft.error.message}
            </div>
          )}
        </td>
      </tr>
      {showDraft && draft && (
        <tr>
          <td colSpan={5} style={{ ...tdStyle, background: '#f8fafc', padding: '0.75rem 1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#374151' }}>Generated Email Draft</span>
              <button style={smallBtnStyle} onClick={copy}>{copied ? '\u2713 Copied' : '\u2398 Copy'}</button>
            </div>
            <pre style={preStyle}>{draft}</pre>
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
    <main style={pageStyle}>
      <h1 style={{ marginBottom: '1.5rem' }}>Backlinks & Outreach</h1>
      <div style={tabBarStyle}>
        {(['backlinks', 'outreach'] as const).map(t => (
          <button key={t} style={{ ...tabBtnStyle, ...(activeTab === t ? tabActiveStyle : {}) }} onClick={() => setActiveTab(t)}>
            {t === 'backlinks' ? 'Backlink Profile' : 'Outreach Pipeline'}
          </button>
        ))}
      </div>

      {activeTab === 'backlinks' && (
        <section style={{ marginTop: '1rem' }}>
          {backlinks.isLoading && <p style={mutedStyle}>Loading...</p>}
          {backlinks.error && <p style={errorStyle}>{backlinks.error.message}</p>}
          <table style={tableStyle}>
            <thead><tr>
              <th style={thStyle}>Source Domain</th>
              <th style={thStyle}>Anchor Text</th>
              <th style={thStyle}>DA</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>First Seen</th>
            </tr></thead>
            <tbody>
              {(backlinks.data as any[] ?? []).length === 0 && (
                <tr><td colSpan={5} style={{ ...tdStyle, color: '#6b7280', textAlign: 'center' }}>No backlinks found. Run the agent to sync.</td></tr>
              )}
              {(backlinks.data as any[] ?? []).map((b: any, i: number) => (
                <tr key={b.id} style={i % 2 === 0 ? {} : { background: '#f9fafb' }}>
                  <td style={tdStyle}>{b.source_domain}</td>
                  <td style={tdStyle}>{b.anchor_text ?? '\u2014'}</td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>{b.domain_authority ?? '\u2014'}</td>
                  <td style={tdStyle}><StatusBadge status={b.status} /></td>
                  <td style={tdStyle}>{b.first_seen_at ? new Date(b.first_seen_at).toLocaleDateString() : '\u2014'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {activeTab === 'outreach' && (
        <section style={{ marginTop: '1rem' }}>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem', alignItems: 'flex-end' }}>
            {[
              { label: 'Total Prospects', value: stats.total, color: '#374151' },
              { label: 'Pending', value: stats.pending, color: '#f59e0b' },
              { label: 'In Progress', value: stats.contacted, color: '#3b82f6' },
              { label: 'Links Acquired', value: stats.acquired, color: '#16a34a' },
            ].map(s => (
              <div key={s.label} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '0.6rem 1rem', minWidth: 110 }}>
                <div style={{ fontSize: '0.72rem', color: '#6b7280', marginBottom: '0.15rem' }}>{s.label}</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, color: s.color }}>{s.value}</div>
              </div>
            ))}
            <button style={{ ...btnStyle, marginLeft: 'auto' }} disabled={findProspects.isPending} onClick={() => findProspects.mutate()}>
              {findProspects.isPending ? 'Searching...' : 'Find New Prospects'}
            </button>
          </div>
          {findProspects.isSuccess && <p style={{ color: '#16a34a', fontSize: '0.875rem', marginBottom: '0.75rem' }}>Found {(findProspects.data as any)?.count ?? 0} new prospect(s)</p>}
          {findProspects.error && <p style={errorStyle}>{findProspects.error.message}</p>}
          {outreach.isLoading && <p style={mutedStyle}>Loading...</p>}
          <table style={tableStyle}>
            <thead><tr>
              <th style={thStyle}>Domain + Contact</th>
              <th style={thStyle}>DA</th>
              <th style={thStyle}>Relevance</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Actions</th>
            </tr></thead>
            <tbody>
              {outreachData.length === 0 && (
                <tr><td colSpan={5} style={{ ...tdStyle, color: '#6b7280', textAlign: 'center' }}>No prospects yet. Click Find New Prospects or run the agent.</td></tr>
              )}
              {outreachData.map((o: any) => (
                <OutreachRow key={o.id} o={o}
                  onStatusChange={(id, status) => updateStatus.mutate({ id, status })}
                  statusPending={updateStatus.isPending} />
              ))}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}

const pageStyle: React.CSSProperties = { fontFamily: 'system-ui, sans-serif', padding: '2rem', maxWidth: 1100, margin: '0 auto' };
const tabBarStyle: React.CSSProperties = { display: 'flex', gap: '0.25rem', borderBottom: '2px solid #e5e7eb' };
const tabBtnStyle: React.CSSProperties = { padding: '0.5rem 1.25rem', background: 'none', border: 'none', borderBottom: '2px solid transparent', marginBottom: '-2px', cursor: 'pointer', fontSize: '0.875rem', color: '#6b7280', fontWeight: 500 };
const tabActiveStyle: React.CSSProperties = { borderBottomColor: '#2563eb', color: '#2563eb', fontWeight: 600 };
const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' };
const thStyle: React.CSSProperties = { padding: '0.6rem 0.75rem', background: '#f3f4f6', border: '1px solid #e5e7eb', textAlign: 'left', fontWeight: 600, whiteSpace: 'nowrap' };
const tdStyle: React.CSSProperties = { padding: '0.5rem 0.75rem', border: '1px solid #e5e7eb', verticalAlign: 'top' };
const selectStyle: React.CSSProperties = { padding: '0.25rem 0.5rem', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '0.8rem', background: '#fff' };
const btnStyle: React.CSSProperties = { padding: '0.4rem 1rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.875rem' };
const smallBtnStyle: React.CSSProperties = { padding: '0.2rem 0.6rem', background: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer', fontSize: '0.8rem' };
const mutedStyle: React.CSSProperties = { color: '#6b7280', fontSize: '0.875rem' };
const errorStyle: React.CSSProperties = { color: '#dc2626', fontSize: '0.875rem' };
const preStyle: React.CSSProperties = { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 4, padding: '0.75rem', fontSize: '0.8rem', whiteSpace: 'pre-wrap', margin: 0, lineHeight: 1.6 };
