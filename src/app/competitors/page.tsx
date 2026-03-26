'use client';

import { useState, useRef } from 'react';
import { trpc } from '@/lib/trpc';

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

// ── Discovered competitor card ────────────────────────────────────────────────
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

  const scoreColor = d.score >= 70 ? '#15803d' : d.score >= 40 ? '#b45309' : '#6b7280';
  const scoreBarColor = d.score >= 70 ? '#22c55e' : d.score >= 40 ? '#f59e0b' : '#9ca3af';

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 600, fontSize: '0.9rem', flex: 1 }}>{d.domain}</span>
        <span style={badgeStyle}>{d.count} match{d.count !== 1 ? 'es' : ''}</span>
        <button style={iconBtnStyle} onClick={copy}>{copied ? '✓ copied' : '⎘ copy'}</button>
        {alreadyAdded
          ? <span style={{ color: '#16a34a', fontSize: '0.8rem', fontWeight: 600 }}>✓ Added</span>
          : <button style={smallBtnStyle} disabled={addPending} onClick={onAdd}>+ Add</button>}
      </div>

      {/* Score bar */}
      <div style={{ marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <span style={{ fontSize: '0.75rem', color: '#6b7280', width: 48, flexShrink: 0 }}>Score</span>
        <div style={{ flex: 1, background: '#f3f4f6', borderRadius: 4, height: 6, overflow: 'hidden' }}>
          <div style={{ width: `${d.score}%`, background: scoreBarColor, height: '100%', borderRadius: 4 }} />
        </div>
        <span style={{ fontSize: '0.78rem', fontWeight: 700, color: scoreColor, width: 32, textAlign: 'right' }}>{d.score}</span>
      </div>

      <button style={toggleBtnStyle} onClick={() => setExpanded(v => !v)}>
        {expanded ? '▲ Hide' : '▼ Show'} search queries ({d.queries.length})
      </button>

      {expanded && (
        <ol style={{ margin: '0.5rem 0 0 1.2rem', padding: 0, fontSize: '0.8rem', color: '#374151', lineHeight: 1.8 }}>
          {d.queries.map(q => (
            <li key={q}>
              {q.startsWith('related:')
                ? <><span style={{ color: '#7c3aed', fontWeight: 600 }}>🔗 related:</span>{q.replace(/^related:/, '')}</>
                : q}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
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
  const keywords = trpc.competitors.keywords.useQuery(
    { competitor_id: selectedId },
    { enabled: !!selectedId },
  );
  const add = trpc.competitors.add.useMutation({
    onSuccess: () => { competitors.refetch(); setDomain(''); setName(''); },
  });
  const remove = trpc.competitors.remove.useMutation({ onSuccess: () => competitors.refetch() });

  const analyzeSite = trpc.competitors.analyzeSite.useMutation({
    onSuccess: (data) => {
      setSummary(data as SiteSummary);
      setEditedQueries((data as SiteSummary).searchQueries);
      setDiscovered([]);
    },
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
    <main style={pageStyle}>
      <h1 style={{ marginBottom: '1.5rem' }}>Competitors</h1>

      {/* ── Step 1: Analyze site ── */}
      <section style={sectionStyle}>
        <h2 style={sectionHeadingStyle}>Step 1 — Understand Your Site</h2>
        <p style={mutedStyle}>
          Fetches your homepage, reads the content, and uses AI to understand what your site does —
          then generates targeted search queries to find real competitors.
        </p>
        <button
          style={{ ...btnStyle, marginTop: '0.75rem' }}
          disabled={analyzeSite.isPending}
          onClick={() => analyzeSite.mutate()}
        >
          {analyzeSite.isPending ? '🔍 Analyzing site…' : '🧠 Analyze My Site'}
        </button>
        {analyzeSite.error && <p style={errorStyle}>Error: {analyzeSite.error.message}</p>}

        {summary && (
          <div style={{ marginTop: '1rem' }}>
            {/* Summary card */}
            <div style={{ ...cardStyle, background: '#f8fafc', marginBottom: '1rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem 1.5rem', fontSize: '0.85rem' }}>
                <div><span style={labelKey}>Business type</span><span>{summary.businessType}</span></div>
                <div><span style={labelKey}>Niche</span><span>{summary.niche}</span></div>
                <div style={{ gridColumn: '1 / -1' }}><span style={labelKey}>What they do</span><span>{summary.whatTheyDo}</span></div>
                <div><span style={labelKey}>Business model</span><span>{summary.businessModel}</span></div>
                <div><span style={labelKey}>Target audience</span><span>{summary.targetAudience}</span></div>
                <div style={{ gridColumn: '1 / -1' }}><span style={labelKey}>Unique value prop</span><span>{summary.uniqueValueProp}</span></div>
              </div>
            </div>

            {/* Editable queries */}
            <p style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.4rem' }}>
              AI-generated search queries <span style={{ color: '#6b7280', fontWeight: 400 }}>(edit if needed)</span>
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              {editedQueries.map((q, i) => (
                <div key={i} style={{ display: 'flex', gap: '0.4rem' }}>
                  <input
                    value={q}
                    onChange={e => setEditedQueries(prev => prev.map((x, j) => j === i ? e.target.value : x))}
                    style={{ ...inputStyle, flex: 1, width: 'auto' }}
                  />
                  <button
                    style={{ ...iconBtnStyle, color: '#dc2626' }}
                    onClick={() => setEditedQueries(prev => prev.filter((_, j) => j !== i))}
                  >✕</button>
                </div>
              ))}
              <button
                style={{ ...smallBtnStyle, alignSelf: 'flex-start', marginTop: '0.25rem' }}
                onClick={() => setEditedQueries(prev => [...prev, ''])}
              >+ Add query</button>
            </div>

            {/* Optional seed domains */}
            <p style={{ fontSize: '0.85rem', fontWeight: 600, margin: '0.75rem 0 0.4rem' }}>
              Seed domains <span style={{ color: '#6b7280', fontWeight: 400 }}>(known competitors — boosts related: accuracy)</span>
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', alignItems: 'center' }}>
              {seeds.map(s => (
                <span key={s} style={seedTagStyle}>
                  {s}
                  <button
                    style={{ marginLeft: '0.3rem', background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: '0.75rem', padding: 0 }}
                    onClick={() => setSeeds(prev => prev.filter(x => x !== s))}
                  >✕</button>
                </span>
              ))}
              <input
                value={seedInput}
                onChange={e => setSeedInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addSeed(); }}
                placeholder="competitor.com + Enter"
                style={{ ...inputStyle, width: 180, fontSize: '0.8rem' }}
              />
              <button style={smallBtnStyle} onClick={addSeed}>Add</button>
            </div>
          </div>
        )}
      </section>

      {/* ── Step 2: Discover ── */}
      {summary && (
        <section style={sectionStyle}>
          <h2 style={sectionHeadingStyle}>Step 2 — Find Competitors</h2>
          <p style={mutedStyle}>Searches Google using the AI-generated queries above to find your real competitors.</p>
          <button
            style={{ ...btnStyle, marginTop: '0.75rem' }}
            disabled={discover.isPending}
            onClick={() => discover.mutate({ searchQueries: editedQueries.filter(q => q.trim()), seeds })}
          >
            {discover.isPending ? 'Searching…' : '🔍 Find Competitors'}
          </button>
          {discover.error && <p style={errorStyle}>Error: {discover.error.message}</p>}

          {discovered.length > 0 && (
            <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {discovered.map(d => (
                <DiscoveredCard
                  key={d.domain}
                  d={d}
                  alreadyAdded={existingDomains.has(d.domain)}
                  addPending={add.isPending}
                  onAdd={() => {
                    add.mutate({ domain: d.domain, name: d.domain });
                    setDiscovered(prev => prev.filter(x => x.domain !== d.domain));
                  }}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {/* ── Add Manually ── */}
      <section style={sectionStyle}>
        <h2 style={sectionHeadingStyle}>Add Manually</h2>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={labelStyle}>
            Domain
            <input value={domain} onChange={e => setDomain(e.target.value)} placeholder="competitor.com" style={inputStyle} />
          </label>
          <label style={labelStyle}>
            Name
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Competitor Inc." style={inputStyle} />
          </label>
          <button
            style={btnStyle}
            disabled={add.isPending || !domain.trim() || !name.trim()}
            onClick={() => add.mutate({ domain: domain.trim(), name: name.trim() })}
          >Add</button>
        </div>
        {add.error && <p style={errorStyle}>Error: {add.error.message}</p>}
      </section>

      {/* ── Competitor List ── */}
      <section style={sectionStyle}>
        <h2 style={sectionHeadingStyle}>Competitor List</h2>
        {competitors.isLoading && <p style={mutedStyle}>Loading…</p>}
        {competitors.error && <p style={errorStyle}>Error: {competitors.error.message}</p>}
        {remove.error && <p style={errorStyle}>Remove failed: {remove.error.message}</p>}
        {competitors.data && (
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Domain</th>
                <th style={thStyle}>Active</th>
                <th style={thStyle}>Added</th>
                <th style={thStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {(competitors.data as any[]).length === 0 && (
                <tr><td colSpan={5} style={{ ...tdStyle, color: '#6b7280', textAlign: 'center' }}>No competitors added yet.</td></tr>
              )}
              {(competitors.data as any[]).map((c: any, i: number) => (
                <tr key={c.id} style={i % 2 === 0 ? {} : { background: '#f9fafb' }}>
                  <td style={tdStyle}>{c.name}</td>
                  <td style={tdStyle}>{c.domain}</td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>{c.is_active ? '✓' : '✗'}</td>
                  <td style={tdStyle}>{c.created_at ? new Date(c.created_at).toLocaleDateString() : '—'}</td>
                  <td style={tdStyle}>
                    <button style={smallBtnStyle} onClick={() => {
                      setSelectedId(c.id);
                      setTimeout(() => keywordsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
                    }}>View Keywords</button>
                    {c.is_active && (
                      <button
                        style={{ ...smallBtnStyle, background: '#fee2e2', color: '#991b1b', marginLeft: '0.5rem' }}
                        disabled={remove.isPending}
                        onClick={() => remove.mutate({ id: c.id })}
                      >Remove</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* ── Keyword Rankings ── */}
      <section ref={keywordsRef} style={sectionStyle}>
        <h2 style={sectionHeadingStyle}>Keyword Rankings</h2>
        <div style={{ marginBottom: '0.75rem' }}>
          <label style={labelStyle}>
            Select Competitor
            <select value={selectedId} onChange={e => setSelectedId(e.target.value)} style={{ ...inputStyle, width: 220 }}>
              <option value="">— choose a competitor —</option>
              {((competitors.data ?? []) as any[]).map((c: any) => (
                <option key={c.id} value={c.id}>{c.name} ({c.domain})</option>
              ))}
            </select>
          </label>
        </div>
        {!selectedId && <p style={mutedStyle}>Select a competitor to view their keyword rankings.</p>}
        {selectedId && keywords.isLoading && <p style={mutedStyle}>Loading…</p>}
        {selectedId && keywords.error && <p style={errorStyle}>Error: {keywords.error.message}</p>}
        {selectedId && keywords.data && (
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Keyword</th>
                <th style={thStyle}>Position</th>
                <th style={thStyle}>Tracked At</th>
              </tr>
            </thead>
            <tbody>
              {(keywords.data as any[]).length === 0 && (
                <tr><td colSpan={3} style={{ ...tdStyle, color: '#6b7280', textAlign: 'center' }}>No keywords tracked yet for this competitor. Run the agent to populate via the Competitor Monitor worker.</td></tr>
              )}
              {(keywords.data as any[]).map((k: any, i: number) => (
                <tr key={k.id} style={i % 2 === 0 ? {} : { background: '#f9fafb' }}>
                  <td style={tdStyle}>{k.keyword}</td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>{k.position ?? '—'}</td>
                  <td style={tdStyle}>{k.tracked_at ? new Date(k.tracked_at).toLocaleDateString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}

const pageStyle: React.CSSProperties = { fontFamily: 'system-ui, sans-serif', padding: '2rem', maxWidth: 1100, margin: '0 auto' };
const sectionStyle: React.CSSProperties = { marginBottom: '2rem' };
const sectionHeadingStyle: React.CSSProperties = { fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.25rem' };
const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' };
const thStyle: React.CSSProperties = { padding: '0.6rem 0.75rem', background: '#f3f4f6', border: '1px solid #e5e7eb', textAlign: 'left', fontWeight: 600, whiteSpace: 'nowrap' };
const tdStyle: React.CSSProperties = { padding: '0.5rem 0.75rem', border: '1px solid #e5e7eb' };
const inputStyle: React.CSSProperties = { padding: '0.35rem 0.5rem', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '0.875rem', width: 160 };
const labelStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.85rem', color: '#374151', fontWeight: 500 };
const btnStyle: React.CSSProperties = { padding: '0.4rem 1rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.875rem' };
const smallBtnStyle: React.CSSProperties = { padding: '0.2rem 0.6rem', background: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer', fontSize: '0.8rem' };
const mutedStyle: React.CSSProperties = { color: '#6b7280', fontSize: '0.875rem' };
const errorStyle: React.CSSProperties = { color: '#dc2626', fontSize: '0.875rem' };
const cardStyle: React.CSSProperties = { border: '1px solid #e5e7eb', borderRadius: 8, padding: '0.75rem 1rem', background: '#fff' };
const badgeStyle: React.CSSProperties = { background: '#f0fdf4', color: '#15803d', border: '1px solid #bbf7d0', borderRadius: 12, padding: '0.1rem 0.5rem', fontSize: '0.75rem', fontWeight: 600 };
const iconBtnStyle: React.CSSProperties = { padding: '0.15rem 0.5rem', background: '#f9fafb', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer', fontSize: '0.78rem' };
const toggleBtnStyle: React.CSSProperties = { marginTop: '0.4rem', background: 'none', border: 'none', color: '#6b7280', fontSize: '0.78rem', cursor: 'pointer', padding: 0 };
const seedTagStyle: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe', borderRadius: 12, padding: '0.1rem 0.5rem', fontSize: '0.75rem', fontWeight: 500 };
const labelKey: React.CSSProperties = { fontWeight: 600, color: '#6b7280', marginRight: '0.4rem', display: 'inline' };
