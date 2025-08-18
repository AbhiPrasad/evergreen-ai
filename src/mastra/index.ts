
import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql';
import { getRepositoryChangelogTool, getLatestReleaseTool } from './tools/github-changelog-tool';
import { dependencyChangelogSummarizerTool } from './tools/dependency-changelog-agent';

export const mastra = new Mastra({
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
export { getRepositoryChangelogTool, getLatestReleaseTool, dependencyChangelogSummarizerTool };
