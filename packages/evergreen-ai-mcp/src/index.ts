// MCP Server exposing @sentry/evergreen-ai-agents tools and agents

import { MCPServer } from '@mastra/mcp';
import {
  fetchChangelogTool,
  gitDiffTool,
  githubPRParserTool,
  dependencyAnalyzerTool,
  changelogSummaryAgent,
  gitDiffSummaryAgent,
  dependencyAnalysisAgent,
} from '@sentry/evergreen-ai-agents';

// Create MCP Server with all available tools and agents
export const mcpServer = new MCPServer({
  name: 'Evergreen AI MCP Server',
  version: '0.0.1',
  description:
    'MCP server exposing Evergreen AI tools and agents for git operations, changelog analysis, and GitHub PR parsing',
  tools: {
    fetchChangelog: fetchChangelogTool,
    gitDiff: gitDiffTool,
    githubPRParser: githubPRParserTool,
    dependencyAnalyzer: dependencyAnalyzerTool,
  },
  agents: {
    changelogSummary: changelogSummaryAgent,
    gitDiffSummary: gitDiffSummaryAgent,
    dependencyAnalysis: dependencyAnalysisAgent,
  },
});

export async function startServer() {
  await mcpServer.startStdio();
}

startServer();
