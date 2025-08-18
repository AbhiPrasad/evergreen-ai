// MCP Server exposing @sentry/evergreen-ai-agents tools and agents

import { MCPServer } from '@mastra/mcp';
import {
  fetchChangelogTool,
  gitDiffTool,
  githubPRParserTool,
  changelogSummaryAgent,
  gitDiffSummaryAgent,
} from '@sentry/evergreen-ai-agents';

// Create MCP Server with all available tools and agents
export const mcpServer = new MCPServer({
  name: 'Evergreen AI MCP Server',
  version: '0.0.1',
  description: 'MCP server exposing Evergreen AI tools and agents for git operations, changelog analysis, and GitHub PR parsing',
  tools: {
    fetchChangelog: fetchChangelogTool,
    gitDiff: gitDiffTool,
    githubPRParser: githubPRParserTool,
  },
  agents: {
    changelogSummary: changelogSummaryAgent,
    gitDiffSummary: gitDiffSummaryAgent,
  },
});

// Re-export everything from the main agents package for convenience
export * from '@sentry/evergreen-ai-agents';

// Export the package version
export const packageVersion = '0.0.1';

// Main function to start the MCP server
export async function startMCPServer() {
  try {
    // Start the server using stdio transport (for CLI usage)
    await mcpServer.startStdio();
    console.log('MCP Server started successfully');
  } catch (error) {
    console.error('Failed to start MCP server:', error);
    process.exit(1);
  }
}

// Start the server if this file is run directly
// Check if this module is being run directly (ESM compatible)
if (import.meta.url === `file://${process.argv[1]}`) {
  startMCPServer();
}
