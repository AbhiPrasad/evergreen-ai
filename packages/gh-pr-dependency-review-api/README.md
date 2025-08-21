# GitHub PR Dependency Review API

Express.js API server for analyzing GitHub Pull Request dependency upgrades using AI agents.

## Development

To start the development server:

```bash
npm run dev
```

The server will start on `http://localhost:3001` by default.

## Environment Variables

- `PORT` - Port to run the server on (default: 3001)

## API Endpoints

### GET /api/analyze-pr

Analyzes a GitHub PR for dependency upgrades.

**Query Parameters:**
- `prUrl` (required) - GitHub PR URL (e.g., `https://github.com/owner/repo/pull/123`)

**Response:**
```json
{
  "success": true,
  "steps": [...],
  "dependencyInfo": {...},
  "recommendation": "..."
}
```

### GET /health

Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2025-08-21T00:00:00.000Z"
}
```

## Building

To build for production:

```bash
npm run build
npm start
```

## Architecture

The API is structured as follows:

- `src/index.ts` - Express server setup
- `src/routes/api.ts` - API routes
- `src/controllers/analyze-pr.ts` - Main PR analysis logic
- `src/services/dependency-detector.ts` - Dependency upgrade detection
- `src/services/agent-selector.ts` - AI agent selection based on ecosystem
- `src/types.ts` - TypeScript type definitions