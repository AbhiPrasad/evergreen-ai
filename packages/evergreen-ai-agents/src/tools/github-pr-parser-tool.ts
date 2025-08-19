import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Octokit } from '@octokit/rest';

// Define schemas for nested objects
const repositorySchema = z.object({
  owner: z.string().describe('Repository owner/organization'),
  name: z.string().describe('Repository name'),
  fullName: z.string().describe('Full repository name (owner/repo)'),
  cloneUrl: z.string().url().describe('HTTPS clone URL'),
  sshUrl: z.string().optional().describe('SSH clone URL'),
});

const gitDiffInputsSchema = z.object({
  base: z.string().describe('Base branch name'),
  compare: z.string().describe('Compare branch name'),
  baseSha: z.string().describe('Base commit SHA'),
  headSha: z.string().describe('Head commit SHA'),
  isCrossRepository: z.boolean().describe('Whether this is a cross-repository PR (fork)'),
  headRepository: repositorySchema.nullable().describe('Head repository info for cross-repo PRs'),
});

const authorSchema = z.object({
  login: z.string().describe('GitHub username'),
  type: z.string().describe('User type (User, Organization, etc.)'),
});

const prStatsSchema = z.object({
  commits: z.number().describe('Number of commits in the PR'),
  additions: z.number().describe('Total lines added'),
  deletions: z.number().describe('Total lines removed'),
  changedFiles: z.number().describe('Number of files changed'),
});

const labelSchema = z.object({
  name: z.string().describe('Label name'),
  color: z.string().describe('Label color (hex)'),
  description: z.string().nullable().describe('Label description'),
});

const commitSchema = z.object({
  sha: z.string().describe('Commit SHA'),
  message: z.string().describe('Commit message'),
  author: z.object({
    name: z.string().describe('Author name'),
    email: z.string().describe('Author email'),
    date: z.string().describe('Commit date'),
  }),
  url: z.string().url().describe('URL to view the commit'),
});

const diffUrlsSchema = z.object({
  html: z.string().url().describe('PR web page URL'),
  diff: z.string().url().describe('Raw diff URL'),
  patch: z.string().url().describe('Patch file URL'),
  commits: z.string().url().describe('Commits page URL'),
  files: z.string().url().describe('Changed files page URL'),
});

const gitCommandsSchema = z.object({
  fetchPR: z.string().describe('Command to fetch PR branch locally'),
  checkoutPR: z.string().describe('Command to checkout PR branch'),
  diffCommand: z.string().describe('Command to diff using git diff tool inputs'),
  addRemote: z.string().optional().describe('Command to add remote for cross-repo PRs'),
  fetchFromFork: z.string().optional().describe('Command to fetch from fork'),
  diffCrossRepo: z.string().optional().describe('Command to diff cross-repo PR'),
});

const gitDiffToolConfigSchema = z.object({
  base: z.string().describe('Base reference for git diff tool'),
  compare: z.string().describe('Compare reference for git diff tool'),
  alternativeConfig: z
    .object({
      base: z.string().describe('Alternative base using SHA'),
      compare: z.string().describe('Alternative compare using SHA'),
    })
    .describe('Alternative config using SHAs for precision'),
});

