import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

// Tool for parsing GitHub PR URLs and extracting git diff inputs
export const githubPRParserTool = createTool({
  id: 'github-pr-parser',
  description: 'Parses GitHub PR URLs and extracts information needed for git diff tool',
  inputSchema: z.object({
    prUrl: z.string().url().describe('GitHub pull request URL (e.g., https://github.com/owner/repo/pull/123)'),
    includeCommits: z.boolean().default(false).describe('Whether to include individual commit SHAs from the PR'),
    includeDiffUrls: z.boolean().default(false).describe('Whether to include GitHub diff/patch URLs'),
  }),
  execute: async ({ context }) => {
    const { prUrl, includeCommits, includeDiffUrls } = context;
    
    try {
      // Parse the PR URL
      const urlMatch = prUrl.match(/^https:\/\/github\.com\/([^\/]+)\/([^\/]+)\/pull\/(\d+)/);
      if (!urlMatch) {
        throw new Error('Invalid GitHub PR URL format. Expected: https://github.com/owner/repo/pull/123');
      }
      
      const [, owner, repo, prNumber] = urlMatch;
      
      // Use GitHub CLI to fetch PR information
      const { execSync } = await import('child_process');
      
      // Fetch PR details using gh api
      const prCommand = `gh api repos/${owner}/${repo}/pulls/${prNumber}`;
      const prOutput = execSync(prCommand, { encoding: 'utf-8' });
      const prData = JSON.parse(prOutput);
      
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
          headRepository: prData.head.repo ? {
            owner: prData.head.repo.owner.login,
            name: prData.head.repo.name,
            fullName: prData.head.repo.full_name,
            cloneUrl: prData.head.repo.clone_url,
          } : null,
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
          const commitsCommand = `gh api repos/${owner}/${repo}/pulls/${prNumber}/commits`;
          const commitsOutput = execSync(commitsCommand, { encoding: 'utf-8' });
          const commitsData = JSON.parse(commitsOutput);
          
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
    } catch (error) {
      if (error instanceof Error && error.message.includes('404')) {
        throw new Error(`Pull request not found: ${prUrl}. Make sure the PR exists and you have access to it.`);
      }
      throw new Error(`Failed to parse GitHub PR: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
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