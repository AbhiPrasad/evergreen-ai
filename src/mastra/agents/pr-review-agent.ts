import { anthropic } from '@ai-sdk/anthropic';
import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { LibSQLStore } from '@mastra/libsql';
import { 
  getPullRequestWithPATTool, 
  createPullRequestReviewWithPATTool, 
  listRepositoryPullRequestsWithPATTool 
} from '../tools/github-pat-tool';

export const prReviewAgent = new Agent({
  name: 'PR Review Agent',
  description: 'An AI agent that reviews GitHub pull requests for code quality, security, and best practices',
  instructions: `
    You are an expert code reviewer with extensive knowledge of software engineering best practices, security vulnerabilities, and code quality standards.

    Your role is to:
    1. **Analyze pull requests thoroughly** - Review the changes, understand the context, and identify potential issues
    2. **Provide constructive feedback** - Focus on actionable suggestions rather than nitpicking
    3. **Check for common issues**:
       - Security vulnerabilities (SQL injection, XSS, authentication flaws, etc.)
       - Performance problems (inefficient queries, memory leaks, etc.)
       - Code style and maintainability issues
       - Missing error handling
       - Lack of proper testing
       - Documentation gaps
       - Breaking changes without proper migration
    4. **Be supportive and educational** - Explain why changes are needed and suggest improvements
    5. **Consider the bigger picture** - Look at architectural decisions and overall code health

    When reviewing:
    - Start by understanding what the PR is trying to accomplish
    - Look at each file and understand the changes in context
    - Check for patterns across multiple files
    - Consider backward compatibility and breaking changes
    - Suggest specific improvements with code examples when helpful
    - Approve when code meets standards, request changes when serious issues exist, or comment for minor suggestions

    Always be professional, helpful, and constructive in your feedback.
  `,
  model: anthropic('claude-3-5-sonnet-20241022'),
  tools: { 
    getPullRequestWithPATTool, 
    createPullRequestReviewWithPATTool, 
    listRepositoryPullRequestsWithPATTool 
  },
  memory: new Memory({
    storage: new LibSQLStore({
      url: 'file:../pr-reviews.db',
    }),
  }),
});

// Helper function to review a specific PR
export async function reviewPullRequest(
  owner: string, 
  repo: string, 
  pullNumber: number,
  reviewContext?: string
) {
  const contextPrompt = reviewContext 
    ? `Context: ${reviewContext}\n\n` 
    : '';

  return await prReviewAgent.generate(
    `${contextPrompt}Please review pull request #${pullNumber} in ${owner}/${repo}. 
    
    Follow these steps:
    1. First, fetch the PR details to understand what changes are being made
    2. Analyze the code changes for:
       - Security vulnerabilities
       - Performance issues
       - Code quality and maintainability
       - Best practices adherence
       - Testing coverage
       - Documentation needs
    3. Provide a comprehensive review with specific feedback
    4. Submit your review with appropriate approval/request changes/comment status
    
    Be thorough but focus on the most important issues that affect code quality, security, and maintainability.`
  );
}

// Helper function to review multiple PRs in a repository
export async function reviewRepositoryPRs(
  owner: string, 
  repo: string, 
  options?: {
    state?: 'open' | 'closed' | 'all';
    maxPRs?: number;
    priority?: 'newest' | 'oldest' | 'most-changed';
  }
) {
  const state = options?.state || 'open';
  const maxPRs = options?.maxPRs || 5;
  
  return await prReviewAgent.generate(
    `Please review the ${state} pull requests in ${owner}/${repo}. 
    
    Steps:
    1. List the pull requests in the repository
    2. Review up to ${maxPRs} PRs, prioritizing based on:
       - Size and complexity of changes
       - How long they've been open
       - Whether they affect critical code paths
    3. For each PR you review, provide constructive feedback
    4. Summarize your findings across all reviewed PRs
    
    Focus on helping the development team maintain code quality and catch potential issues early.`
  );
}
