# Changelog Tools and Agent

This document describes the Fetch Changelog Tool and Changelog Summary Agent in the Mastra framework.

## Fetch Changelog Tool

The `fetchChangelogTool` fetches and parses changelog files from GitHub repositories with version filtering and PR/issue link extraction.

### Features

- Fetches changelog files from GitHub repositories using GitHub CLI
- Automatically finds common changelog filenames (CHANGELOG.md, CHANGES.md, etc.)
- Parses changelog into structured sections
- Extracts PR and issue links from each section
- Filters sections by version range
- Type-safe output with Zod schema validation

### Output Schema

The tool provides a strongly-typed output schema for better TypeScript support:

```typescript
import { type FetchChangelogOutput, type ChangelogSection, type PRLink } from '@mastra/tools/fetch-changelog-tool';

// Main output type
type FetchChangelogOutput = {
  changelog: ChangelogSection[];     // Array of parsed changelog sections
  totalSections: number;             // Total sections found
  filteredSections: number;          // Sections after filtering
  versionRange: string;              // Description of version range
  sourceFile: string;                // Which changelog file was used
  repository: string;                // "owner/repo" format
  branch: string;                    // Branch name
}

// Individual changelog section
type ChangelogSection = {
  version?: string;                  // Version number (optional)
  date?: string;                     // Release date (optional)
  content: string;                   // Section content without header
  rawContent: string;                // Full content with header
  prLinks: PRLink[];                 // Extracted PR/issue links
}

// PR/Issue link
type PRLink = {
  number: string;                    // PR or issue number
  url: string;                       // Full GitHub URL
  type: 'pr' | 'issue';             // Link type
}
```

### Usage

```typescript
import { fetchChangelogTool } from '@mastra/tools/fetch-changelog-tool';

// Basic usage - auto-detect changelog file
const result = await fetchChangelogTool.execute({
  context: {
    owner: 'facebook',
    repo: 'react',
    branch: 'main'
  }
});

// With version filtering
const filtered = await fetchChangelogTool.execute({
  context: {
    owner: 'vercel',
    repo: 'next.js',
    fromVersion: '13.0.0',
    toVersion: '14.0.0'
  }
});

// Specify custom changelog path
const customPath = await fetchChangelogTool.execute({
  context: {
    owner: 'microsoft',
    repo: 'typescript',
    changelogPath: 'docs/CHANGELOG.md',
    branch: 'main'
  }
});
```

### Parameters

- `owner` (required): Repository owner/organization
- `repo` (required): Repository name
- `changelogPath` (optional): Path to changelog file (auto-detected if not provided)
- `branch` (optional): Branch to fetch from (default: 'main')
- `fromVersion` (optional): Start version for filtering (inclusive)
- `toVersion` (optional): End version for filtering (inclusive)

### Type-Safe Usage Example

```typescript
import { fetchChangelogTool, type FetchChangelogOutput } from '@mastra/tools/fetch-changelog-tool';

async function analyzeRecentChanges(owner: string, repo: string) {
  const result: FetchChangelogOutput = await fetchChangelogTool.execute({
    context: { owner, repo }
  });
  
  // TypeScript knows all these properties exist
  console.log(`Found ${result.totalSections} versions in ${result.sourceFile}`);
  
  // Analyze PR/issue links with type safety
  const stats = result.changelog.reduce((acc, section) => {
    const prs = section.prLinks.filter(link => link.type === 'pr').length;
    const issues = section.prLinks.filter(link => link.type === 'issue').length;
    
    return {
      totalPRs: acc.totalPRs + prs,
      totalIssues: acc.totalIssues + issues,
      versions: acc.versions + 1
    };
  }, { totalPRs: 0, totalIssues: 0, versions: 0 });
  
  return stats;
}
```

### Error Handling

The tool provides clear error messages:
- "Changelog file not found at path: ..." - when specified file doesn't exist
- "No changelog file found (tried: ...)" - when auto-detection fails
- "Failed to fetch changelog: ..." - for API or network errors

### Requirements

- GitHub CLI (`gh`) must be installed and authenticated
- Repository must be accessible with your GitHub credentials

## Changelog Summary Agent

The `changelogSummaryAgent` analyzes changelog data and provides intelligent summaries based on keywords and version ranges.

### Features

- Categorizes changes by type (breaking, features, bugs, etc.)
- Filters by keywords or package names
- Focuses on specific version ranges
- Preserves PR/issue links for traceability
- Excludes internal/test changes unless user-facing

### Usage

```typescript
import { changelogSummaryAgent } from '@mastra/agents/changelog-summary-agent';

// Basic changelog summary
const summary = await changelogSummaryAgent.generateText({
  prompt: 'Summarize the changelog for facebook/react focusing on hooks-related changes',
  messages: []
});

// Version-specific analysis
const versionSummary = await changelogSummaryAgent.generateText({
  prompt: `Analyze the changelog for vercel/next.js between versions 13.0.0 and 14.0.0.
           Focus on breaking changes and new features.`,
  messages: []
});

// Security-focused review
const securityReview = await changelogSummaryAgent.generateText({
  prompt: `Review the changelog for nodejs/node and highlight all security-related updates
           in the last 10 versions`,
  messages: []
});
```

### Output Structure

The agent provides structured summaries including:

1. **Executive Summary**: Key changes and their significance
2. **Categorized Changes**:
   - Breaking changes
   - New features
   - Bug fixes
   - Performance improvements
   - Security updates
   - Dependencies updates
   - Documentation changes
3. **Version Details**: Key releases with dates
4. **PR/Issue Links**: Preserved from original changelog

## Integration Example

Combine both tools for comprehensive changelog analysis:

```typescript
import { fetchChangelogTool } from '@mastra/tools/fetch-changelog-tool';
import { changelogSummaryAgent } from '@mastra/agents/changelog-summary-agent';

async function generateReleaseNotes(owner: string, repo: string, fromVersion: string) {
  // Fetch changelog data
  const changelog = await fetchChangelogTool.execute({
    context: {
      owner,
      repo,
      fromVersion,
      toVersion: 'latest'
    }
  });
  
  // Generate AI summary
  const summary = await changelogSummaryAgent.generateText({
    prompt: `Create release notes from the changelog of ${owner}/${repo} starting from ${fromVersion}.
             Found ${changelog.filteredSections} versions with changes.
             Focus on user-facing changes and breaking changes.`,
    messages: []
  });
  
  return {
    versions: changelog.filteredSections,
    sourceFile: changelog.sourceFile,
    summary: summary.text
  };
}
```

## Testing

Run tests for the fetch changelog tool:
```bash
npm test src/mastra/tools/fetch-changelog-tool.test.ts
```

The tests cover:
- PR/issue link extraction
- Duplicate link handling
- Various markdown formats