import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql';
import { changelogSummaryAgent } from './agents/changelog-summary-agent';
import { gitDiffSummaryAgent } from './agents/git-diff-summary-agent';
import { javascriptTypeScriptDependencyAnalysisAgent } from './agents/js-ts-dependency-analysis-agent';
import { javaDependencyAnalysisAgent } from './agents/java-dependency-analysis-agent';
import { dependencyUpgradeRecommendationAgent } from './agents/dependency-upgrade-recommendation-agent';
import { fetchChangelogTool } from './tools/fetch-changelog-tool';
import { gitDiffTool } from './tools/git-diff-tool';
import { githubPRParserTool } from './tools/github-pr-parser-tool';
import { packageManagerDetectorTool } from './tools/javascript-typescript/package-manager-detector-tool';
import { javascriptTypeScriptDependencyAnalysisTool } from './tools/javascript-typescript/js-ts-dependency-analyzer-tool';
import { packageVersionComparisonTool } from './tools/javascript-typescript/package-version-comparison-tool';
import {
  javaBuildToolDetectorTool,
  mavenDependencyAnalyzerTool,
  gradleDependencyAnalyzerTool,
  sbtDependencyAnalyzerTool,
  type JavaBuildToolResult,
  type MavenAnalysis,
  type GradleAnalysis,
  type SbtAnalysis,
} from './tools/java';
import { goDependencyAnalysisAgent } from './agents/go-dependency-analysis-agent';
import { pythonDependencyAnalysisAgent } from './agents/python-dependency-analysis-agent';
import { rubyDependencyAnalysisAgent } from './agents/ruby-dependency-analysis-agent';

export const mastra = new Mastra({
  agents: {
    changelogSummaryAgent,
    gitDiffSummaryAgent,
    javascriptTypeScriptDependencyAnalysisAgent,
    javaDependencyAnalysisAgent,
    goDependencyAnalysisAgent,
    pythonDependencyAnalysisAgent,
    rubyDependencyAnalysisAgent,
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
export {
  fetchChangelogTool,
  gitDiffTool,
  githubPRParserTool,
  packageManagerDetectorTool,
  javascriptTypeScriptDependencyAnalysisTool,
  packageVersionComparisonTool,
  javaBuildToolDetectorTool,
  mavenDependencyAnalyzerTool,
  gradleDependencyAnalyzerTool,
  sbtDependencyAnalyzerTool,
};

// Export types from tools
export type { FetchChangelogOutput, ChangelogSection } from './tools/fetch-changelog-tool';
export type { FileChange, DiffStats } from './tools/git-diff-tool';
export type { GithubPRParserOutput } from './tools/github-pr-parser-tool';
export type { PackageManagerResult } from './tools/javascript-typescript/package-manager-detector-tool';
export type {
  DependencyAnalysis,
  DependencyInfo,
  FileAnalysis,
  ImportUsage,
} from './tools/javascript-typescript/js-ts-dependency-analyzer-tool';
export type { PackageVersionComparison } from './tools/javascript-typescript/package-version-comparison-tool';
export type { JavaBuildToolResult, MavenAnalysis, GradleAnalysis, SbtAnalysis } from './tools/java';

// Export agents for direct use
export {
  changelogSummaryAgent,
  gitDiffSummaryAgent,
  javascriptTypeScriptDependencyAnalysisAgent,
  javaDependencyAnalysisAgent,
  goDependencyAnalysisAgent,
  pythonDependencyAnalysisAgent,
  rubyDependencyAnalysisAgent,
  dependencyUpgradeRecommendationAgent,
};

// Export types from agents
// Note: dependency-upgrade-recommendation-agent currently doesn't export any types
