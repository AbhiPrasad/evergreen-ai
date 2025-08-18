
import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql';
import { changelogSummaryAgent } from './agents/changelog-summary-agent';
import { fetchChangelogTool } from './tools/fetch-changelog-tool';

export const mastra = new Mastra({
  agents: {
    changelogSummaryAgent
  },
  storage: new LibSQLStore({
    // stores telemetry, evals, ... into memory storage, if it needs to persist, change to file:../mastra.db
    url: ":memory:",
  }),
  logger: new PinoLogger({
    name: 'Mastra',
    level: 'info',
  }),
});

// Export tools for direct use
export { fetchChangelogTool };
