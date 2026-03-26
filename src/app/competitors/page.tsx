'use client';

import { useState, useRef } from 'react';
import { trpc } from '@/lib/trpc';
import SharedLayout from '../SharedLayout';

type SiteSummary = {
  businessType: string;
  whatTheyDo: string;
  businessModel: string;
  targetAudience: string;
  uniqueValueProp: string;
  niche: string;
  searchQueries: string[];
};

type DiscoveredItem = {
  domain: string;
  name: string;
  count: number;
  queries: string[];
  score: number;
};

function DiscoveredCard({
  d, alreadyAdded, onAdd, addPending,
}: {
  d: DiscoveredItem;
  alreadyAdded: boolean;
  onAdd: () => void;
  addPending: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(d.domain);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const scoreColor = d.score >= 70 ? 'var(--success)' : d.score >= 40 ? 'var(--warning)' : 'var(--text-tertiary)';

  return (
    <div className="card" style={{ marginBottom: '0.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 600, fontSize: '0.9rem', flex: 1, color: 'var(--text-primary)' }}>{d.domain}</span>
        <span className="badge badge-success">{d.count} match{d.count !== 1 ? 'es' : ''}</span>
        <button className="btn btn-ghost btn-sm" onClick={copy}>{copied ? '✓ copied' : '⎘ copy'}</button>
        {alreadyAdded
          ? <span className="text-success" style={{ fontSize: '0.8rem', fontWeight: 600 }}>✓ Added</span>
          : <button className="btn btn-primary btn-sm" disabled={addPending} onClick={onAdd}>+ Add</button>}
      </div>

      <div className="score-bar-wrapper" style={{ marginTop: '0.5rem' }}>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', width: 48, flexShrink: 0 }}>Score</span>
        <div className="score-bar-track">
          <div className="score-bar-fill" style={{ width: `${d.score}%`, background: scoreColor }} />
        </div>
        <span style={{ fontSize: '0.78rem', fontWeight: 700, color: scoreColor, width: 32, textAlign: 'right' }}>{d.score}</span>
      </div>

      <button className="btn btn-ghost btn-sm" style={{ marginTop: '0.4rem', fontSize: '0.78rem' }} onClick={() => setExpanded(v => !v)}>
        {expanded ? '▲ Hide' : '▼ Show'} search queries ({d.queries.length})
      </button>

      {expanded && (
        <ol style={{ margin: '0.5rem 0 0 1.2rem', padding: 0, fontSize: '0.82rem', color: 'var(--text-primary)', lineHeight: 1.8 }}>
          {d.queries.map(q => (
            <li key={q}>
              {q.startsWith('related:')
                ? <><span style={{ color: 'var(--purple)', fontWeight: 600 }}>🔗 related:</span>{q.replace(/^related:/, '')}</>
                : q}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export default function CompetitorsPage() {
  const [domain, setDomain] = useState('');
  const [name, setName] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const keywordsRef = useRef<HTMLElement>(null);
  const [summary, setSummary] = useState<SiteSummary | null>(null);
  const [editedQueries, setEditedQueries] = useState<string[]>([]);
  const [seedInput, setSeedInput] = useState('');
  const [seeds, setSeeds] = useState<string[]>([]);
  const [discovered, setDiscovered] = useState<DiscoveredItem[]>([]);

  const competitors = trpc.competitors.list.useQuery();
  const keywords = trpc.competitors.keywords.useQuery({ competitor_id: selectedId }, { enabled: !!selectedId });
  const add = trpc.competitors.add.useMutation({ onSuccess: () => { competitors.refetch(); setDomain(''); setName(''); } });
  const remove = trpc.competitors.remove.useMutation({ onSuccess: () => competitors.refetch() });

  const analyzeSite = trpc.competitors.analyzeSite.useMutation({
    onSuccess: (data) => { setSummary(data as SiteSummary); setEditedQueries((data as SiteSummary).searchQueries); setDiscovered([]); },
  });

  const discover = trpc.competitors.discover.useMutation({
    onSuccess: (data) => setDiscovered(data as DiscoveredItem[]),
  });

  const existingDomains = new Set(((competitors.data ?? []) as any[]).map((c: any) => c.domain));

  const addSeed = () => {
    const s = seedInput.trim().replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
    if (!s) return;
    setSeeds(prev => Array.from(new Set([...prev, s])));
    setSeedInput('');
  };

  return (
    <SharedLayout>
      <div className="page-header">
        <h1 className="page-title">Competitors</h1>
        <p className="page-subtitle">Discover and track competitors using AI-powered analysis.</p>
      </div>

      {/* Step 1 */}
      <section className="section">
        <h2 className="section-title">Step 1 — Understand Your Site</h2>
        <p className="text-muted">
          Fetches your homepage, reads the content, and uses AI to understand what your site does —
          then generates targeted search queries to find real competitors.
        </p>
        <button className="btn btn-primary" style={{ marginTop: '0.75rem' }} disabled={analyzeSite.isPending} onClick={() => analyzeSite.mutate()}>
          {analyzeSite.isPending ? '🔍 Analyzing site…' : '🧠 Analyze My Site'}
        </button>
        {analyzeSite.error && <p className="text-error">Error: {analyzeSite.error.message}</p>}

        {summary && (
          <div style={{ marginTop: '1rem' }}>
            <div className="card" style={{ background: 'var(--bg-tertiary)', marginBottom: '1rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem 1.5rem', fontSize: '0.85rem' }}>
                <div><span style={{ fontWeight: 600, color: 'var(--text-tertiary)', marginRight: '0.4rem' }}>Business type</span><span>{summary.businessType}</span></div>
                <div><span style={{ fontWeight: 600, color: 'var(--text-tertiary)', marginRight: '0.4rem' }}>Niche</span><span>{summary.niche}</span></div>
                <div style={{ gridColumn: '1 / -1' }}><span style={{ fontWeight: 600, color: 'var(--text-tertiary)', marginRight: '0.4rem' }}>What they do</span><span>{summary.whatTheyDo}</span></div>
                <div><span style={{ fontWeight: 600, color: 'var(--text-tertiary)', marginRight: '0.4rem' }}>Business model</span><span>{summary.businessModel}</span></div>
                <div><span style={{ fontWeight: 600, color: 'var(--text-tertiary)', marginRight: '0.4rem' }}>Target audience</span><span>{summary.targetAudience}</span></div>
                <div style={{ gridColumn: '1 / -1' }}><span style={{ fontWeight: 600, color: 'var(--text-tertiary)', marginRight: '0.4rem' }}>Unique value prop</span><span>{summary.uniqueValueProp}</span></div>
              </div>
            </div>

            <p style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.4rem', color: 'var(--text-primary)' }}>
              AI-generated search queries <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>(edit if needed)</span>
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              {editedQueries.map((q, i) => (
                <div key={i} style={{ display: 'flex', gap: '0.4rem' }}>
                  <input className="input" value={q} onChange={e => setEditedQueries(prev => prev.map((x, j) => j === i ? e.target.value : x))} style={{ flex: 1 }} />
                  <button className="btn btn-danger btn-sm" style={{ padding: '0.25rem 0.5rem' }} onClick={() => setEditedQueries(prev => prev.filter((_, j) => j !== i))}>✕</button>
                </div>
              ))}
              <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start', marginTop: '0.25rem' }} onClick={() => setEditedQueries(prev => [...prev, ''])}>+ Add query</button>
            </div>

            <p style={{ fontSize: '0.85rem', fontWeight: 600, margin: '0.75rem 0 0.4rem', color: 'var(--text-primary)' }}>
              Seed domains <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>(known competitors — boosts related: accuracy)</span>
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', alignItems: 'center' }}>
              {seeds.map(s => (
                <span key={s} className="seed-tag">
                  {s}
                  <button onClick={() => setSeeds(prev => prev.filter(x => x !== s))}>✕</button>
                </span>
              ))}
              <input className="input" value={seedInput} onChange={e => setSeedInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addSeed(); }} placeholder="competitor.com + Enter" style={{ width: 180, fontSize: '0.82rem' }} />
              <button className="btn btn-ghost btn-sm" onClick={addSeed}>Add</button>
            </div>
          </div>
        )}
      </section>

      {/* Step 2 */}
      {summary && (
        <section className="section">
          <h2 className="section-title">Step 2 — Find Competitors</h2>
          <p className="text-muted">Searches Google using the AI-generated queries above to find your real competitors.</p>
          <button className="btn btn-primary" style={{ marginTop: '0.75rem' }} disabled={discover.isPending} onClick={() => discover.mutate({ searchQueries: editedQueries.filter(q => q.trim()), seeds })}>
            {discover.isPending ? 'Searching…' : '🔍 Find Competitors'}
          </button>
          {discover.error && <p className="text-error">Error: {discover.error.message}</p>}

          {discovered.length > 0 && (
            <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {discovered.map(d => (
                <DiscoveredCard key={d.domain} d={d} alreadyAdded={existingDomains.has(d.domain)} addPending={add.isPending}
                  onAdd={() => { add.mutate({ domain: d.domain, name: d.domain }); setDiscovered(prev => prev.filter(x => x.domain !== d.domain)); }} />
              ))}
            </div>
          )}
        </section>
      )}

      {/* Add Manually */}
      <section className="section">
        <h2 className="section-title">Add Manually</h2>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label className="label">Domain<input className="input" value={domain} onChange={e => setDomain(e.target.value)} placeholder="competitor.com" style={{ width: 160 }} /></label>
          <label className="label">Name<input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Competitor Inc." style={{ width: 160 }} /></label>
          <button className="btn btn-primary" disabled={add.isPending || !domain.trim() || !name.trim()} onClick={() => add.mutate({ domain: domain.trim(), name: name.trim() })}>Add</button>
        </div>
        {add.error && <p className="text-error">Error: {add.error.message}</p>}
      </section>

      {/* Competitor List */}
      <section className="section">
        <h2 className="section-title">Competitor List</h2>
        {competitors.isLoading && <p className="text-muted">Loading…</p>}
        {competitors.error && <p className="text-error">Error: {competitors.error.message}</p>}
        {remove.error && <p className="text-error">Remove failed: {remove.error.message}</p>}
        {competitors.data && (
          <div className="table-wrapper">
            <table className="table">
              <thead><tr><th>Name</th><th>Domain</th><th>Active</th><th>Added</th><th>Actions</th></tr></thead>
              <tbody>
                {(competitors.data as any[]).length === 0 && (
                  <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-tertiary)' }}>No competitors added yet.</td></tr>
                )}
                {(competitors.data as any[]).map((c: any) => (
                  <tr key={c.id}>
                    <td style={{ fontWeight: 500 }}>{c.name}</td>
                    <td>{c.domain}</td>
                    <td style={{ textAlign: 'center' }}>{c.is_active ? <span className="badge badge-success">Active</span> : <span className="badge badge-danger">Inactive</span>}</td>
                    <td>{c.created_at ? new Date(c.created_at).toLocaleDateString() : '—'}</td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.4rem' }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => { setSelectedId(c.id); setTimeout(() => keywordsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); }}>View Keywords</button>
                        {c.is_active && (
                          <button className="btn btn-danger btn-sm" disabled={remove.isPending} onClick={() => remove.mutate({ id: c.id })}>Remove</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Keyword Rankings */}
      <section ref={keywordsRef} className="section">
        <h2 className="section-title">Keyword Rankings</h2>
        <div style={{ marginBottom: '0.75rem' }}>
          <label className="label">
            Select Competitor
            <select className="select" value={selectedId} onChange={e => setSelectedId(e.target.value)} style={{ width: 240 }}>
              <option value="">— choose a competitor —</option>
              {((competitors.data ?? []) as any[]).map((c: any) => <option key={c.id} value={c.id}>{c.name} ({c.domain})</option>)}
            </select>
          </label>
        </div>
        {!selectedId && <p className="text-muted">Select a competitor to view their keyword rankings.</p>}
        {selectedId && keywords.isLoading && <p className="text-muted">Loading…</p>}
        {selectedId && keywords.error && <p className="text-error">Error: {keywords.error.message}</p>}
        {selectedId && keywords.data && (
          <div className="table-wrapper">
            <table className="table">
              <thead><tr><th>Keyword</th><th>Position</th><th>Tracked At</th></tr></thead>
              <tbody>
                {(keywords.data as any[]).length === 0 && (
                  <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--text-tertiary)' }}>No keywords tracked yet.</td></tr>
                )}
                {(keywords.data as any[]).map((k: any) => (
                  <tr key={k.id}>
                    <td style={{ fontWeight: 500 }}>{k.keyword}</td>
                    <td style={{ textAlign: 'center' }}>{k.position ?? '—'}</td>
                    <td>{k.tracked_at ? new Date(k.tracked_at).toLocaleDateString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </SharedLayout>
  );
}
