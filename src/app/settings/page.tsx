'use client';

import { useState } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { trpc } from '@/lib/trpc';
import SharedLayout from '../SharedLayout';

const AUTO_FIX_ACTIONS = [
  'add_missing_alt_text', 'fix_broken_internal_link', 'update_xml_sitemap',
  'correct_redirect_chain', 'add_missing_meta_description',
];

const RECOMMENDATION_ACTIONS = [
  'change_primary_title_tag', 'change_h1_heading', 'change_canonical_tag',
  'modify_robots_txt', 'publish_new_content',
];

export default function SettingsPage() {
  const { data: session, status } = useSession();
  const [domain, setDomain] = useState('');
  const [name, setName] = useState('');

  const competitors = trpc.competitors.list.useQuery();
  const add = trpc.competitors.add.useMutation({
    onSuccess: () => { competitors.refetch(); setDomain(''); setName(''); },
  });
  const remove = trpc.competitors.remove.useMutation({
    onSuccess: () => competitors.refetch(),
  });

  const isSignedIn = status === 'authenticated' && !!session;
  const activeCompetitors = (competitors.data ?? []).filter((c: any) => c.is_active);

  return (
    <SharedLayout>
      <div className="page-header">
        <h1 className="page-title">Settings</h1>
        <p className="page-subtitle">Manage connections, competitors, and risk policies.</p>
      </div>

      {/* OAuth Connections */}
      <section className="section">
        <h2 className="section-title">OAuth Connections</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div className="connection-row">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <span style={{ fontWeight: 500, fontSize: '0.9rem', color: 'var(--text-primary)' }}>Google Search Console</span>
              <span className={`badge ${isSignedIn ? 'badge-success' : 'badge-danger'}`}>
                {isSignedIn ? 'Connected' : 'Not connected'}
              </span>
            </div>
            {!isSignedIn && (
              <a href="/api/auth/signin?callbackUrl=/settings" className="btn btn-primary btn-sm" style={{ textDecoration: 'none' }}>Connect GSC</a>
            )}
          </div>

          <div className="connection-row">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <span style={{ fontWeight: 500, fontSize: '0.9rem', color: 'var(--text-primary)' }}>Google Analytics</span>
              <span className={`badge ${isSignedIn ? 'badge-success' : 'badge-danger'}`}>
                {isSignedIn ? 'Connected' : 'Not connected'}
              </span>
            </div>
            {!isSignedIn && (
              <a href="/api/auth/signin?callbackUrl=/settings" className="btn btn-primary btn-sm" style={{ textDecoration: 'none' }}>Connect GA</a>
            )}
          </div>

          {isSignedIn && (
            <div style={{ marginTop: '0.25rem' }}>
              <p className="text-muted">Signed in as {session.user?.email}</p>
              <button className="btn btn-ghost btn-sm" style={{ marginTop: '0.5rem' }} onClick={() => signOut({ callbackUrl: '/settings' })}>Sign Out</button>
            </div>
          )}
        </div>
      </section>

      {/* Competitors */}
      <section className="section">
        <h2 className="section-title">
          Competitors
          {competitors.data && (
            <span style={{ fontSize: '0.82rem', fontWeight: 400, color: 'var(--text-tertiary)' }}>
              {activeCompetitors.length} active
              {activeCompetitors.length < 5 && (
                <span style={{ color: 'var(--warning)', marginLeft: '0.5rem' }}>(minimum 5 recommended)</span>
              )}
            </span>
          )}
        </h2>

        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '1rem' }}>
          <label className="label">Domain<input className="input" value={domain} onChange={e => setDomain(e.target.value)} placeholder="competitor.com" style={{ width: 160 }} /></label>
          <label className="label">Name<input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Competitor Inc." style={{ width: 160 }} /></label>
          <button className="btn btn-primary" disabled={add.isPending || !domain.trim() || !name.trim()} onClick={() => add.mutate({ domain: domain.trim(), name: name.trim() })}>
            {add.isPending ? 'Adding…' : 'Add Competitor'}
          </button>
        </div>
        {add.error && <p className="text-error">Error: {add.error.message}</p>}

        {competitors.isLoading && <p className="text-muted">Loading…</p>}
        {competitors.error && <p className="text-error">Error: {competitors.error.message}</p>}
        {competitors.data && (
          <div className="table-wrapper">
            <table className="table">
              <thead><tr><th>Name</th><th>Domain</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>
                {competitors.data.length === 0 && (
                  <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-tertiary)' }}>No competitors added yet.</td></tr>
                )}
                {competitors.data.map((c: any) => (
                  <tr key={c.id}>
                    <td style={{ fontWeight: 500 }}>{c.name}</td>
                    <td>{c.domain}</td>
                    <td style={{ textAlign: 'center' }}>
                      <span className={`badge ${c.is_active ? 'badge-success' : 'badge-danger'}`}>
                        {c.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>
                      {c.is_active && (
                        <button className="btn btn-danger btn-sm" disabled={remove.isPending} onClick={() => remove.mutate({ id: c.id })}>Remove</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Risk Policy */}
      <section className="section">
        <h2 className="section-title">Risk Policy Configuration</h2>
        <p className="text-muted" style={{ marginBottom: '1rem' }}>
          Read-only display of the current risk policy. Changes require a code deployment.
        </p>
        <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
          <div className="policy-box">
            <h3 style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.35rem', color: 'var(--text-primary)' }}>AUTO_FIX Actions</h3>
            <p className="text-muted" style={{ marginBottom: '0.5rem', fontSize: '0.8rem' }}>Applied automatically without approval</p>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              {AUTO_FIX_ACTIONS.map(action => (
                <li key={action} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span className="badge badge-info">AUTO</span>
                  <span className="code">{action}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="policy-box">
            <h3 style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.35rem', color: 'var(--text-primary)' }}>RECOMMENDATION Actions</h3>
            <p className="text-muted" style={{ marginBottom: '0.5rem', fontSize: '0.8rem' }}>Queued for human review and approval</p>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              {RECOMMENDATION_ACTIONS.map(action => (
                <li key={action} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span className="badge badge-warning">REVIEW</span>
                  <span className="code">{action}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </SharedLayout>
  );
}
