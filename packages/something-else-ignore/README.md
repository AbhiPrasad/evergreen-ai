# GitHub PR Dependency Review

An AI-powered Astro application that analyzes dependency upgrades in GitHub Pull Requests using a sophisticated multi-agent AI system.

## Features

### 🤖 Multi-Agent AI Architecture
This application uses a sophisticated AI agent system that runs analysis in parallel for maximum efficiency:

1. **GitHub PR Analyzer Agent**: Parses PR URLs and extracts comprehensive metadata
2. **Git Diff Summary Agent**: Analyzes code changes and their impact
3. **Changelog Summary Agent**: Fetches and summarizes dependency changelogs
4. **Ecosystem-Specific Agents**: Specialized analysis for different programming languages
5. **Dependency Upgrade Recommendation Agent**: Generates final recommendations

### 🔍 Analysis Pipeline
- **GitHub PR Parsing**: Extracts PR information, branch details, statistics, and metadata
- **Dependency Detection**: Uses NLP to identify dependency upgrades and determine ecosystems
- **Parallel Analysis**: Runs multiple AI agents simultaneously for faster results
- **Smart Recommendations**: Comprehensive upgrade recommendations with risk assessment

### 🎯 Real-time Progress Tracking
- Live progress indicators for each analysis step
- Error handling and recovery for individual analysis components
- Detailed step-by-step results display

## Supported Ecosystems

- 📦 JavaScript/TypeScript (npm, yarn)
- ☕ Java (Maven, Gradle)
- 🐹 Go (go.mod)
- 🐍 Python (pip, requirements.txt)
- 💎 Ruby (Bundler, Gemfile)

## Usage

1. Enter a GitHub PR URL (e.g., `https://github.com/owner/repo/pull/123`)
2. Click "Analyze" to start the AI-powered analysis
3. View real-time progress of analysis steps
4. Get comprehensive recommendations and insights

## Quick Start

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Set up environment variables** (optional for public repos):
   ```bash
   export GITHUB_TOKEN=your_github_token_here
   ```

3. **Start development server**:
   ```bash
   npm run dev
   ```

4. **Open your browser** to `http://localhost:4322`

5. **Test with a PR URL** like:
   - `https://github.com/facebook/react/pull/30000`
   - `https://github.com/microsoft/vscode/pull/20000`

## Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview

# Test agent functionality
npm run test-agent

# Clean build artifacts
npm run clean
```

## Architecture

### Technology Stack
- **Frontend**: Astro + React + TypeScript
- **Backend**: Astro Server-Side Rendering with API routes
- **AI**: Multi-agent system using Mastra framework with Claude 3.5 Sonnet
- **Styling**: CSS with modern gradients and responsive design

### Agent Workflow
```
1. GitHub PR URL Input
2. │
3. ├─ GitHub PR Analyzer Agent (parses PR metadata)
4. │
5. ├─ Dependency Detection (NLP-based classification)
6. │
7. ├─ Parallel Analysis:
8. │   ├─ Git Diff Summary Agent
9. │   ├─ Changelog Summary Agent  
10. │   ├─ Dependency-focused Diff Analysis
11. │   └─ Ecosystem-Specific Analysis
12. │
13. └─ Dependency Upgrade Recommendation Agent
14.     │
15.     └─ Final Recommendation Output
16. ```

## Environment Variables

- `GITHUB_TOKEN` or `GH_TOKEN` or `GITHUB_ACCESS_TOKEN`: GitHub personal access token for API access (optional for public repos)
- `ANTHROPIC_API_KEY`: Required for AI analysis (automatically used by Mastra agents)

## API Endpoints

- `POST /api/analyze-pr`: Analyzes a GitHub PR for dependency upgrades

### Request Body
```json
{
  "prUrl": "https://github.com/owner/repo/pull/123"
}
```

### Response
```json
{
  "success": true,
  "steps": [...],
  "dependencyInfo": {...},
  "recommendation": "..."
}
```