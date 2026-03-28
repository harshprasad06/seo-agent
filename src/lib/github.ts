/**
 * GitHub API client for reading and writing files to the learnwealthx repo.
 * Used by the SEO agent to apply on-page fixes and publish blog posts via PRs.
 */

const GITHUB_API = 'https://api.github.com';

function headers() {
  const pat = process.env.GITHUB_PAT;
  if (!pat) throw new Error('GITHUB_PAT environment variable is not set');
  return {
    Authorization: `token ${pat}`,
    'Content-Type': 'application/json',
    Accept: 'application/vnd.github.v3+json',
  };
}

function repoBase() {
  const owner = process.env.GITHUB_REPO_OWNER;
  const repo = process.env.GITHUB_REPO_NAME;
  if (!owner || !repo) throw new Error('GITHUB_REPO_OWNER and GITHUB_REPO_NAME must be set');
  return `${GITHUB_API}/repos/${owner}/${repo}`;
}

const defaultBranch = () => process.env.GITHUB_DEFAULT_BRANCH ?? 'main';

/** Get the SHA of a file (needed for updates) */
export async function getFileSha(path: string): Promise<{ sha: string; content: string } | null> {
  const res = await fetch(`${repoBase()}/contents/${path}?ref=${defaultBranch()}`, {
    headers: headers(),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub getFileSha failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return {
    sha: data.sha,
    content: Buffer.from(data.content, 'base64').toString('utf-8'),
  };
}

/** Commit a file directly to the default branch (no PR) */
export async function commitDirectly(params: {
  filePath: string;
  fileContent: string;
  commitMessage: string;
}): Promise<string> {
  const { filePath, fileContent, commitMessage } = params;
  const base = repoBase();
  const branch = defaultBranch();

  // Get existing file SHA if it exists (needed for update vs create)
  const existing = await getFileSha(filePath);

  const body: Record<string, unknown> = {
    message: commitMessage,
    content: Buffer.from(fileContent).toString('base64'),
    branch,
  };
  if (existing) body.sha = existing.sha;

  const res = await fetch(`${base}/contents/${filePath}`, {
    method: 'PUT',
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Failed to commit file: ${await res.text()}`);
  const data = await res.json();
  return data.content?.html_url ?? `https://github.com/${process.env.GITHUB_REPO_OWNER}/${process.env.GITHUB_REPO_NAME}/blob/${branch}/${filePath}`;
}
export async function createPullRequest(params: {
  title: string;
  body: string;
  filePath: string;
  fileContent: string;
  branchName: string;
}): Promise<string> {
  const { title, body, filePath, fileContent, branchName } = params;
  const base = repoBase();
  const branch = defaultBranch();

  // 1. Get base branch SHA
  const refRes = await fetch(`${base}/git/ref/heads/${branch}`, { headers: headers() });
  if (!refRes.ok) throw new Error(`Failed to get base branch ref: ${await refRes.text()}`);
  const refData = await refRes.json();
  const baseSha = refData.object.sha;

  // 2. Create new branch
  const createBranchRes = await fetch(`${base}/git/refs`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: baseSha }),
  });
  if (!createBranchRes.ok) {
    const err = await createBranchRes.text();
    // Branch may already exist — that's ok
    if (!err.includes('already exists')) throw new Error(`Failed to create branch: ${err}`);
  }

  // 3. Get existing file SHA if it exists (needed for update)
  const existing = await getFileSha(filePath);

  // 4. Create or update the file on the new branch
  const fileBody: Record<string, unknown> = {
    message: title,
    content: Buffer.from(fileContent).toString('base64'),
    branch: branchName,
  };
  if (existing) fileBody.sha = existing.sha;

  const fileRes = await fetch(`${base}/contents/${filePath}`, {
    method: 'PUT',
    headers: headers(),
    body: JSON.stringify(fileBody),
  });
  if (!fileRes.ok) throw new Error(`Failed to write file: ${await fileRes.text()}`);

  // 5. Open PR
  const prRes = await fetch(`${base}/pulls`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ title, body, head: branchName, base: branch }),
  });
  if (!prRes.ok) throw new Error(`Failed to create PR: ${await prRes.text()}`);
  const prData = await prRes.json();
  return prData.html_url as string;
}
