# Evergreen AI

A Mastra-powered AI application for GitHub repository analysis and PR reviews.

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
- **GitHub API**: Used for fetching repository data via octokit.js
  - Supports environment variables: `GITHUB_TOKEN`, `GH_TOKEN`, or `GITHUB_ACCESS_TOKEN`
- **LibSQL**: Storage for telemetry and memory
- **Anthropic Claude**: AI model for intelligent processing

## Packages

- `packages/evergreen-ai-agents` - AI agents and tools for dependency analysis
- `packages/evergreen-ai-mcp` - Model Context Protocol (MCP) server
- `packages/examples` - Usage examples and integrations
- `packages/sentry-sdk-selector` - Sentry SDK changelog comparison web app
- `packages/gh-pr-dependency-review` - GitHub PR dependency upgrade analysis web app

## Applications

### GitHub PR Dependency Review (`packages/gh-pr-dependency-review`)

A sophisticated AI-powered web application that analyzes dependency upgrades in GitHub Pull Requests using a multi-agent system. Features include:

- **Multi-Agent AI Architecture**: Uses specialized agents for different analysis tasks
- **Real-time Progress Tracking**: Live updates on analysis progress
- **Ecosystem Support**: JavaScript/TypeScript, Java, Go, Python, Ruby
- **Comprehensive Recommendations**: Security, compatibility, and impact assessments

**Quick Start:**
```bash
cd packages/gh-pr-dependency-review
npm install
npm run dev
# Visit http://localhost:4322
```

### Sentry SDK Selector (`packages/sentry-sdk-selector`)

Web application for comparing Sentry SDK changelog versions with AI-powered summaries.

**Quick Start:**
```bash
cd packages/sentry-sdk-selector  
npm install
npm run dev
# Visit http://localhost:4321
```
