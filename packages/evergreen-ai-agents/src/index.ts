import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql';
import { changelogSummaryAgent } from './agents/changelog-summary-agent';
import { gitDiffSummaryAgent } from './agents/git-diff-summary-agent';
import { javascriptTypeScriptDependencyAnalysisAgent } from './agents/js-ts-dependency-analysis-agent';
import { dependencyUpgradeRecommendationAgent } from './agents/dependency-upgrade-recommendation-agent';
import { fetchChangelogTool } from './tools/fetch-changelog-tool';
import { gitDiffTool } from './tools/git-diff-tool';
import { githubPRParserTool } from './tools/github-pr-parser-tool';
import { packageManagerDetectorTool } from './tools/package-manager-detector-tool';
import { dependencyAnalyzerTool } from './tools/dependency-analyzer-tool';

export const mastra = new Mastra({
  agents: {
    changelogSummaryAgent,
    gitDiffSummaryAgent,
    javascriptTypeScriptDependencyAnalysisAgent,
    dependencyUpgradeRecommendationAgent,
  },
  storage: new LibSQLStore({
    // stores telemetry, evals, ... into memory storage, if it needs to persist, change to file:../mastra.db
    url: ':memory:',
  }),
  logger: new PinoLogger({
    name: 'Mastra',
    level: 'info',
  }),
});

// @ts-expect-error - This is a global variable that is set by the MCP server
globalThis.___MASTRA_TELEMETRY___ = false;

// Export tools for direct use
export { fetchChangelogTool, gitDiffTool, githubPRParserTool, packageManagerDetectorTool, dependencyAnalyzerTool };

// Export types from tools
export type { FetchChangelogOutput, ChangelogSection } from './tools/fetch-changelog-tool';
export type { FileChange, DiffStats } from './tools/git-diff-tool';
export type { GithubPRParserOutput } from './tools/github-pr-parser-tool';
export type { PackageManagerResult } from './tools/package-manager-detector-tool';
export type { DependencyAnalysis, DependencyInfo, FileAnalysis, ImportUsage } from './tools/dependency-analyzer-tool';

// Export agents for direct use
export {
  changelogSummaryAgent,
  gitDiffSummaryAgent,
  javascriptTypeScriptDependencyAnalysisAgent,
  dependencyUpgradeRecommendationAgent,
};

// Export types from agents
// Note: dependency-upgrade-recommendation-agent currently doesn't export any types
