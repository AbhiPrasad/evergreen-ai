# Git Diff Tools and Agent

This document describes the Git Diff Tool, GitHub PR Parser Tool, and Git Diff Summary Agent added to the Mastra
framework.

## Type Safety with Output Schemas

All tools now include comprehensive output schemas using Zod, providing:

- **Full TypeScript Support**: Strongly-typed outputs with exported types
- **IDE Autocomplete**: IntelliSense for all properties and nested objects
- **Runtime Validation**: Ensures output conforms to expected structure
- **Better Documentation**: Schema descriptions explain each field
- **Error Prevention**: Catch type mismatches at compile time
- **Confident Coding**: Know exactly what data you're working with

Example:

```typescript
import { gitDiffTool, type GitDiffOutput } from '@mastra/tools/git-diff-tool';

const result: GitDiffOutput = await gitDiffTool.execute({ context: { base: 'main' } });
// TypeScript knows all properties: result.stats.filesChanged, result.commitInfo.base, etc.
```

## Git Diff Tool

The `gitDiffTool` is a powerful tool for generating git diffs with various options and formats, now with full TypeScript
support through output schemas.

### Features

- Generate diffs between branches, commits, or working directory
- Multiple output formats: unified diff, name-only, name-status, stat
- Filter by specific files or directories
- Configurable context lines
- Exclude patterns support
- Detailed statistics parsing

### Usage

```typescript
import { gitDiffTool } from '@mastra/tools/git-diff-tool';

// Basic diff between branches
const result = await gitDiffTool.execute({
  context: {
    repository: '.',
    base: 'main',
    compare: 'feature-branch',
    diffType: 'unified',
  },
});

// Get only file names that changed
const files = await gitDiffTool.execute({
  context: {
    base: 'HEAD~5',
    compare: 'HEAD',
    diffType: 'name-only',
  },
});

// Get diff statistics
const stats = await gitDiffTool.execute({
  context: {
    base: 'v1.0.0',
    compare: 'v2.0.0',
    diffType: 'stat',
  },
});

// Diff specific file with more context
const fileDiff = await gitDiffTool.execute({
  context: {
    base: 'main',
    filePath: 'src/api/endpoints.ts',
    includeContext: 10,
  },
});
```

### Parameters

- `repository` (optional): Path to git repository (default: current directory)
- `base` (optional): Base branch/commit to compare from
- `compare` (optional): Branch/commit to compare to
- `filePath` (optional): Specific file or directory to diff
- `includeContext` (optional): Number of context lines (default: 3)
- `diffType` (optional): Output format - 'unified', 'name-only', 'name-status', 'stat' (default: 'unified')
- `excludePatterns` (optional): Array of patterns to exclude from diff

### Output Schema

The tool provides strongly-typed output with full TypeScript support:

```typescript
import { type GitDiffOutput, type DiffStats, type FileChange } from '@mastra/tools/git-diff-tool';

// Main output type
type GitDiffOutput = {
  diff: string; // Raw git diff output
  stats: DiffStats; // Parsed diff statistics
  repository: string; // Repository path used
  base: string; // Base reference
  compare: string; // Compare reference
  currentBranch: string; // Current git branch
  commitInfo: {
    // Commit information
    base?: CommitInfo;
    compare?: CommitInfo;
  };
  diffType: 'unified' | 'name-only' | 'name-status' | 'stat';
  command: string; // Executed git command
};

// Diff statistics
type DiffStats = {
  filesChanged: number; // Total files changed
  insertions: number; // Total lines added
  deletions: number; // Total lines removed
  files: FileChange[]; // Individual file changes
};

// File change details
type FileChange = {
  path: string; // File path
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  insertions?: number; // Lines added in this file
  deletions?: number; // Lines removed in this file
};
```

## GitHub PR Parser Tool

The `githubPRParserTool` extracts git diff inputs from GitHub pull request URLs, making it easy to analyze PRs with full
type safety.

### Features

