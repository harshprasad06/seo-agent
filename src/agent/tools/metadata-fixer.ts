/**
 * Metadata Fixer — applies approved title tag / meta description fixes
 * to the learnwealthx Next.js repo by opening a GitHub PR.
 */

import { getFileSha, createPullRequest } from '@/lib/github';

export interface MetadataFixParams {
  filePath: string;
  fixType: 'title_tag' | 'meta_description' | 'keywords' | 'h1_heading';
  currentValue: string;
  proposedValue: string;
  recommendationId: string;
}

export interface MetadataFixResult {
  prUrl: string;
  filePath: string;
  applied: boolean;
}

/**
 * Patches a metadata export in a Next.js page file and opens a PR.
 * Handles both `export const metadata = { ... }` and layout.tsx patterns.
 */
export async function applyMetadataFix(params: MetadataFixParams): Promise<MetadataFixResult> {
  const { filePath, fixType, currentValue, proposedValue, recommendationId } = params;

  // Fetch current file content
  const file = await getFileSha(filePath);
  if (!file) {
    throw new Error(`File not found in repo: ${filePath}`);
  }

  let updatedContent = file.content;

  if (fixType === 'title_tag') {
    // Replace title in metadata export — handles both string and template literal patterns
    updatedContent = updatedContent
      .replace(
        /title:\s*["'`]([^"'`]+)["'`]/,
        `title: "${proposedValue}"`,
      )
      .replace(
        /default:\s*["'`]([^"'`]+)["'`]/,
        `default: "${proposedValue}"`,
      );
  } else if (fixType === 'meta_description') {
    updatedContent = updatedContent.replace(
      /description:\s*["'`]([^"'`]+)["'`]/,
      `description: "${proposedValue}"`,
    );
  } else if (fixType === 'keywords') {
    // Replace keywords array — match across multiple lines
    const kwMatch = updatedContent.match(/keywords:\s*\[[\s\S]*?\]/);
    if (kwMatch) {
      updatedContent = updatedContent.replace(
        kwMatch[0],
        `keywords: [${proposedValue.split(',').map(k => `"${k.trim()}"`).join(', ')}]`,
      );
    }
  } else if (fixType === 'h1_heading') {
    // Replace <h1> tag content in JSX/TSX
    updatedContent = updatedContent.replace(
      /<h1([^>]*)>[\s\S]*?<\/h1>/i,
      `<h1$1>${proposedValue}</h1>`,
    );
  }

  if (updatedContent === file.content) {
    console.warn(`[metadata-fixer] No change detected in ${filePath} for ${fixType}`);
    return { prUrl: '', filePath, applied: false };
  }

  const branchName = `seo-fix/${fixType}-${recommendationId.slice(0, 8)}`;
  const prUrl = await createPullRequest({
    title: `[SEO Fix] Update ${fixType} in ${filePath}`,
    body: `## SEO Metadata Fix\n\n**Type:** ${fixType}\n**File:** \`${filePath}\`\n\n**Before:**\n\`\`\`\n${currentValue}\n\`\`\`\n\n**After:**\n\`\`\`\n${proposedValue}\n\`\`\`\n\nApproved via SEO Agent (recommendation ID: ${recommendationId})`,
    filePath,
    fileContent: updatedContent,
    branchName,
  });

  return { prUrl, filePath, applied: true };
}
