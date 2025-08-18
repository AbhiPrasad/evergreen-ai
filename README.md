# Evergreen AI

A Mastra-powered AI application for GitHub repository analysis and PR reviews.

## Features

### GitHub PR Review Agent

An intelligent agent that can review pull requests for code quality, security, and best practices.

### GitHub Changelog Tools

Tools that use the GitHub CLI to fetch and summarize changelogs from GitHub repositories:

- **Repository Changelog Tool**: Fetches and summarizes multiple releases from a repository
- **Latest Release Tool**: Gets detailed information about the latest release

## Setup

1. Install dependencies:

```bash
npm install
```

2. Install and authenticate GitHub CLI:

```bash
# Install GitHub CLI (macOS)
brew install gh

# Authenticate
gh auth login
```

3. Set up environment variables:

```bash
# For PR review functionality
export GITHUB_PERSONAL_ACCESS_TOKEN="your_github_token"
```

## Usage Examples

### Using Changelog Tools

```typescript
import {
  getRepositoryChangelogTool,
  getLatestReleaseTool,
} from "./src/mastra/index.js";

// Get changelog summary for a repository
const changelogResult = await getRepositoryChangelogTool.execute({
  context: {
    owner: "facebook",
    repo: "react",
    limit: 10,
    includePrerelease: false,
  },
});

if (changelogResult.success) {
  console.log("Summary:", changelogResult.summary?.summary);
  console.log(
    "Total releases analyzed:",
    changelogResult.summary?.totalReleases
  );
  console.log("Features added:", changelogResult.summary?.features.length);
  console.log("Bug fixes:", changelogResult.summary?.bugFixes.length);
  console.log(
    "Breaking changes:",
    changelogResult.summary?.breakingChanges.length
  );
}

// Get latest release details
const latestResult = await getLatestReleaseTool.execute({
  context: {
    owner: "vercel",
    repo: "next.js",
  },
});

if (latestResult.success) {
  console.log("Latest release:", latestResult.release?.name);
  console.log("Published:", latestResult.publishedDate);
  console.log("Features:", latestResult.categorizedChanges?.features.length);
  console.log("Bug fixes:", latestResult.categorizedChanges?.bugFixes.length);
}
```

### Tool Features

#### Repository Changelog Tool

- Analyzes multiple releases (configurable limit)
- Categorizes changes into features, bug fixes, and breaking changes
- Provides intelligent summarization
- Filters out prereleases by default
- Calculates development activity timespan

#### Latest Release Tool

- Fetches the most recent release
- Categorizes changes in the release notes
- Provides structured output for easy consumption

## Development

```bash
# Start development server
npm run dev

# Build the project
npm run build

# Start production server
npm start
```

## Architecture

- **Mastra Framework**: Core AI application framework
- **GitHub CLI**: Used for fetching repository data
- **LibSQL**: Storage for telemetry and memory
- **Anthropic Claude**: AI model for intelligent processing