- Parse GitHub PR URLs and validate format
- Extract base and compare branch information
- Handle cross-repository PRs (forks)
- Fetch commit history
- Provide ready-to-use git commands
- Generate git diff tool configurations
- Include PR metadata (labels, stats, author)

### Usage

```typescript
import { githubPRParserTool } from '@mastra/tools/github-pr-parser-tool';

// Basic usage
const prInfo = await githubPRParserTool.execute({
  context: {
    prUrl: 'https://github.com/facebook/react/pull/12345',
    includeCommits: false,
    includeDiffUrls: false,
  },
});

// Get ready-to-use git diff configuration
console.log(prInfo.gitDiffToolConfig);
// Output: { base: 'main', compare: 'feature-branch' }

// With commits and diff URLs
const detailedInfo = await githubPRParserTool.execute({
  context: {
    prUrl: 'https://github.com/owner/repo/pull/123',
    includeCommits: true,
    includeDiffUrls: true,
  },
});
```

### Parameters

- `prUrl` (required): GitHub pull request URL (format: `https://github.com/owner/repo/pull/123`)
- `includeCommits` (optional): Whether to fetch individual commits from the PR (default: false)
- `includeDiffUrls` (optional): Whether to include GitHub diff/patch URLs (default: false)

### Output Schema

The tool provides comprehensive, strongly-typed PR information:

```typescript
import { type GitHubPROutput, type GitDiffInputs, type PRStats } from '@mastra/tools/github-pr-parser-tool';

// Main output type
type GitHubPROutput = {
  prNumber: number; // Pull request number
  title: string; // PR title
  state: string; // PR state (open, closed, merged)
  draft: boolean; // Whether PR is a draft
  merged: boolean; // Whether PR has been merged
  mergeable: boolean | null; // Whether PR is mergeable
  created_at: string; // Creation timestamp
  updated_at: string; // Last update timestamp
  repository: Repository; // Base repository info
  gitDiffInputs: GitDiffInputs; // Extracted git diff inputs
  author: Author; // PR author info
  stats: PRStats; // PR statistics
  labels: Label[]; // PR labels
  commits?: PRCommit[]; // Commits (if requested)
  diffUrls?: DiffUrls; // GitHub URLs (if requested)
  gitCommands: GitCommands; // Helpful git commands
  gitDiffToolConfig: GitDiffToolConfig; // Ready-to-use config
};

// Git diff inputs for the PR
type GitDiffInputs = {
  base: string; // Base branch name
  compare: string; // Compare branch name
  baseSha: string; // Base commit SHA
  headSha: string; // Head commit SHA
  isCrossRepository: boolean; // Is this a fork PR?
  headRepository: Repository | null; // Head repo for forks
};

// PR statistics
type PRStats = {
  commits: number; // Number of commits
  additions: number; // Lines added
  deletions: number; // Lines removed
  changedFiles: number; // Files changed
};
```

The output includes all the information needed to analyze a PR, with type safety ensuring you can access all properties
confidently.

### Integration with Git Diff Tool

The GitHub PR Parser seamlessly integrates with the Git Diff Tool:

```typescript
// Step 1: Parse PR
const prInfo = await githubPRParserTool.execute({
  context: { prUrl: 'https://github.com/owner/repo/pull/123' },
});

// Step 2: Use with git diff tool
const diff = await gitDiffTool.execute({
  context: {
    repository: './local-repo-path',
    ...prInfo.gitDiffToolConfig, // Spreads base and compare
  },
});
```

### Requirements

- GitHub CLI (`gh`) must be installed and authenticated
- Install: `brew install gh` (macOS) or see https://cli.github.com/
- Authenticate: `gh auth login`

## Git Diff Summary Agent

The `gitDiffSummaryAgent` is an AI-powered agent that analyzes git diffs and provides comprehensive summaries.

### Features

- Intelligent categorization of changes (features, refactoring, bug fixes, etc.)
- Executive summaries with impact assessment
- File-by-file analysis with relationship explanations
- Code quality observations and recommendations
- Security and breaking change detection
- Constructive feedback and improvement suggestions

