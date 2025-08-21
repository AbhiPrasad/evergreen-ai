import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Octokit } from '@octokit/rest';

// Define the schema for commit info
const commitInfoSchema = z.object({
  hash: z.string().describe('Full commit SHA'),
  subject: z.string().describe('Commit message subject line'),
  author: z.string().describe('Commit author name'),
  date: z.string().describe('Commit date'),
});

// Define the schema for file changes
const fileChangeSchema = z.object({
  path: z.string().describe('File path'),
  status: z.enum(['added', 'modified', 'deleted', 'renamed']).describe('Change status'),
  insertions: z.number().optional().describe('Number of lines added'),
  deletions: z.number().optional().describe('Number of lines removed'),
});

export type FileChange = z.infer<typeof fileChangeSchema>;

// Define the schema for diff statistics
const diffStatsSchema = z.object({
  filesChanged: z.number().describe('Total number of files changed'),
  insertions: z.number().describe('Total lines added across all files'),
  deletions: z.number().describe('Total lines removed across all files'),
  files: z.array(fileChangeSchema).describe('Individual file changes'),
});

export type DiffStats = z.infer<typeof diffStatsSchema>;

// Helper function to parse GitHub repository URL
function parseGitHubRepoUrl(url: string): { owner: string; repo: string } | null {
  // Support multiple GitHub URL formats
  const patterns = [
    /^https:\/\/github\.com\/([^\/]+)\/([^\/]+?)(?:\.git)?(?:\/.*)?$/,
    /^git@github\.com:([^\/]+)\/([^\/]+?)(?:\.git)?$/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return {
        owner: match[1],
        repo: match[2],
      };
    }
  }
  return null;
}

// Helper function to validate GitHub repository URL
function isValidGitHubRepoUrl(url: string): boolean {
  return parseGitHubRepoUrl(url) !== null;
}

