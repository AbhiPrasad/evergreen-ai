import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql';
import { changelogSummaryAgent } from './agents/changelog-summary-agent';
import { gitDiffSummaryAgent } from './agents/git-diff-summary-agent';
import { fetchChangelogTool } from './tools/fetch-changelog-tool';
import { gitDiffTool } from './tools/git-diff-tool';
import { githubPRParserTool } from './tools/github-pr-parser-tool';

export const mastra = new Mastra({
  agents: {
    changelogSummaryAgent,
    gitDiffSummaryAgent,
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

// Export tools for direct use
export { fetchChangelogTool, gitDiffTool, githubPRParserTool };

// Export types from tools
export type { FetchChangelogOutput, ChangelogSection } from './tools/fetch-changelog-tool';

// Export agents for direct use
export { changelogSummaryAgent, gitDiffSummaryAgent };