### Usage

```typescript
import { gitDiffSummaryAgent } from '@mastra/agents/git-diff-summary-agent';

// Basic usage
const summary = await gitDiffSummaryAgent.generateText({
  prompt: 'Analyze the git diff between main and feature-branch',
  messages: [],
});

// Focused analysis
const securityReview = await gitDiffSummaryAgent.generateText({
  prompt: `Review the git diff for the last 10 commits and identify:
           1. Any security vulnerabilities introduced
           2. Breaking API changes
           3. Performance impacts`,
  messages: [],
});

// PR review preparation
const prReview = await gitDiffSummaryAgent.generateText({
  prompt: `Prepare a comprehensive pull request review for the changes 
           between main and feature/new-api. Include recommendations 
           for testing and potential improvements.`,
  messages: [],
});
```

### Output Structure

The agent provides structured analysis including:

1. **Executive Summary**
   - Brief overview of changes
   - Impact assessment
   - Key metrics

2. **Change Categories**
   - Features
   - Refactoring
   - Bug fixes
   - Documentation
   - Dependencies
   - Configuration
   - Tests
   - Performance
   - Security

3. **File-by-File Analysis**
   - Grouped related files
   - Purpose of changes
   - Architectural impacts

4. **Code Quality Observations**
   - Potential issues
   - Good practices
   - Breaking changes
   - Security considerations

5. **Recommendations**
   - Testing suggestions
   - Improvement opportunities
   - Missing changes

## Integration with Mastra

Both the tool and agent are integrated into the Mastra framework:

```typescript
import { mastra } from '@evergreen-ai/mastra';

// Access through Mastra instance
const gitDiff = mastra.tools.gitDiff;
const diffSummaryAgent = mastra.agents.gitDiffSummaryAgent;
```

## Use Cases

1. **Code Review Automation**: Generate comprehensive PR reviews
2. **Release Notes**: Summarize changes between versions
3. **Security Audits**: Identify security-sensitive changes
4. **Impact Analysis**: Understand the scope of changes
5. **Documentation**: Auto-generate change documentation
6. **CI/CD Integration**: Automated diff analysis in pipelines

## Complete Workflow Example

Here's how to combine all three tools for comprehensive PR analysis:

```typescript
import { githubPRParserTool, gitDiffTool, gitDiffSummaryAgent } from '@mastra/tools';

async function analyzePullRequest(prUrl: string, localRepoPath: string) {
  // 1. Parse GitHub PR
  const prInfo = await githubPRParserTool.execute({
    context: {
      prUrl,
      includeCommits: true,
    },
  });

  console.log(`Analyzing PR #${prInfo.prNumber}: ${prInfo.title}`);

  // 2. Generate git diff
  const diff = await gitDiffTool.execute({
    context: {
      repository: localRepoPath,
      ...prInfo.gitDiffToolConfig,
      diffType: 'unified',
    },
  });

  // 3. Get AI-powered summary
  const summary = await gitDiffSummaryAgent.generateText({
    prompt: `Analyze PR #${prInfo.prNumber}: "${prInfo.title}".
             Stats: ${prInfo.stats.changedFiles} files, +${prInfo.stats.additions}/-${prInfo.stats.deletions}
             Use the git diff tool with base: ${prInfo.gitDiffToolConfig.base} and compare: ${prInfo.gitDiffToolConfig.compare}`,
    messages: [],
  });

  return {
    prInfo,
    diff: diff.stats,
    summary: summary.text,
  };
}
```

## Testing

The tools include comprehensive tests:

### Git Diff Tool Tests

```bash
npm test packages/mastra/src/tools/git-diff-tool.test.ts
```

### GitHub PR Parser Tool Tests

```bash
npm test packages/mastra/src/tools/github-pr-parser-tool.test.ts
```

Tests cover:

- Basic functionality
- Different output formats
- Error handling
- URL validation and parsing
- Cross-repository PR handling
- Statistics parsing
