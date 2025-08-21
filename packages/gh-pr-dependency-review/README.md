# GitHub PR Dependency Review

Astro web application for analyzing GitHub Pull Request dependency upgrades using AI.

## Development

This application requires the API server to be running. To start both services:

1. Start the API server (in one terminal):
```bash
cd packages/gh-pr-dependency-review-api
npm run dev
```

2. Start the Astro app (in another terminal):
```bash
cd packages/gh-pr-dependency-review
npm run dev
```

The web app will be available at `http://localhost:4321` and will connect to the API at `http://localhost:3001`.

## Environment Variables

- `PUBLIC_API_BASE_URL` - Base URL for the API server (default: `http://localhost:3001`)

## Architecture

- **Frontend**: Astro with React components
- **Backend**: Separate Express.js API server (see `../gh-pr-dependency-review-api/`)
- **AI Agents**: Powered by `@sentry/evergreen-ai-agents`

## Usage

1. Open the web application
2. Enter a GitHub PR URL (e.g., `https://github.com/owner/repo/pull/123`)
3. Click "Analyze" to get AI-powered dependency upgrade analysis
4. View the results including risk assessment, recommendations, and ecosystem-specific analysis