// Tool for parsing GitHub PR URLs and extracting git diff inputs
export const githubPRParserTool = createTool({
  id: 'github-pr-parser',
  description: 'Parses GitHub PR URLs and extracts information needed for git diff tool using GitHub API',
  inputSchema: z.object({
    prUrl: z.string().url().describe('GitHub pull request URL (e.g., https://github.com/owner/repo/pull/123)'),
    includeCommits: z.boolean().default(false).describe('Whether to include individual commit SHAs from the PR'),
    includeDiffUrls: z.boolean().default(false).describe('Whether to include GitHub diff/patch URLs'),
    githubToken: z.string().optional().describe('GitHub personal access token for authentication (optional for public repos). If not provided, will check GITHUB_TOKEN, GH_TOKEN, or GITHUB_ACCESS_TOKEN environment variables'),
  }),
  outputSchema: z.object({
    prNumber: z.number().describe('Pull request number'),
    title: z.string().describe('PR title'),
    state: z.string().describe('PR state (open, closed, merged)'),
    draft: z.boolean().describe('Whether the PR is a draft'),
    merged: z.boolean().describe('Whether the PR has been merged'),
    mergeable: z.boolean().nullable().describe('Whether the PR is mergeable'),
    created_at: z.string().describe('PR creation timestamp'),
    updated_at: z.string().describe('PR last update timestamp'),
    repository: repositorySchema.describe('Base repository information'),
    gitDiffInputs: gitDiffInputsSchema.describe('Extracted git diff inputs'),
    author: authorSchema.describe('PR author information'),
    stats: prStatsSchema.describe('PR statistics'),
    labels: z.array(labelSchema).describe('PR labels'),
    commits: z.array(commitSchema).optional().describe('Individual commits (if includeCommits=true)'),
    diffUrls: diffUrlsSchema.optional().describe('GitHub diff URLs (if includeDiffUrls=true)'),
    gitCommands: gitCommandsSchema.describe('Helpful git commands for working with the PR'),
    gitDiffToolConfig: gitDiffToolConfigSchema.describe('Ready-to-use config for git diff tool'),
  }),
  execute: async ({ context }) => {
    const { prUrl, includeCommits, includeDiffUrls, githubToken } = context;

    try {
      // Parse the PR URL
      const urlMatch = prUrl.match(/^https:\/\/github\.com\/([^\/]+)\/([^\/]+)\/pull\/(\d+)/);
      if (!urlMatch) {
        throw new Error('Invalid GitHub PR URL format. Expected: https://github.com/owner/repo/pull/123');
      }

      const [, owner, repo, prNumber] = urlMatch;

      // Get auth token from parameter or environment variables
      const authToken = githubToken || 
        process.env.GITHUB_TOKEN || 
        process.env.GH_TOKEN || 
        process.env.GITHUB_ACCESS_TOKEN;

      // Create Octokit instance
      const octokit = new Octokit({
        auth: authToken, // Optional - will work for public repos without token
      });

      // Fetch PR details using GitHub API
      const prResponse = await octokit.rest.pulls.get({
        owner,
        repo,
        pull_number: parseInt(prNumber),
      });
      const prData = prResponse.data;

      // Extract essential information
      const result: any = {
        // Basic PR info
        prNumber: parseInt(prNumber),
        title: prData.title,
        state: prData.state,
        draft: prData.draft,
        merged: prData.merged,
        mergeable: prData.mergeable,
        created_at: prData.created_at,
        updated_at: prData.updated_at,

        // Repository info
        repository: {
          owner,
          name: repo,
          fullName: `${owner}/${repo}`,
          cloneUrl: prData.base.repo.clone_url,
          sshUrl: prData.base.repo.ssh_url,
        },

        // Branch information for git diff
        gitDiffInputs: {
          base: prData.base.ref,
          compare: prData.head.ref,
          baseSha: prData.base.sha,
          headSha: prData.head.sha,
          // Handle cross-repository PRs (forks)
          isCrossRepository: prData.head.repo?.full_name !== prData.base.repo.full_name,
          headRepository: prData.head.repo
            ? {
                owner: prData.head.repo.owner.login,
                name: prData.head.repo.name,
                fullName: prData.head.repo.full_name,
                cloneUrl: prData.head.repo.clone_url,
              }
            : null,
        },

        // PR metadata
        author: {
          login: prData.user.login,
          type: prData.user.type,
        },

        // Stats
        stats: {
          commits: prData.commits,
          additions: prData.additions,
          deletions: prData.deletions,
          changedFiles: prData.changed_files,
        },

        // Labels
        labels: prData.labels.map((label: any) => ({
          name: label.name,
          color: label.color,
          description: label.description,
        })),
      };

      // Include commits if requested
      if (includeCommits) {
        try {
          const commitsResponse = await octokit.rest.pulls.listCommits({
            owner,
            repo,
            pull_number: parseInt(prNumber),
          });
          const commitsData = commitsResponse.data;

          result.commits = commitsData.map((commit: any) => ({
            sha: commit.sha,
            message: commit.commit.message,
            author: {
              name: commit.commit.author.name,
              email: commit.commit.author.email,
              date: commit.commit.author.date,
            },
            url: commit.html_url,
          }));
        } catch (err) {
          // If commits fetch fails, continue without them
          console.warn('Failed to fetch commits:', err);
        }
      }

      // Include diff URLs if requested
      if (includeDiffUrls) {
        result.diffUrls = {
          html: prData.html_url,
          diff: prData.diff_url,
          patch: prData.patch_url,
          commits: `${prData.html_url}/commits`,
          files: `${prData.html_url}/files`,
        };
      }

      // Add convenience properties for git operations
      result.gitCommands = {
        // Command to fetch PR branch locally
        fetchPR: `git fetch origin pull/${prNumber}/head:pr-${prNumber}`,
        // Command to checkout PR branch
        checkoutPR: `git checkout pr-${prNumber}`,
        // Command to diff using the git diff tool inputs
        diffCommand: `git diff ${prData.base.ref}...${prData.head.ref}`,
        // For cross-repo PRs
        ...(result.gitDiffInputs.isCrossRepository && {
          addRemote: `git remote add ${prData.head.repo.owner.login} ${prData.head.repo.clone_url}`,
          fetchFromFork: `git fetch ${prData.head.repo.owner.login} ${prData.head.ref}`,
          diffCrossRepo: `git diff ${prData.base.ref}...${prData.head.repo.owner.login}/${prData.head.ref}`,
        }),
      };

      // Add a ready-to-use configuration for the git diff tool
      result.gitDiffToolConfig = {
        base: prData.base.ref,
        compare: result.gitDiffInputs.isCrossRepository
          ? `${prData.head.repo.owner.login}/${prData.head.ref}`
          : prData.head.ref,
        // Use SHAs for more precise comparison
        alternativeConfig: {
          base: prData.base.sha,
          compare: prData.head.sha,
        },
      };

      return result;
    } catch (error: any) {
      if (error?.status === 404 || (error instanceof Error && error.message.includes('404'))) {
        throw new Error(`Pull request not found: ${prUrl}. Make sure the PR exists and you have access to it.`);
      }
      throw new Error(`Failed to parse GitHub PR: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },
});

// Helper function to validate GitHub PR URL
export function isValidGitHubPRUrl(url: string): boolean {
  return /^https:\/\/github\.com\/[^\/]+\/[^\/]+\/pull\/\d+/.test(url);
}

// Helper function to extract PR components from URL
export function parseGitHubPRUrl(url: string): { owner: string; repo: string; prNumber: number } | null {
  const match = url.match(/^https:\/\/github\.com\/([^\/]+)\/([^\/]+)\/pull\/(\d+)/);
  if (!match) return null;

  return {
    owner: match[1],
    repo: match[2],
    prNumber: parseInt(match[3]),
  };
}
