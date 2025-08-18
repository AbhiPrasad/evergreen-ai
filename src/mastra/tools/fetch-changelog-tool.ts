import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

// Tool for fetching changelog data
export const fetchChangelogTool = createTool({
  id: 'fetch-changelog',
  description: 'Fetches changelog data from a repository using GitHub CLI',
  inputSchema: z.object({
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    fromVersion: z.string().optional().describe('Starting version for range filtering'),
    toVersion: z.string().optional().describe('Ending version for range filtering'),
    limit: z.number().default(50).describe('Maximum number of releases to fetch')
  }),
  execute: async ({ context }) => {
    const { owner, repo, fromVersion, toVersion, limit } = context;
    
    try {
      // Use GitHub CLI to fetch releases
      const { execSync } = await import('child_process');
      const command = `gh release list --repo ${owner}/${repo} --limit ${limit} --json tagName,name,body,publishedAt`;
      
      const output = execSync(command, { encoding: 'utf-8' });
      const releases = JSON.parse(output);
      
      // Filter by version range if provided
      let filteredReleases = releases;
      if (fromVersion || toVersion) {
        filteredReleases = releases.filter((release: any) => {
          const version = release.tagName;
          let include = true;
          
          if (fromVersion && version < fromVersion) {
            include = false;
          }
          if (toVersion && version > toVersion) {
            include = false;
          }
          
          return include;
        });
      }
      
      return {
        releases: filteredReleases,
        totalFetched: releases.length,
        totalFiltered: filteredReleases.length,
        versionRange: fromVersion || toVersion ? `${fromVersion || 'start'} to ${toVersion || 'latest'}` : 'all versions'
      };
    } catch (error) {
      throw new Error(`Failed to fetch changelog: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
});
