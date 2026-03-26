'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';

type Post = {
  id: string;
  target_keyword: string;
  title: string;
  slug: string;
  status: string;
  word_count: number | null;
  pr_url: string | null;
  created_at: string;
};

// ── Post Card ─────────────────────────────────────────────────────────────────

function PostCard({ post, onAction }: { post: Post; onAction: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editTitle, setEditTitle] = useState(post.title);
  const [editContent, setEditContent] = useState('');
  const [rejectNote, setRejectNote] = useState('');

  const fullPost = trpc.content.blogPost.useQuery(
    { id: post.id },
    { enabled: expanded }
  );

  const update = trpc.content.updateBlogPost.useMutation({ onSuccess: () => { setEditMode(false); onAction(); } });
  const approve = trpc.content.approveBlogPost.useMutation({ onSuccess: onAction });
  const reject = trpc.content.rejectBlogPost.useMutation({ onSuccess: onAction });
  const regen = trpc.content.regenerateBlogPost.useMutation({ onSuccess: () => { fullPost.refetch(); onAction(); } });

  const busy = update.isPending || approve.isPending || reject.isPending || regen.isPending;

  function handleExpand() {
    setExpanded(e => !e);
    if (!expanded && fullPost.data) {
      setEditContent(fullPost.data.mdx_content as string);
    }
  }

  function handleSave() {
    update.mutate({ id: post.id, title: editTitle, mdxContent: editContent });
  }

  return (
    <div style={cardStyle}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <StatusBadge status={post.status} />
            <span style={{ ...mutedStyle }}>{post.word_count ? `~${post.word_count} words` : ''}</span>
          </div>
          <p style={{ margin: '0.35rem 0 0', fontWeight: 600, fontSize: '1rem' }}>{post.title}</p>
          <p style={{ ...mutedStyle, margin: '0.2rem 0 0' }}>keyword: {post.target_keyword}</p>
        </div>
        <button onClick={handleExpand} style={ghostBtn}>
          {expanded ? 'Collapse ▲' : 'Preview ▼'}
        </button>
      </div>

      {/* Action buttons */}
      {post.status === 'draft' && (
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <button onClick={() => approve.mutate({ id: post.id })} disabled={busy} style={btnGreen}>
            {approve.isPending ? 'Opening PR…' : '✓ Approve & Publish'}
          </button>
          <button onClick={() => { setEditMode(e => !e); if (!expanded) setExpanded(true); }} disabled={busy} style={btnBlue}>
            ✎ Edit
          </button>
          <button onClick={() => regen.mutate({ id: post.id })} disabled={busy} style={btnGray}>
            {regen.isPending ? 'Regenerating…' : '↺ Regenerate'}
          </button>
          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
            <input
              placeholder="Reject reason (optional)"
              value={rejectNote}
              onChange={e => setRejectNote(e.target.value)}
              style={{ ...inputStyle, width: 200, padding: '0.25rem 0.5rem' }}
            />
            <button onClick={() => reject.mutate({ id: post.id, note: rejectNote })} disabled={busy} style={btnRed}>
              ✕ Reject
            </button>
          </div>
        </div>
      )}

      {post.status === 'approved' && post.pr_url && (
        <div style={{ marginTop: '0.5rem' }}>
          <a href={post.pr_url} target="_blank" rel="noreferrer" style={{ color: '#1d4ed8', fontSize: '0.875rem' }}>
            View PR on GitHub →
          </a>
        </div>
      )}

      {post.status === 'rejected' && (
        <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem' }}>
          <button onClick={() => regen.mutate({ id: post.id })} disabled={busy} style={btnGray}>
            {regen.isPending ? 'Regenerating…' : '↺ Regenerate'}
          </button>
        </div>
      )}

      {/* Expanded preview / edit */}
      {expanded && (
        <div style={{ marginTop: '1rem', borderTop: '1px solid #e5e7eb', paddingTop: '1rem' }}>
          {fullPost.isLoading && <p style={mutedStyle}>Loading content…</p>}
          {fullPost.data && (
            editMode ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div>
                  <label style={labelStyle}>Title</label>
                  <input value={editTitle} onChange={e => setEditTitle(e.target.value)} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>MDX Content</label>
                  <textarea
                    value={editContent || (fullPost.data.mdx_content as string)}
                    onChange={e => setEditContent(e.target.value)}
                    style={{ ...inputStyle, height: 400, fontFamily: 'monospace', fontSize: '0.8rem', resize: 'vertical' }}
                  />
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button onClick={handleSave} disabled={update.isPending} style={btnBlue}>
                    {update.isPending ? 'Saving…' : 'Save Changes'}
                  </button>
                  <button onClick={() => setEditMode(false)} style={ghostBtn}>Cancel</button>
                </div>
              </div>
            ) : (
              <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.8rem', color: '#374151', background: '#f9fafb', padding: '1rem', borderRadius: 6, maxHeight: 400, overflow: 'auto' }}>
                {fullPost.data.mdx_content as string}
              </pre>
            )
          )}
        </div>
      )}

      {/* Errors */}
      {(approve.error || reject.error || regen.error || update.error) && (
        <p style={{ ...errorStyle, marginTop: '0.5rem' }}>
          {(approve.error || reject.error || regen.error || update.error)?.message}
        </p>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ContentPage() {
  const [count, setCount] = useState(3);
  const posts = trpc.content.blogPosts.useQuery();
  const autoGen = trpc.content.autoGenerate.useMutation({ onSuccess: () => posts.refetch() });

  const drafts = posts.data?.filter((p: Post) => p.status === 'draft') ?? [];
  const approved = posts.data?.filter((p: Post) => p.status === 'approved') ?? [];
  const rejected = posts.data?.filter((p: Post) => p.status === 'rejected') ?? [];

  return (
    <main style={pageStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ margin: 0 }}>Blog Posts</h1>
          <p style={{ ...mutedStyle, margin: '0.25rem 0 0' }}>
            AI-generated SEO blog posts for learnwealthx.in. Approve to open a GitHub PR.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <select
            value={count}
            onChange={e => setCount(Number(e.target.value))}
            style={{ ...inputStyle, width: 'auto', padding: '0.4rem 0.5rem' }}
          >
            {[1, 2, 3, 5].map(n => <option key={n} value={n}>Generate {n}</option>)}
          </select>
          <button
            onClick={() => autoGen.mutate({ count })}
            disabled={autoGen.isPending}
            style={btnBlue}
          >
            {autoGen.isPending ? `Generating ${count} posts…` : '✦ Auto-Generate'}
          </button>
        </div>
      </div>

      {autoGen.error && <p style={errorStyle}>Error: {autoGen.error.message}</p>}
      {autoGen.data && (
        <p style={{ color: '#065f46', background: '#d1fae5', padding: '0.5rem 0.75rem', borderRadius: 6, fontSize: '0.875rem', marginBottom: '1rem' }}>
          Generated {autoGen.data.generated} new draft{autoGen.data.generated !== 1 ? 's' : ''}
        </p>
      )}

      {posts.isLoading && <p style={mutedStyle}>Loading…</p>}

      {/* Drafts */}
      {drafts.length > 0 && (
        <section style={{ marginBottom: '2rem' }}>
          <h2 style={sectionHeading}>Drafts ({drafts.length})</h2>
          {drafts.map((p: Post) => <PostCard key={p.id} post={p} onAction={() => posts.refetch()} />)}
        </section>
      )}

      {/* Approved */}
      {approved.length > 0 && (
        <section style={{ marginBottom: '2rem' }}>
          <h2 style={sectionHeading}>Approved ({approved.length})</h2>
          {approved.map((p: Post) => <PostCard key={p.id} post={p} onAction={() => posts.refetch()} />)}
        </section>
      )}

      {/* Rejected */}
      {rejected.length > 0 && (
        <section style={{ marginBottom: '2rem' }}>
          <h2 style={sectionHeading}>Rejected ({rejected.length})</h2>
          {rejected.map((p: Post) => <PostCard key={p.id} post={p} onAction={() => posts.refetch()} />)}
        </section>
      )}

      {posts.data?.length === 0 && !posts.isLoading && (
        <div style={{ textAlign: 'center', padding: '3rem', color: '#6b7280' }}>
          <p style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>No blog posts yet.</p>
          <p>Click "Auto-Generate" to let the AI create SEO-optimized drafts for learnwealthx.in.</p>
        </div>
      )}
    </main>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string; label: string }> = {
    draft:    { bg: '#fef9c3', color: '#854d0e', label: 'Draft' },
    approved: { bg: '#d1fae5', color: '#065f46', label: 'Approved' },
    rejected: { bg: '#fee2e2', color: '#991b1b', label: 'Rejected' },
    published:{ bg: '#dbeafe', color: '#1e40af', label: 'Published' },
  };
  const s = map[status] ?? { bg: '#f3f4f6', color: '#374151', label: status };
  return (
    <span style={{ background: s.bg, color: s.color, padding: '0.15rem 0.5rem', borderRadius: 12, fontSize: '0.75rem', fontWeight: 600 }}>
      {s.label}
    </span>
  );
}

const pageStyle: React.CSSProperties = { fontFamily: 'system-ui, sans-serif', padding: '2rem', maxWidth: 900, margin: '0 auto' };
const cardStyle: React.CSSProperties = { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '1rem 1.25rem', marginBottom: '0.75rem' };
const sectionHeading: React.CSSProperties = { fontSize: '1rem', fontWeight: 600, marginBottom: '0.75rem', color: '#374151' };
const labelStyle: React.CSSProperties = { display: 'block', fontSize: '0.8rem', fontWeight: 500, marginBottom: '0.2rem', color: '#374151' };
const inputStyle: React.CSSProperties = { width: '100%', padding: '0.5rem 0.75rem', border: '1px solid #d1d5db', borderRadius: 6, fontSize: '0.875rem', boxSizing: 'border-box' };
const btnBlue: React.CSSProperties = { background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, padding: '0.4rem 1rem', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 500 };
const btnGreen: React.CSSProperties = { background: '#16a34a', color: '#fff', border: 'none', borderRadius: 6, padding: '0.4rem 1rem', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 500 };
const btnRed: React.CSSProperties = { background: '#dc2626', color: '#fff', border: 'none', borderRadius: 6, padding: '0.4rem 0.75rem', cursor: 'pointer', fontSize: '0.875rem' };
const btnGray: React.CSSProperties = { background: '#6b7280', color: '#fff', border: 'none', borderRadius: 6, padding: '0.4rem 0.75rem', cursor: 'pointer', fontSize: '0.875rem' };
const ghostBtn: React.CSSProperties = { background: 'none', border: '1px solid #e5e7eb', borderRadius: 6, padding: '0.3rem 0.75rem', cursor: 'pointer', fontSize: '0.8rem', color: '#374151' };
const mutedStyle: React.CSSProperties = { color: '#6b7280', fontSize: '0.875rem' };
const errorStyle: React.CSSProperties = { color: '#dc2626', fontSize: '0.875rem' };
