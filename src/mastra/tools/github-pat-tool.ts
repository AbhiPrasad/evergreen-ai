import { createTool } from "@mastra/core/tools";
import { z } from "zod";

// Simple GitHub API client using Personal Access Token
class GitHubAPIClient {
  private token: string;
  private baseURL = 'https://api.github.com';

  constructor(token: string) {
    this.token = token;
  }

  private async request(endpoint: string, options: RequestInit = {}) {
    const response = await fetch(`${this.baseURL}${endpoint}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Accept': 'application/vnd.github.v3+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...options.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  async getPullRequest(owner: string, repo: string, pullNumber: number) {
    return this.request(`/repos/${owner}/${repo}/pulls/${pullNumber}`);
  }

  async getPullRequestFiles(owner: string, repo: string, pullNumber: number) {
    return this.request(`/repos/${owner}/${repo}/pulls/${pullNumber}/files`);
  }

  async getPullRequestDiff(owner: string, repo: string, pullNumber: number) {
    const response = await fetch(`${this.baseURL}/repos/${owner}/${repo}/pulls/${pullNumber}`, {
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Accept': 'application/vnd.github.v3.diff',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    return response.text();
  }

  async createPullRequestReview(
    owner: string, 
    repo: string, 
    pullNumber: number, 
    body: string, 
    event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT',
    comments?: Array<{ path: string; line: number; body: string }>
  ) {
    return this.request(`/repos/${owner}/${repo}/pulls/${pullNumber}/reviews`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        body,
        event,
        comments,
      }),
    });
  }

  async listPullRequests(
    owner: string, 
    repo: string, 
    state: 'open' | 'closed' | 'all' = 'open',
    sort: 'created' | 'updated' | 'popularity' | 'long-running' = 'created',
    direction: 'asc' | 'desc' = 'desc'
  ) {
    return this.request(`/repos/${owner}/${repo}/pulls?state=${state}&sort=${sort}&direction=${direction}`);
  }
}

// Initialize GitHub client
const githubClient = new GitHubAPIClient(process.env.GITHUB_PERSONAL_ACCESS_TOKEN!);

export const getPullRequestWithPATTool = createTool({
  id: "get-pull-request-pat",
  description: "Fetches pull request details using Personal Access Token",
  inputSchema: z.object({
    owner: z.string().describe("Repository owner"),
    repo: z.string().describe("Repository name"),
    pullNumber: z.number().describe("Pull request number"),
  }),
  execute: async ({ context }) => {
    const { owner, repo, pullNumber } = context;
    
    try {
      // Get PR details, files, and diff in parallel
      const [pr, files, diff] = await Promise.all([
        githubClient.getPullRequest(owner, repo, pullNumber),
        githubClient.getPullRequestFiles(owner, repo, pullNumber),
        githubClient.getPullRequestDiff(owner, repo, pullNumber),
      ]);

      return {
        pr: {
          title: pr.title,
          description: pr.body,
          author: pr.user?.login,
          createdAt: pr.created_at,
          updatedAt: pr.updated_at,
          state: pr.state,
          mergeable: pr.mergeable,
          additions: pr.additions,
          deletions: pr.deletions,
          changedFiles: pr.changed_files,
          url: pr.html_url,
        },
        files: files.map((file: any) => ({
          filename: file.filename,
          status: file.status,
          additions: file.additions,
          deletions: file.deletions,
          changes: file.changes,
          patch: file.patch,
        })),
        diff,
      };
    } catch (error) {
      throw new Error(`Failed to fetch PR: ${error}`);
    }
  },
});

export const createPullRequestReviewWithPATTool = createTool({
  id: "create-pr-review-pat",
  description: "Creates a review on a pull request using Personal Access Token",
  inputSchema: z.object({
    owner: z.string().describe("Repository owner"),
    repo: z.string().describe("Repository name"),
    pullNumber: z.number().describe("Pull request number"),
    body: z.string().describe("Overall review comment"),
    event: z.enum(["APPROVE", "REQUEST_CHANGES", "COMMENT"]).describe("Review action"),
    comments: z.array(z.object({
      path: z.string().describe("File path"),
      line: z.number().describe("Line number"), 
      body: z.string().describe("Comment text"),
    })).optional().describe("Line-specific comments"),
  }),
  execute: async ({ context }) => {
    const { owner, repo, pullNumber, body, event, comments } = context;
    
    try {
      const review = await githubClient.createPullRequestReview(
        owner, 
        repo, 
        pullNumber, 
        body, 
        event, 
        comments
      );

      return {
        reviewId: review.id,
        state: review.state,
        submittedAt: review.submitted_at,
        body: review.body,
        url: review.html_url,
      };
    } catch (error) {
      throw new Error(`Failed to create review: ${error}`);
    }
  },
});

export const listRepositoryPullRequestsWithPATTool = createTool({
  id: "list-repository-pulls-pat",
  description: "Lists pull requests in a repository using Personal Access Token",
  inputSchema: z.object({
    owner: z.string().describe("Repository owner"),
    repo: z.string().describe("Repository name"),
    state: z.enum(["open", "closed", "all"]).default("open").describe("PR state filter"),
    sort: z.enum(["created", "updated", "popularity", "long-running"]).default("created").describe("Sort by"),
    direction: z.enum(["asc", "desc"]).default("desc").describe("Sort direction"),
  }),
  execute: async ({ context }) => {
    const { owner, repo, state, sort, direction } = context;
    
    try {
      const pulls = await githubClient.listPullRequests(owner, repo, state, sort, direction);

      return pulls.map((pr: any) => ({
        number: pr.number,
        title: pr.title,
        author: pr.user?.login,
        state: pr.state,
        createdAt: pr.created_at,
        updatedAt: pr.updated_at,
        mergeable: pr.mergeable,
        draft: pr.draft,
        url: pr.html_url,
      }));
    } catch (error) {
      throw new Error(`Failed to list PRs: ${error}`);
    }
  },
});
