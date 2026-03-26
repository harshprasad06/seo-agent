'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import SharedLayout from '../SharedLayout';

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

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft: 'badge-warning',
    approved: 'badge-success',
    rejected: 'badge-danger',
    published: 'badge-info',
  };
  const cls = map[status] ?? 'badge-neutral';
  return <span className={`badge ${cls}`}>{status}</span>;
}

function PostCard({ post, onAction }: { post: Post; onAction: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editTitle, setEditTitle] = useState(post.title);
  const [editContent, setEditContent] = useState('');
  const [rejectNote, setRejectNote] = useState('');

  const fullPost = trpc.content.blogPost.useQuery({ id: post.id }, { enabled: expanded });
  const update = trpc.content.updateBlogPost.useMutation({ onSuccess: () => { setEditMode(false); onAction(); } });
  const approve = trpc.content.approveBlogPost.useMutation({ onSuccess: onAction });
  const reject = trpc.content.rejectBlogPost.useMutation({ onSuccess: onAction });
  const regen = trpc.content.regenerateBlogPost.useMutation({ onSuccess: () => { fullPost.refetch(); onAction(); } });
  const busy = update.isPending || approve.isPending || reject.isPending || regen.isPending;

  function handleExpand() {
    setExpanded(e => !e);
    if (!expanded && fullPost.data) setEditContent(fullPost.data.mdx_content as string);
  }

  return (
    <div className="card" style={{ marginBottom: '0.75rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <StatusBadge status={post.status} />
            <span className="text-muted" style={{ fontSize: '0.8rem' }}>{post.word_count ? `~${post.word_count} words` : ''}</span>
          </div>
          <p style={{ margin: '0.4rem 0 0', fontWeight: 600, fontSize: '1rem', color: 'var(--text-primary)' }}>{post.title}</p>
          <p className="text-muted" style={{ margin: '0.2rem 0 0', fontSize: '0.82rem' }}>keyword: {post.target_keyword}</p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={handleExpand}>
          {expanded ? 'Collapse ▲' : 'Preview ▼'}
        </button>
      </div>

      {post.status === 'draft' && (
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.85rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="btn btn-success btn-sm" onClick={() => approve.mutate({ id: post.id })} disabled={busy}>
            {approve.isPending ? 'Opening PR…' : '✓ Approve & Publish'}
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => { setEditMode(e => !e); if (!expanded) setExpanded(true); }} disabled={busy}>
            ✎ Edit
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => regen.mutate({ id: post.id })} disabled={busy}>
            {regen.isPending ? 'Regenerating…' : '↺ Regenerate'}
          </button>
          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
            <input className="input" placeholder="Reject reason (optional)" value={rejectNote} onChange={e => setRejectNote(e.target.value)} style={{ width: 200, fontSize: '0.8rem', padding: '0.3rem 0.5rem' }} />
            <button className="btn btn-danger btn-sm" onClick={() => reject.mutate({ id: post.id, note: rejectNote })} disabled={busy}>✕ Reject</button>
          </div>
        </div>
      )}

      {post.status === 'approved' && post.pr_url && (
        <div style={{ marginTop: '0.6rem' }}>
          <a href={post.pr_url} target="_blank" rel="noreferrer" style={{ color: 'var(--primary)', fontSize: '0.875rem' }}>View PR on GitHub →</a>
        </div>
      )}

      {post.status === 'rejected' && (
        <div style={{ marginTop: '0.6rem' }}>
          <button className="btn btn-ghost btn-sm" onClick={() => regen.mutate({ id: post.id })} disabled={busy}>
            {regen.isPending ? 'Regenerating…' : '↺ Regenerate'}
          </button>
        </div>
      )}

      {expanded && (
        <div style={{ marginTop: '1rem', borderTop: '1px solid var(--border-primary)', paddingTop: '1rem' }}>
          {fullPost.isLoading && <p className="text-muted">Loading content…</p>}
          {fullPost.data && (
            editMode ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div>
                  <label className="label">Title</label>
                  <input className="input" value={editTitle} onChange={e => setEditTitle(e.target.value)} style={{ width: '100%' }} />
                </div>
                <div>
                  <label className="label">MDX Content</label>
                  <textarea className="input" value={editContent || (fullPost.data.mdx_content as string)} onChange={e => setEditContent(e.target.value)} style={{ width: '100%', height: 400, fontFamily: 'monospace', fontSize: '0.82rem', resize: 'vertical' }} />
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button className="btn btn-primary btn-sm" onClick={() => update.mutate({ id: post.id, title: editTitle, mdxContent: editContent })} disabled={update.isPending}>
                    {update.isPending ? 'Saving…' : 'Save Changes'}
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setEditMode(false)}>Cancel</button>
                </div>
              </div>
            ) : (
              <pre className="pre-block">{fullPost.data.mdx_content as string}</pre>
            )
          )}
        </div>
      )}

      {(approve.error || reject.error || regen.error || update.error) && (
        <p className="text-error" style={{ marginTop: '0.5rem' }}>
          {(approve.error || reject.error || regen.error || update.error)?.message}
        </p>
      )}
    </div>
  );
}

