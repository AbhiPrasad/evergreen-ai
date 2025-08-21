# GitHub PR Dependency Review

Astro web application for analyzing GitHub Pull Request dependency upgrades using AI.

## Development

```bash
cd packages/gh-pr-dependency-review
npm run dev
```

The web app will be available at `http://localhost:4321`.

## Architecture

- **Frontend**: Astro with React components
- **AI Agents**: Powered by `@sentry/evergreen-ai-agents`

## Usage

1. Open the web application
2. Enter a GitHub PR URL (e.g., `https://github.com/owner/repo/pull/123`)
3. Click "Analyze" to get AI-powered dependency upgrade analysis
4. View the results including risk assessment, recommendations, and ecosystem-specific analysis
