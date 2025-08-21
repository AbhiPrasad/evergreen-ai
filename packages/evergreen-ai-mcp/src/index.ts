// MCP Server exposing @sentry/evergreen-ai-agents tools and agents

import { MCPServer } from '@mastra/mcp';
import {
  changelogSummaryAgent,
  gitDiffSummaryAgent,
  javascriptTypeScriptDependencyAnalysisAgent,
  javaDependencyAnalysisAgent,
  pythonDependencyAnalysisAgent,
  rubyDependencyAnalysisAgent,
  goDependencyAnalysisAgent,
} from '@sentry/evergreen-ai-agents';
import { dependencyUpgradeAnalysisPrompt } from './prompts';

// Create MCP Server with all available tools and agents
export const mcpServer = new MCPServer({
  name: 'Evergreen AI MCP Server',
  version: '0.0.1',
  description:
    'MCP server exposing Evergreen AI tools and agents for git operations, changelog analysis, and GitHub PR parsing',
  prompts: {
    listPrompts: async () => [
      {
        name: 'dependencyUpgradeAnalysis',
        description: 'Analyze dependency upgrades and provide comprehensive recommendations',
        arguments: [],
      },
    ],
    getPromptMessages: async ({ name }) => {
      if (name === 'dependencyUpgradeAnalysis') {
        return [
          {
            role: 'user' as const,
            content: {
              type: 'text',
              text: dependencyUpgradeAnalysisPrompt,
            },
          },
        ];
      }
      return [];
    },
  },
  tools: {},
  agents: {
    changelogSummary: changelogSummaryAgent,
    gitDiffSummary: gitDiffSummaryAgent,
    javascriptTypeScriptDependencyAnalysis: javascriptTypeScriptDependencyAnalysisAgent,
    javaDependencyAnalysis: javaDependencyAnalysisAgent,
    goDependencyAnalysis: goDependencyAnalysisAgent,
    pythonDependencyAnalysis: pythonDependencyAnalysisAgent,
    rubyDependencyAnalysis: rubyDependencyAnalysisAgent,
  },
});

// Future: subpath exports for reduced tool calls
// node @evergreen-ai/mcp-server/dist/javascript/index.js
// node @evergreen-ai/mcp-server/dist/go/index.js

export async function startServer() {
  await mcpServer.startStdio();
}

startServer();
