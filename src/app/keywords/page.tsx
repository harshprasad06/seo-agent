'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import SharedLayout from '../SharedLayout';

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
    <SharedLayout>
      <div className="page-header">
        <h1 className="page-title">Keyword Rankings</h1>
        <p className="page-subtitle">Monitor your keyword positions and track improvements over time.</p>
      </div>

      {/* Filters */}
      <div className="filters-bar">
        <label className="label">
          Intent
          <select className="select" value={intentCluster} onChange={e => setIntentCluster(e.target.value as IntentCluster)}>
            <option value="all">All</option>
            <option value="informational">Informational</option>
            <option value="navigational">Navigational</option>
            <option value="commercial">Commercial</option>
            <option value="transactional">Transactional</option>
          </select>
        </label>
        <label className="label">
          Min Position
          <input className="input" type="number" min={1} value={minPosition} onChange={e => setMinPosition(e.target.value)} placeholder="e.g. 1" style={{ width: 110 }} />
        </label>
        <label className="label">
          Max Position
          <input className="input" type="number" min={1} value={maxPosition} onChange={e => setMaxPosition(e.target.value)} placeholder="e.g. 100" style={{ width: 110 }} />
        </label>
        <label className="label">
          Competitor Domain
          <input className="input" type="text" value={competitorDomain} onChange={e => setCompetitorDomain(e.target.value)} placeholder="e.g. competitor.com" style={{ width: 180 }} />
        </label>
      </div>

      {/* States */}
      {isLoading && <p className="text-muted">Loading keywords…</p>}
      {error && <p className="text-error">Error: {error.message}</p>}

      {/* Table */}
      {data && (
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>Keyword</th>
                <th>Current Pos.</th>
                <th>Previous Pos.</th>
                <th>Delta</th>
                <th>Search Volume</th>
                <th>Difficulty</th>
                <th>Intent</th>
                <th>Status</th>
                {showCompetitorCol && <th>Competitor Pos.</th>}
              </tr>
            </thead>
            <tbody>
              {data.length === 0 && (
                <tr>
                  <td colSpan={showCompetitorCol ? 9 : 8} style={{ textAlign: 'center', color: 'var(--text-tertiary)' }}>
                    No keywords found.
                  </td>
                </tr>
              )}
              {data.map((kw: any, i: number) => {
                const delta = kw.current_position != null && kw.previous_position != null
                  ? kw.previous_position - kw.current_position
                  : null;
                return (
                  <tr key={kw.id ?? i}>
                    <td style={{ fontWeight: 500 }}>{kw.keyword}</td>
                    <td style={{ textAlign: 'center' }}>{kw.current_position ?? '—'}</td>
                    <td style={{ textAlign: 'center' }}>{kw.previous_position ?? '—'}</td>
                    <td style={{ textAlign: 'center' }}>
                      {delta === null ? '—' : (
                        <span style={{ color: delta > 0 ? 'var(--success)' : delta < 0 ? 'var(--danger)' : 'var(--text-tertiary)', fontWeight: 600 }}>
                          {delta > 0 ? `↑ ${delta}` : delta < 0 ? `↓ ${Math.abs(delta)}` : `— 0`}
                        </span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {kw.search_volume != null ? kw.search_volume.toLocaleString() : '—'}
                    </td>
                    <td style={{ textAlign: 'center' }}>{kw.difficulty ?? '—'}</td>
                    <td>{kw.intent_cluster ? <span className="badge badge-primary">{kw.intent_cluster}</span> : '—'}</td>
                    <td>{kw.status ? <span className="badge badge-neutral">{kw.status}</span> : '—'}</td>
                    {showCompetitorCol && <td style={{ textAlign: 'center' }}>{kw.competitor_position ?? '—'}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </SharedLayout>
  );
}
