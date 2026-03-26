'use client';

import { useState } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { trpc } from '@/lib/trpc';

const AUTO_FIX_ACTIONS = [
  'add_missing_alt_text',
  'fix_broken_internal_link',
  'update_xml_sitemap',
  'correct_redirect_chain',
  'add_missing_meta_description',
];

const RECOMMENDATION_ACTIONS = [
  'change_primary_title_tag',
  'change_h1_heading',
  'change_canonical_tag',
  'modify_robots_txt',
  'publish_new_content',
];

export default function SettingsPage() {
  const { data: session, status } = useSession();
  const [domain, setDomain] = useState('');
  const [name, setName] = useState('');

  const competitors = trpc.competitors.list.useQuery();
  const add = trpc.competitors.add.useMutation({
    onSuccess: () => {
      competitors.refetch();
      setDomain('');
      setName('');
    },
  });
  const remove = trpc.competitors.remove.useMutation({
    onSuccess: () => competitors.refetch(),
  });

  const isSignedIn = status === 'authenticated' && !!session;
  const activeCompetitors = (competitors.data ?? []).filter((c: any) => c.is_active);

  return (
    <main style={pageStyle}>
      <h1 style={{ marginBottom: '1.5rem' }}>Settings</h1>

      {/* Section 1: OAuth Connection Status */}
      <section style={sectionStyle}>
        <h2 style={sectionHeadingStyle}>OAuth Connections</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* GSC */}
          <div style={connectionRowStyle}>
            <div>
              <span style={serviceLabelStyle}>Google Search Console</span>
              <span style={isSignedIn ? connectedBadgeStyle : disconnectedBadgeStyle}>
                {isSignedIn ? 'Connected' : 'Not connected'}
              </span>
            </div>
            {!isSignedIn && (
              <a href="/api/auth/signin?callbackUrl=/settings" style={linkBtnStyle}>
                Connect GSC
              </a>
            )}
          </div>

          {/* GA */}
          <div style={connectionRowStyle}>
            <div>
              <span style={serviceLabelStyle}>Google Analytics</span>
              <span style={isSignedIn ? connectedBadgeStyle : disconnectedBadgeStyle}>
                {isSignedIn ? 'Connected' : 'Not connected'}
              </span>
            </div>
            {!isSignedIn && (
              <a href="/api/auth/signin?callbackUrl=/settings" style={linkBtnStyle}>
                Connect GA
              </a>
            )}
          </div>

          {isSignedIn && (
            <div style={{ marginTop: '0.5rem' }}>
              <p style={mutedStyle}>Signed in as {session.user?.email}</p>
              <button
                style={{ ...btnStyle, background: '#6b7280', marginTop: '0.5rem' }}
                onClick={() => signOut({ callbackUrl: '/settings' })}
              >
                Sign Out
              </button>
            </div>
          )}
        </div>
      </section>

      {/* Section 2: Competitor List Management */}
      <section style={sectionStyle}>
        <h2 style={sectionHeadingStyle}>
          Competitors
          {competitors.data && (
            <span style={countBadgeStyle}>
              {activeCompetitors.length} active
              {activeCompetitors.length < 5 && (
                <span style={{ color: '#d97706', marginLeft: '0.5rem', fontWeight: 400 }}>
                  (minimum 5 recommended)
                </span>
              )}
            </span>
          )}
        </h2>

        {/* Add form */}
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '1rem' }}>
          <label style={labelStyle}>
            Domain
            <input
              value={domain}
              onChange={e => setDomain(e.target.value)}
              placeholder="competitor.com"
              style={inputStyle}
            />
          </label>
          <label style={labelStyle}>
            Name
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Competitor Inc."
              style={inputStyle}
            />
          </label>
          <button
            style={btnStyle}
            disabled={add.isPending || !domain.trim() || !name.trim()}
            onClick={() => add.mutate({ domain: domain.trim(), name: name.trim() })}
          >
            {add.isPending ? 'Adding…' : 'Add Competitor'}
          </button>
        </div>
        {add.error && <p style={errorStyle}>Error: {add.error.message}</p>}

        {/* List */}
        {competitors.isLoading && <p style={mutedStyle}>Loading…</p>}
        {competitors.error && <p style={errorStyle}>Error: {competitors.error.message}</p>}
        {competitors.data && (
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Domain</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {competitors.data.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ ...tdStyle, color: '#6b7280', textAlign: 'center' }}>
                    No competitors added yet.
                  </td>
                </tr>
              )}
              {competitors.data.map((c: any, i: number) => (
                <tr key={c.id} style={i % 2 === 0 ? {} : { background: '#f9fafb' }}>
                  <td style={tdStyle}>{c.name}</td>
                  <td style={tdStyle}>{c.domain}</td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>
                    <span style={c.is_active ? connectedBadgeStyle : disconnectedBadgeStyle}>
                      {c.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    {c.is_active && (
                      <button
                        style={removeBtnStyle}
                        disabled={remove.isPending}
                        onClick={() => remove.mutate({ id: c.id })}
                      >
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Section 3: Risk Policy Configuration */}
      <section style={sectionStyle}>
        <h2 style={sectionHeadingStyle}>Risk Policy Configuration</h2>
        <p style={{ ...mutedStyle, marginBottom: '1rem' }}>
          Read-only display of the current risk policy. Changes require a code deployment.
        </p>
        <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
          <div style={policyBoxStyle}>
            <h3 style={policyHeadingStyle}>AUTO_FIX Actions</h3>
            <p style={{ ...mutedStyle, marginBottom: '0.5rem', fontSize: '0.8rem' }}>
              Applied automatically without approval
            </p>
            <ul style={policyListStyle}>
              {AUTO_FIX_ACTIONS.map(action => (
                <li key={action} style={policyItemStyle}>
                  <span style={autoFixBadgeStyle}>AUTO</span>
                  <code style={codeStyle}>{action}</code>
                </li>
              ))}
            </ul>
          </div>

          <div style={policyBoxStyle}>
            <h3 style={policyHeadingStyle}>RECOMMENDATION Actions</h3>
            <p style={{ ...mutedStyle, marginBottom: '0.5rem', fontSize: '0.8rem' }}>
              Queued for human review and approval
            </p>
            <ul style={policyListStyle}>
              {RECOMMENDATION_ACTIONS.map(action => (
                <li key={action} style={policyItemStyle}>
                  <span style={recommendBadgeStyle}>REVIEW</span>
                  <code style={codeStyle}>{action}</code>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </main>
  );
}

const pageStyle: React.CSSProperties = { fontFamily: 'system-ui, sans-serif', padding: '2rem', maxWidth: 1100, margin: '0 auto' };
const sectionStyle: React.CSSProperties = { marginBottom: '2.5rem' };
const sectionHeadingStyle: React.CSSProperties = { fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.75rem' };
const connectionRowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 1rem', border: '1px solid #e5e7eb', borderRadius: 6, maxWidth: 480 };
const serviceLabelStyle: React.CSSProperties = { fontWeight: 500, marginRight: '0.75rem', fontSize: '0.9rem' };
const connectedBadgeStyle: React.CSSProperties = { background: '#d1fae5', color: '#065f46', padding: '0.15rem 0.5rem', borderRadius: 4, fontSize: '0.75rem', fontWeight: 600 };
const disconnectedBadgeStyle: React.CSSProperties = { background: '#fee2e2', color: '#991b1b', padding: '0.15rem 0.5rem', borderRadius: 4, fontSize: '0.75rem', fontWeight: 600 };
const linkBtnStyle: React.CSSProperties = { padding: '0.35rem 0.75rem', background: '#2563eb', color: '#fff', borderRadius: 4, fontSize: '0.8rem', textDecoration: 'none', fontWeight: 500 };
const countBadgeStyle: React.CSSProperties = { fontSize: '0.85rem', fontWeight: 400, color: '#6b7280' };
const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' };
const thStyle: React.CSSProperties = { padding: '0.6rem 0.75rem', background: '#f3f4f6', border: '1px solid #e5e7eb', textAlign: 'left', fontWeight: 600 };
const tdStyle: React.CSSProperties = { padding: '0.5rem 0.75rem', border: '1px solid #e5e7eb' };
const inputStyle: React.CSSProperties = { padding: '0.35rem 0.5rem', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '0.875rem', width: 160 };
const labelStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.85rem', color: '#374151', fontWeight: 500 };
const btnStyle: React.CSSProperties = { padding: '0.4rem 1rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.875rem' };
const removeBtnStyle: React.CSSProperties = { padding: '0.2rem 0.6rem', background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5', borderRadius: 4, cursor: 'pointer', fontSize: '0.8rem' };
const mutedStyle: React.CSSProperties = { color: '#6b7280', fontSize: '0.875rem' };
const errorStyle: React.CSSProperties = { color: '#dc2626', fontSize: '0.875rem' };
const policyBoxStyle: React.CSSProperties = { flex: '1 1 280px', border: '1px solid #e5e7eb', borderRadius: 6, padding: '1rem' };
const policyHeadingStyle: React.CSSProperties = { fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.25rem' };
const policyListStyle: React.CSSProperties = { listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.4rem' };
const policyItemStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: '0.5rem' };
const autoFixBadgeStyle: React.CSSProperties = { background: '#dbeafe', color: '#1e40af', padding: '0.1rem 0.4rem', borderRadius: 3, fontSize: '0.7rem', fontWeight: 700, flexShrink: 0 };
const recommendBadgeStyle: React.CSSProperties = { background: '#fef3c7', color: '#92400e', padding: '0.1rem 0.4rem', borderRadius: 3, fontSize: '0.7rem', fontWeight: 700, flexShrink: 0 };
const codeStyle: React.CSSProperties = { fontFamily: 'monospace', fontSize: '0.8rem', color: '#374151' };
