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
