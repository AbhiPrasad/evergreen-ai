import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

// Define the schema for PR/issue links
const prLinkSchema = z.object({
  number: z.string().describe('PR or issue number'),
  url: z.string().url().describe('Full URL to the PR or issue'),
  type: z.enum(['pr', 'issue']).describe('Type of link - pull request or issue')
});

// Define the schema for changelog sections
const changelogSectionSchema = z.object({
  version: z.string().optional().describe('Version number for this section'),
  date: z.string().optional().describe('Release date for this version'),
  content: z.string().describe('Content of the changelog section (without version header)'),
  rawContent: z.string().describe('Raw content including the version header'),
  prLinks: z.array(prLinkSchema).describe('Extracted PR and issue links from this section')
});

// Tool for fetching changelog data
export const fetchChangelogTool = createTool({
  id: 'fetch-changelog',
  description: 'Fetches changelog content from a repository CHANGELOG.md file',
  inputSchema: z.object({
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    changelogPath: z.string().optional().describe('Path to the changelog file (e.g., CHANGELOG.md, docs/CHANGES.md). If not provided, will try common names'),
    branch: z.string().default('main').describe('Branch to fetch changelog from (default: main)'),
    fromVersion: z.string().optional().describe('Starting version for range filtering'),
    toVersion: z.string().optional().describe('Ending version for range filtering')
  }),
  outputSchema: z.object({
    changelog: z.array(changelogSectionSchema).describe('Array of parsed changelog sections'),
    totalSections: z.number().describe('Total number of sections found in the changelog'),
    filteredSections: z.number().describe('Number of sections after version filtering'),
    versionRange: z.string().describe('Description of the version range used for filtering'),
    sourceFile: z.string().describe('The changelog file that was found and used'),
    repository: z.string().describe('Repository in format owner/repo'),
    branch: z.string().describe('Branch from which the changelog was fetched')
  }),
  execute: async ({ context }) => {
    const { owner, repo, changelogPath, branch, fromVersion, toVersion } = context;
    
    try {
      // Use GitHub CLI to fetch CHANGELOG.md file
      const { execSync } = await import('child_process');
      
      let changelogContent = '';
      let usedFile = '';
      
      if (changelogPath) {
        // Use the specified changelog path
        try {
          const command = `gh api repos/${owner}/${repo}/contents/${changelogPath}?ref=${branch}`;
          const output = execSync(command, { encoding: 'utf-8' });
          const fileData = JSON.parse(output);
          
          // Decode base64 content
          changelogContent = Buffer.from(fileData.content, 'base64').toString('utf-8');
          usedFile = changelogPath;
        } catch (err) {
          throw new Error(`Changelog file not found at path: ${changelogPath}`);
        }
      } else {
        // Try common changelog file names
        const changelogFiles = ['CHANGELOG.md', 'CHANGES.md', 'HISTORY.md', 'changelog.md'];
        
        for (const filename of changelogFiles) {
          try {
            const command = `gh api repos/${owner}/${repo}/contents/${filename}?ref=${branch}`;
            const output = execSync(command, { encoding: 'utf-8' });
            const fileData = JSON.parse(output);
            
            // Decode base64 content
            changelogContent = Buffer.from(fileData.content, 'base64').toString('utf-8');
            usedFile = filename;
            break;
          } catch (err) {
            // File doesn't exist, try next one
            continue;
          }
        }
        
        if (!changelogContent) {
          throw new Error('No changelog file found (tried: CHANGELOG.md, CHANGES.md, HISTORY.md, changelog.md)');
        }
      }
      
      // Parse changelog content into sections
      const sections = parseChangelogSections(changelogContent);
      
      // Filter by version range if provided
      let filteredSections = sections;
      if (fromVersion || toVersion) {
        filteredSections = sections.filter(section => {
          const version = section.version;
          if (!version) return false;
          
          let include = true;
          if (fromVersion && compareVersions(version, fromVersion) < 0) {
            include = false;
          }
          if (toVersion && compareVersions(version, toVersion) > 0) {
            include = false;
          }
          
          return include;
        });
      }
      
      return {
        changelog: filteredSections,
        totalSections: sections.length,
        filteredSections: filteredSections.length,
        versionRange: fromVersion || toVersion ? `${fromVersion || 'start'} to ${toVersion || 'latest'}` : 'all versions',
        sourceFile: usedFile,
        repository: `${owner}/${repo}`,
        branch
      };
    } catch (error) {
      throw new Error(`Failed to fetch changelog: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
});

// Helper function to parse changelog sections
function parseChangelogSections(content: string) {
  const sections: Array<{
    version?: string;
    date?: string;
    content: string;
    rawContent: string;
    prLinks: Array<{ number: string; url: string; type: 'pr' | 'issue' }>;
  }> = [];
  
  // Split by version headers (## [version] or ## version)
  const lines = content.split('\n');
  let currentSection: { version?: string; date?: string; content: string; rawContent: string; prLinks: Array<{ number: string; url: string; type: 'pr' | 'issue' }> } | null = null;
  
  for (const line of lines) {
    // Check if this is a version header
    const versionMatch = line.match(/^##\s*\[?v?([^\]]+)\]?\s*(?:-\s*(.+))?/);
    
    if (versionMatch) {
      // Save previous section if it exists
      if (currentSection) {
        sections.push(currentSection);
      }
      
      // Start new section
      currentSection = {
        version: versionMatch[1].trim(),
        date: versionMatch[2]?.trim(),
        content: '',
        rawContent: line + '\n',
        prLinks: []
      };
    } else if (currentSection) {
      // Add line to current section
      currentSection.content += line + '\n';
      currentSection.rawContent += line + '\n';
    }
  }
  
  // Add the last section
  if (currentSection) {
    sections.push(currentSection);
  }
  
  // Extract PR/issue links for each section
  sections.forEach(section => {
    section.prLinks = extractPRAndIssueLinks(section.content);
  });
  
  return sections;
}

// Helper function to extract PR and issue links from changelog content
function extractPRAndIssueLinks(content: string): Array<{ number: string; url: string; type: 'pr' | 'issue' }> {
  const links: Array<{ number: string; url: string; type: 'pr' | 'issue' }> = [];
  
  // Regex pattern to match GitHub PR/issue links in markdown format
  // Matches patterns like [#12345](https://github.com/owner/repo/pull/12345) or [#12345](https://github.com/owner/repo/issues/12345)
  const linkRegex = /\[#(\d+)\]\((https:\/\/github\.com\/[^\/]+\/[^\/]+\/(pull|issues)\/\d+)\)/g;
  
  let match;
  while ((match = linkRegex.exec(content)) !== null) {
    const [, number, url, urlType] = match;
    const type = urlType === 'pull' ? 'pr' : 'issue';
    
    // Avoid duplicates
    if (!links.some(link => link.number === number && link.url === url)) {
      links.push({
        number,
        url,
        type
      });
    }
  }
  
  return links;
}

// Simple version comparison function
function compareVersions(a: string, b: string): number {
  // Remove 'v' prefix if present
  const cleanA = a.replace(/^v/, '');
  const cleanB = b.replace(/^v/, '');
  
  const partsA = cleanA.split('.').map(part => parseInt(part.split('-')[0]) || 0);
  const partsB = cleanB.split('.').map(part => parseInt(part.split('-')[0]) || 0);
  
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const partA = partsA[i] || 0;
    const partB = partsB[i] || 0;
    
    if (partA < partB) return -1;
    if (partA > partB) return 1;
  }
  
  return 0;
}