export default function ContentPage() {
  const [count, setCount] = useState(3);
  const posts = trpc.content.blogPosts.useQuery();
  const autoGen = trpc.content.autoGenerate.useMutation({ onSuccess: () => posts.refetch() });

  const drafts = posts.data?.filter((p: Post) => p.status === 'draft') ?? [];
  const approved = posts.data?.filter((p: Post) => p.status === 'approved') ?? [];
  const rejected = posts.data?.filter((p: Post) => p.status === 'rejected') ?? [];

  return (
    <SharedLayout>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div className="page-header" style={{ marginBottom: 0 }}>
          <h1 className="page-title">Blog Posts</h1>
          <p className="page-subtitle">AI-generated SEO blog posts for learnwealthx.in. Approve to open a GitHub PR.</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <select className="select" value={count} onChange={e => setCount(Number(e.target.value))} style={{ width: 'auto' }}>
            {[1, 2, 3, 5].map(n => <option key={n} value={n}>Generate {n}</option>)}
          </select>
          <button className="btn btn-primary" onClick={() => autoGen.mutate({ count })} disabled={autoGen.isPending}>
            {autoGen.isPending ? `Generating ${count} posts…` : '✦ Auto-Generate'}
          </button>
        </div>
      </div>

      {autoGen.error && <p className="text-error">Error: {autoGen.error.message}</p>}
      {autoGen.data && (
        <div className="card" style={{ background: 'var(--success-light)', borderColor: 'var(--success)', marginBottom: '1rem', padding: '0.6rem 1rem' }}>
          <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--success-text)' }}>
            Generated {autoGen.data.generated} new draft{autoGen.data.generated !== 1 ? 's' : ''}
          </p>
        </div>
      )}

      {posts.isLoading && <p className="text-muted">Loading…</p>}

      {drafts.length > 0 && (
        <section className="section">
          <h2 className="section-title">Drafts ({drafts.length})</h2>
          {drafts.map((p: Post) => <PostCard key={p.id} post={p} onAction={() => posts.refetch()} />)}
        </section>
      )}

      {approved.length > 0 && (
        <section className="section">
          <h2 className="section-title">Approved ({approved.length})</h2>
          {approved.map((p: Post) => <PostCard key={p.id} post={p} onAction={() => posts.refetch()} />)}
        </section>
      )}

      {rejected.length > 0 && (
        <section className="section">
          <h2 className="section-title">Rejected ({rejected.length})</h2>
          {rejected.map((p: Post) => <PostCard key={p.id} post={p} onAction={() => posts.refetch()} />)}
        </section>
      )}

      {posts.data?.length === 0 && !posts.isLoading && (
        <div className="empty-state">
          <div className="empty-state-icon">✎</div>
          <p style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>No blog posts yet.</p>
          <p>Click "Auto-Generate" to let the AI create SEO-optimized drafts.</p>
        </div>
      )}
    </SharedLayout>
  );
}
