import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { execSync } from 'node:child_process';

// Define the schema for commit info
const commitInfoSchema = z.object({
  hash: z.string().describe('Full commit SHA'),
  subject: z.string().describe('Commit message subject line'),
  author: z.string().describe('Commit author name'),
  date: z.string().describe('Commit date'),
});

// Define the schema for file changes
const fileChangeSchema = z.object({
  path: z.string().describe('File path'),
  status: z.enum(['added', 'modified', 'deleted', 'renamed']).describe('Change status'),
  insertions: z.number().optional().describe('Number of lines added'),
  deletions: z.number().optional().describe('Number of lines removed'),
});

export type FileChange = z.infer<typeof fileChangeSchema>;

// Define the schema for diff statistics
const diffStatsSchema = z.object({
  filesChanged: z.number().describe('Total number of files changed'),
  insertions: z.number().describe('Total lines added across all files'),
  deletions: z.number().describe('Total lines removed across all files'),
  files: z.array(fileChangeSchema).describe('Individual file changes'),
});

export type DiffStats = z.infer<typeof diffStatsSchema>;

// Tool for generating git diffs
export const gitDiffTool = createTool({
  id: 'git-diff',
  description: 'Generates git diff for a branch or between two commits/branches',
  inputSchema: z.object({
    repository: z.string().describe('Path to the git repository (default: current directory)').optional(),
    base: z.string().describe('Base branch/commit to compare from (e.g., main, HEAD~1, commit SHA)').optional(),
    compare: z.string().describe('Branch/commit to compare to (e.g., feature-branch, HEAD, commit SHA)').optional(),
    filePath: z.string().describe('Specific file or directory path to diff').optional(),
    includeContext: z.number().default(3).describe('Number of context lines around changes'),
    diffType: z
      .enum(['unified', 'name-only', 'name-status', 'stat'])
      .default('unified')
      .describe('Type of diff output'),
    excludePatterns: z
      .array(z.string())
      .optional()
      .describe('Patterns to exclude from diff (e.g., ["*.log", "node_modules/"])'),
  }),
  outputSchema: z.object({
    diff: z.string().describe('Raw git diff output'),
    stats: diffStatsSchema.describe('Parsed diff statistics'),
    repository: z.string().describe('Repository path used for the diff'),
    base: z.string().describe('Base reference (branch/commit) used'),
    compare: z.string().describe('Compare reference (branch/commit) used'),
    currentBranch: z.string().describe('Current git branch name'),
    commitInfo: z
      .object({
        base: commitInfoSchema.optional(),
        compare: commitInfoSchema.optional(),
      })
      .describe('Commit information for base and compare if applicable'),
    diffType: z.enum(['unified', 'name-only', 'name-status', 'stat']).describe('Type of diff that was generated'),
    command: z.string().describe('The git command that was executed'),
  }),
  execute: async ({ context }) => {
    const { repository = '.', base, compare, filePath, includeContext, diffType, excludePatterns } = context;

    try {
      // Build the git diff command
      let command = 'git';

      // Add repository path if specified
      if (repository !== '.') {
        command += ` -C "${repository}"`;
      }

      command += ' diff';

      // Add diff type options
      switch (diffType) {
        case 'name-only':
          command += ' --name-only';
          break;
        case 'name-status':
          command += ' --name-status';
          break;
        case 'stat':
          command += ' --stat';
          break;
        default:
          command += ` -U${includeContext}`; // unified diff with context lines
      }

      // Add exclude patterns
      if (excludePatterns && excludePatterns.length > 0) {
        excludePatterns.forEach(pattern => {
          command += ` -- . ":!${pattern}"`;
        });
      }

      // Determine what to diff
      if (base && compare) {
        // Diff between two specific commits/branches
        command += ` ${base}...${compare}`;
      } else if (base) {
        // Diff from base to current working directory
        command += ` ${base}`;
      } else if (compare) {
        // Diff from HEAD to compare branch/commit
        command += ` HEAD...${compare}`;
      }
      // If neither base nor compare is specified, it will show unstaged changes

      // Add specific file path if provided
      if (filePath) {
        command += ` -- "${filePath}"`;
      }

      // Execute the git diff command
      const diffOutput = execSync(command, {
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large diffs
      });

      // Parse the diff output to extract useful information
      const diffStats = parseDiffStats(diffOutput, diffType);

      // Get additional git information
      let currentBranch = '';
      let commitInfo = {};

      try {
        currentBranch = execSync(`git -C "${repository}" branch --show-current`, { encoding: 'utf-8' }).trim();

        // Get commit info if comparing specific commits
        if (base) {
          const baseCommit = execSync(`git -C "${repository}" log -1 --format="%H|%s|%an|%ad" ${base}`, {
            encoding: 'utf-8',
          }).trim();
          const [hash, subject, author, date] = baseCommit.split('|');
          commitInfo = {
            base: { hash, subject, author, date },
          };
        }

        if (compare) {
          const compareCommit = execSync(`git -C "${repository}" log -1 --format="%H|%s|%an|%ad" ${compare}`, {
            encoding: 'utf-8',
          }).trim();
          const [hash, subject, author, date] = compareCommit.split('|');
          commitInfo = {
            ...commitInfo,
            compare: { hash, subject, author, date },
          };
        }
      } catch (err) {
        // Ignore errors for additional info
      }

      return {
        diff: diffOutput,
        stats: diffStats,
        repository: repository === '.' ? 'current directory' : repository,
        base: base || 'working directory',
        compare: compare || 'HEAD',
        currentBranch,
        commitInfo,
        diffType,
        command: command.replace(/\s+/g, ' ').trim(), // Clean up the command for display
      };
    } catch (error) {
      throw new Error(`Failed to generate git diff: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },
});

// Helper function to parse diff statistics
function parseDiffStats(diffOutput: string, diffType: string): DiffStats {
  const stats: DiffStats = {
    filesChanged: 0,
    insertions: 0,
    deletions: 0,
    files: [],
  };

  if (diffType === 'name-only') {
    const files = diffOutput
      .trim()
      .split('\n')
      .filter(line => line);
    stats.filesChanged = files.length;
    stats.files = files.map(path => ({ path, status: 'modified' as const }));
  } else if (diffType === 'name-status') {
    const lines = diffOutput
      .trim()
      .split('\n')
      .filter(line => line);
    stats.filesChanged = lines.length;
    stats.files = lines.map(line => {
      const [statusCode, ...pathParts] = line.split('\t');
      const path = pathParts.join('\t');
      let status: FileChange['status'] = 'modified';
      switch (statusCode) {
        case 'A':
          status = 'added';
          break;
        case 'D':
          status = 'deleted';
          break;
        case 'M':
          status = 'modified';
          break;
        case 'R':
          status = 'renamed';
          break;
      }
      return { path, status };
    });
  } else if (diffType === 'stat') {
    // Parse stat output
    const lines = diffOutput.trim().split('\n');
    const summaryLine = lines[lines.length - 1];
    const summaryMatch = summaryLine.match(
      /(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/,
    );

    if (summaryMatch) {
      stats.filesChanged = parseInt(summaryMatch[1]) || 0;
      stats.insertions = parseInt(summaryMatch[2]) || 0;
      stats.deletions = parseInt(summaryMatch[3]) || 0;
    }

    // Parse individual file stats
    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i];
      const match = line.match(/^\s*(.+?)\s+\|\s+(\d+)\s+([\+\-]+)/);
      if (match) {
        const [, path, , indicators] = match;
        const insertions = (indicators.match(/\+/g) || []).length;
        const deletions = (indicators.match(/-/g) || []).length;
        stats.files.push({
          path: path.trim(),
          status: 'modified',
          insertions,
          deletions,
        });
      }
    }
  } else {
    // Parse unified diff
    const lines = diffOutput.split('\n');
    const fileSet = new Set<string>();
    let currentFile = '';

    for (const line of lines) {
      if (line.startsWith('diff --git')) {
        const match = line.match(/diff --git a\/(.+) b\/(.+)/);
        if (match) {
          currentFile = match[2];
          fileSet.add(currentFile);
        }
      } else if (line.startsWith('+') && !line.startsWith('+++')) {
        stats.insertions++;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        stats.deletions++;
      }
    }

    stats.filesChanged = fileSet.size;
    stats.files = Array.from(fileSet).map(path => ({
      path,
      status: 'modified' as const,
    }));
  }

  return stats;
}