// Tool for generating git diffs from GitHub repositories
export const gitDiffTool = createTool({
  id: 'git-diff',
  description: 'Generates git diff from GitHub repositories using the GitHub API to compare branches or commits',
  inputSchema: z.object({
    repositoryUrl: z
      .string()
      .describe('GitHub repository URL (e.g., https://github.com/owner/repo or git@github.com:owner/repo.git)'),
    base: z.string().describe('Base branch/commit to compare from (e.g., main, commit SHA)'),
    compare: z.string().describe('Branch/commit to compare to (e.g., feature-branch, commit SHA)'),
    githubToken: z
      .string()
      .optional()
      .describe(
        'GitHub personal access token for authentication (optional for public repos). If not provided, will check GITHUB_TOKEN, GH_TOKEN, or GITHUB_ACCESS_TOKEN environment variables',
      ),
  }),
  outputSchema: z.object({
    diff: z.string().describe('Raw git diff output'),
    stats: diffStatsSchema.describe('Parsed diff statistics'),
    repository: z.string().describe('GitHub repository URL used for the diff'),
    base: z.string().describe('Base reference (branch/commit) used'),
    compare: z.string().describe('Compare reference (branch/commit) used'),
    commitInfo: z
      .object({
        base: commitInfoSchema.optional(),
        compare: commitInfoSchema.optional(),
      })
      .describe('Commit information for base and compare references'),
    apiUrl: z.string().describe('GitHub API URL that was used to fetch the diff'),
    behindBy: z.number().optional().describe('Number of commits base is behind compare'),
    aheadBy: z.number().optional().describe('Number of commits base is ahead of compare'),
  }),
  execute: async ({ context }) => {
    const { repositoryUrl, base, compare, githubToken } = context;

    try {
      // Validate GitHub repository URL
      if (!isValidGitHubRepoUrl(repositoryUrl)) {
        throw new Error(
          `Invalid GitHub repository URL: "${repositoryUrl}". Expected format: https://github.com/owner/repo or git@github.com:owner/repo.git`,
        );
      }

      // Parse repository URL to get owner and repo
      const repoInfo = parseGitHubRepoUrl(repositoryUrl);
      if (!repoInfo) {
        throw new Error(`Failed to parse GitHub repository URL: ${repositoryUrl}`);
      }

      const { owner, repo } = repoInfo;

      // Get auth token from parameter or environment variables
      const authToken =
        githubToken || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_ACCESS_TOKEN;

      // Create Octokit instance
      const octokit = new Octokit({
        auth: authToken,
      });

      // Use GitHub's compare API to get the diff
      const compareResponse = await octokit.rest.repos.compareCommits({
        owner,
        repo,
        base,
        head: compare,
      });

      const compareData = compareResponse.data;

      // Fetch commit details for base and compare
      const commitInfo: any = {};

      try {
        // Get base commit info
        const baseCommitResponse = await octokit.rest.repos.getCommit({
          owner,
          repo,
          ref: base,
        });
        const baseCommit = baseCommitResponse.data;
        commitInfo.base = {
          hash: baseCommit.sha,
          subject: baseCommit.commit.message.split('\n')[0],
          author: baseCommit.commit.author?.name || 'Unknown',
          date: baseCommit.commit.author?.date || '',
        };

        // Get compare commit info
        const compareCommitResponse = await octokit.rest.repos.getCommit({
          owner,
          repo,
          ref: compare,
        });
        const compareCommit = compareCommitResponse.data;
        commitInfo.compare = {
          hash: compareCommit.sha,
          subject: compareCommit.commit.message.split('\n')[0],
          author: compareCommit.commit.author?.name || 'Unknown',
          date: compareCommit.commit.author?.date || '',
        };
      } catch (err) {
        // Continue without commit info if fetch fails
        console.warn('Failed to fetch commit details:', err);
      }

      // Generate unified diff from GitHub API data
      const diffOutput = generateUnifiedDiff(compareData);

      // Parse the diff statistics
      const diffStats = parseGitHubDiffStats(compareData);

      // Build the API URL for reference
      const apiUrl = `https://api.github.com/repos/${owner}/${repo}/compare/${base}...${compare}`;

      return {
        diff: diffOutput,
        stats: diffStats,
        repository: repositoryUrl,
        base,
        compare,
        commitInfo,
        apiUrl,
        behindBy: compareData.behind_by,
        aheadBy: compareData.ahead_by,
      };
    } catch (error: any) {
      if (error?.status === 404 || (error instanceof Error && error.message.includes('404'))) {
        throw new Error(
          `Repository, branch, or commit not found. Please check that the repository URL is correct and the base/compare references exist. If this is a private repository, ensure you have proper authentication.`,
        );
      }
      throw new Error(`Failed to generate git diff: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },
});

// Helper function to generate unified diff from GitHub API compare data
function generateUnifiedDiff(compareData: any): string {
  const diffParts: string[] = [];

  // Add header information
  diffParts.push(`diff --git from ${compareData.base_commit.sha} to ${compareData.head_commit.sha}`);
  diffParts.push(`Comparing ${compareData.total_commits} commits`);
  diffParts.push('');

  // Process each file in the comparison
  for (const file of compareData.files || []) {
    // Add file header
    diffParts.push(`diff --git a/${file.filename} b/${file.filename}`);

    if (file.status === 'added') {
      diffParts.push('new file mode 100644');
      diffParts.push(`index 0000000..${file.sha?.substring(0, 7) || 'unknown'}`);
      diffParts.push(`--- /dev/null`);
      diffParts.push(`+++ b/${file.filename}`);
    } else if (file.status === 'removed') {
      diffParts.push('deleted file mode 100644');
      diffParts.push(`index ${file.sha?.substring(0, 7) || 'unknown'}..0000000`);
      diffParts.push(`--- a/${file.filename}`);
      diffParts.push(`+++ /dev/null`);
    } else if (file.status === 'renamed') {
      diffParts.push(`similarity index ${file.similarity || 100}%`);
      diffParts.push(`rename from ${file.previous_filename || file.filename}`);
      diffParts.push(`rename to ${file.filename}`);
    } else {
      diffParts.push(
        `index ${file.sha?.substring(0, 7) || 'unknown'}..${file.sha?.substring(0, 7) || 'unknown'} 100644`,
      );
      diffParts.push(`--- a/${file.filename}`);
      diffParts.push(`+++ b/${file.filename}`);
    }

    // Add patch content if available
    if (file.patch) {
      diffParts.push(file.patch);
    } else {
      diffParts.push(`@@ -0,0 +0,0 @@ File changed: +${file.additions || 0} -${file.deletions || 0}`);
    }

    diffParts.push(''); // Empty line between files
  }

  return diffParts.join('\n');
}

// Helper function to parse GitHub API diff statistics
function parseGitHubDiffStats(compareData: any): DiffStats {
  const stats: DiffStats = {
    filesChanged: compareData.files?.length || 0,
    insertions: 0,
    deletions: 0,
    files: [],
  };

  // Process files from GitHub API response
  for (const file of compareData.files || []) {
    stats.insertions += file.additions || 0;
    stats.deletions += file.deletions || 0;

    let status: FileChange['status'] = 'modified';
    switch (file.status) {
      case 'added':
        status = 'added';
        break;
      case 'removed':
        status = 'deleted';
        break;
      case 'modified':
        status = 'modified';
        break;
      case 'renamed':
        status = 'renamed';
        break;
      default:
        status = 'modified';
    }

    stats.files.push({
      path: file.filename,
      status,
      insertions: file.additions || 0,
      deletions: file.deletions || 0,
    });
  }

  return stats;
}
