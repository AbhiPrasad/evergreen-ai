# Evergreen AI

This repository contains the code for the Evergreen AI project, which is a collection of agents, tools, and applications
for dependency analysis across ecosystems.

## Requirements

- Node.js >= 20.9
- npm (workspace uses npm)

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

- `packages/evergreen-ai-agents` — Mastra-based agents and tools for multi-ecosystem dependency analysis (JS/TS, Java,
  Go, Python, Ruby). Includes PR diff parsing, changelog fetching, package manager detection, version comparison, and
  vulnerability scanning utilities.
- `packages/evergreen-ai-mcp` — Model Context Protocol (MCP) server exposing the agents/tools for use in MCP-compatible
  clients.
- `packages/examples` — Minimal runnable examples demonstrating how to use the agents/tools programmatically.
- `packages/sentry-sdk-selector` — Astro app for comparing Sentry SDK changelog versions with AI summaries.
- `packages/gh-pr-dependency-review` — Astro app for AI-assisted GitHub PR dependency upgrade analysis.

## Applications

### GitHub PR Dependency Review (`packages/gh-pr-dependency-review`)

A sophisticated AI-powered web application that analyzes dependency upgrades in GitHub Pull Requests using a multi-agent
system. Features include:

- **Multi-Agent AI Architecture**: Uses specialized agents for different analysis tasks
- **Real-time Progress Tracking**: Live updates on analysis progress
- **Ecosystem Support**: JavaScript/TypeScript, Java, Go, Python, Ruby
- **Comprehensive Recommendations**: Security, compatibility, and impact assessments

**Quick Start:**

```bash
cd packages/gh-pr-dependency-review
npm install
npm run dev
# Visit http://localhost:4321
```

Environment:

- Set one of: `GITHUB_TOKEN`, `GH_TOKEN`, or `GITHUB_ACCESS_TOKEN`

### Sentry SDK Selector (`packages/sentry-sdk-selector`)

Web application for comparing Sentry SDK changelog versions with AI-powered summaries.

**Quick Start:**

```bash
cd packages/sentry-sdk-selector
npm install
npm run dev
# Visit http://localhost:4321
```

Optional:

- `SENTRY_AUTH_TOKEN` for sourcemap upload when building for production

### Evergreen AI Agents (`packages/evergreen-ai-agents`)

Reusable agents and tools for dependency analysis across ecosystems. Ships as a library for internal use by the apps and
examples.

**Build & Test:**

```bash
cd packages/evergreen-ai-agents
npm install
npm run build
npm test
```

### MCP Server (`packages/evergreen-ai-mcp`)

MCP server that exposes the Evergreen agents/tools to MCP-compatible clients.

**Run:**

```bash
cd packages/evergreen-ai-mcp
npm install
npm run start
```

### Examples (`packages/examples`)

Runnable scripts showing how to call the agents/tools directly.

**Run an example:**

```bash
cd packages/examples
npm install
npm run start -- dependency-analysis-example.ts
```
