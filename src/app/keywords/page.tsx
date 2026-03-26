'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';

type IntentCluster = 'all' | 'informational' | 'navigational' | 'commercial' | 'transactional';

export default function KeywordsPage() {
  const [intentCluster, setIntentCluster] = useState<IntentCluster>('all');
  const [minPosition, setMinPosition] = useState('');
  const [maxPosition, setMaxPosition] = useState('');
  const [competitorDomain, setCompetitorDomain] = useState('');

  const filters = {
    intent_cluster: intentCluster !== 'all' ? intentCluster : undefined,
    min_position: minPosition !== '' ? parseInt(minPosition, 10) : undefined,
    max_position: maxPosition !== '' ? parseInt(maxPosition, 10) : undefined,
    competitor_domain: competitorDomain.trim() !== '' ? competitorDomain.trim() : undefined,
  };

  const { data, isLoading, error } = trpc.keywords.list.useQuery(filters);

  const showCompetitorCol = !!filters.competitor_domain;

  return (
    <main style={pageStyle}>
      <h1 style={{ marginBottom: '1.5rem' }}>Keyword Rankings</h1>

      {/* Filters */}
      <div style={filtersStyle}>
        <label style={labelStyle}>
          Intent
          <select
            value={intentCluster}
            onChange={e => setIntentCluster(e.target.value as IntentCluster)}
            style={selectStyle}
          >
            <option value="all">All</option>
            <option value="informational">Informational</option>
            <option value="navigational">Navigational</option>
            <option value="commercial">Commercial</option>
            <option value="transactional">Transactional</option>
          </select>
        </label>

        <label style={labelStyle}>
          Min Position
          <input
            type="number"
            min={1}
            value={minPosition}
            onChange={e => setMinPosition(e.target.value)}
            placeholder="e.g. 1"
            style={inputStyle}
          />
        </label>

        <label style={labelStyle}>
          Max Position
          <input
            type="number"
            min={1}
            value={maxPosition}
            onChange={e => setMaxPosition(e.target.value)}
            placeholder="e.g. 100"
            style={inputStyle}
          />
        </label>

        <label style={labelStyle}>
          Competitor Domain
          <input
            type="text"
            value={competitorDomain}
            onChange={e => setCompetitorDomain(e.target.value)}
            placeholder="e.g. competitor.com"
            style={{ ...inputStyle, width: 180 }}
          />
        </label>
      </div>

      {/* States */}
      {isLoading && <p style={mutedStyle}>Loading keywords…</p>}
      {error && <p style={errorStyle}>Error: {error.message}</p>}

      {/* Table */}
      {data && (
        <div style={{ overflowX: 'auto' }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Keyword</th>
                <th style={thStyle}>Current Pos.</th>
                <th style={thStyle}>Previous Pos.</th>
                <th style={thStyle}>Delta</th>
                <th style={thStyle}>Search Volume</th>
                <th style={thStyle}>Difficulty</th>
                <th style={thStyle}>Intent</th>
                <th style={thStyle}>Status</th>
                {showCompetitorCol && <th style={thStyle}>Competitor Pos.</th>}
              </tr>
            </thead>
            <tbody>
              {data.length === 0 && (
                <tr>
                  <td colSpan={showCompetitorCol ? 9 : 8} style={{ ...tdStyle, color: '#6b7280', textAlign: 'center' }}>
                    No keywords found.
                  </td>
                </tr>
              )}
              {data.map((kw: any, i: number) => {
                const delta =
                  kw.current_position != null && kw.previous_position != null
                    ? kw.previous_position - kw.current_position
                    : null;

                return (
                  <tr key={kw.id ?? i} style={i % 2 === 0 ? {} : { background: '#f9fafb' }}>
                    <td style={tdStyle}>{kw.keyword}</td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>{kw.current_position ?? '—'}</td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>{kw.previous_position ?? '—'}</td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                      {delta === null ? '—' : (
                        <span style={{ color: delta > 0 ? '#16a34a' : delta < 0 ? '#dc2626' : '#6b7280', fontWeight: 600 }}>
                          {delta > 0 ? `↑ ${delta}` : delta < 0 ? `↓ ${Math.abs(delta)}` : `— 0`}
                        </span>
                      )}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      {kw.search_volume != null ? kw.search_volume.toLocaleString() : '—'}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>{kw.difficulty ?? '—'}</td>
                    <td style={tdStyle}>{kw.intent_cluster ?? '—'}</td>
                    <td style={tdStyle}>{kw.status ?? '—'}</td>
                    {showCompetitorCol && (
                      <td style={{ ...tdStyle, textAlign: 'center' }}>
                        {kw.competitor_position ?? '—'}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
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

const filtersStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '1rem',
  marginBottom: '1.5rem',
  padding: '1rem',
  background: '#f9fafb',
  border: '1px solid #e5e7eb',
  borderRadius: 8,
};

const labelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.25rem',
  fontSize: '0.85rem',
  color: '#374151',
  fontWeight: 500,
};

const inputStyle: React.CSSProperties = {
  padding: '0.35rem 0.5rem',
  border: '1px solid #d1d5db',
  borderRadius: 4,
  fontSize: '0.875rem',
  width: 110,
};

const selectStyle: React.CSSProperties = {
  padding: '0.35rem 0.5rem',
  border: '1px solid #d1d5db',
  borderRadius: 4,
  fontSize: '0.875rem',
  background: '#fff',
};

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '0.875rem',
};

const thStyle: React.CSSProperties = {
  padding: '0.6rem 0.75rem',
  background: '#f3f4f6',
  border: '1px solid #e5e7eb',
  textAlign: 'left',
  fontWeight: 600,
  whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = {
  padding: '0.5rem 0.75rem',
  border: '1px solid #e5e7eb',
};

const mutedStyle: React.CSSProperties = {
  color: '#6b7280',
  fontSize: '0.875rem',
};

const errorStyle: React.CSSProperties = {
  color: '#dc2626',
  fontSize: '0.875rem',
};
