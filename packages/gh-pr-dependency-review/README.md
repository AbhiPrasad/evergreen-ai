# GitHub PR Dependency Review

An AI-powered tool for analyzing GitHub Pull Requests to identify dependency upgrades and provide comprehensive recommendations.

## Features

This package analyzes GitHub PRs to:

1. **Parse GitHub PRs** using the `github-pr-parser` tool to extract comprehensive PR information
2. **Detect Dependency Upgrades** and identify the programming language ecosystem (JavaScript, Java, Go, Python, Ruby)
3. **Stop Analysis** if the PR is not a dependency upgrade
4. **Parallel Analysis** when a dependency upgrade is detected:
   - **Git Diff Analysis** - Analyzes what dependencies are being upgraded and their impact
   - **Changelog Summary** - Summarizes what changed in the dependency via its changelog
   - **Ecosystem-Specific Analysis** - Runs specialized analysis based on the detected ecosystem
5. **Generate Recommendations** using all gathered information to provide actionable advice

## Workflow

The analysis follows this workflow:

1. **PR Parsing** - Uses `githubPRAnalyzerAgent` to parse the GitHub PR link
2. **Dependency Detection** - Analyzes PR title, labels, and content to determine if it's a dependency upgrade
3. **Ecosystem Identification** - Identifies the programming language ecosystem (JS/TS, Java, Go, Python, Ruby)
4. **Early Exit** - If not a dependency upgrade, stops the analysis
5. **Parallel Analysis** (Steps 4-7 from requirements):
   - `gitDiffSummaryAgent` - Analyzes the git diff to understand what changed
   - `changelogSummaryAgent` - Summarizes dependency changelogs
   - Ecosystem-specific dependency analysis agent (e.g., `javascriptTypeScriptDependencyAnalysisAgent`)
6. **Recommendation Generation** - `dependencyUpgradeRecommendationAgent` provides final recommendations

## Supported Ecosystems

- **JavaScript/TypeScript** - package.json, yarn.lock, package-lock.json
- **Java** - Maven (pom.xml), Gradle (build.gradle), SBT
- **Go** - go.mod
- **Python** - requirements.txt, poetry.lock, Pipfile
- **Ruby** - Gemfile, bundle

## Usage

1. Enter a GitHub PR URL (e.g., `https://github.com/owner/repo/pull/123`)
2. Click "Analyze PR"
3. The tool will:
   - Parse the PR details
   - Determine if it's a dependency upgrade
   - If yes, run comprehensive analysis
   - Provide AI-powered recommendations

## API Endpoints

### POST `/api/analyze-pr`

Analyzes a GitHub PR for dependency upgrades.

**Request Body:**
```json
{
  "prUrl": "https://github.com/owner/repo/pull/123"
}
```

**Response:**
```json
{
  "isDependencyUpgrade": boolean,
  "ecosystem": "javascript" | "java" | "go" | "python" | "ruby",
  "prAnalysis": { /* PR details */ },
  "gitDiffSummary": "AI analysis of git diff",
  "changelogSummary": "AI summary of dependency changes", 
  "dependencyAnalysis": "Ecosystem-specific analysis",
  "recommendation": "AI-powered upgrade recommendation"
}
```

## Dependencies

- `@sentry/evergreen-ai-agents` - AI agents for analysis
- `react-markdown` - Markdown rendering for AI responses
- `clsx` - Conditional CSS classes
- `next` - React framework

## Development

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build
```

## Environment Variables

The GitHub PR parser may require authentication for private repositories:

- `GITHUB_TOKEN`
- `GH_TOKEN` 
- `GITHUB_ACCESS_TOKEN`

Any of these environment variables can be used to provide GitHub API access.