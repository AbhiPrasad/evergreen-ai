import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { exec } from "child_process";
import { promisify } from "util";
import { readFile } from "fs/promises";

// exec is promisified per call to cooperate with tests that mock promisify at runtime

interface Release {
  tagName: string;
  name: string;
  body: string;
  publishedAt: string;
  url: string;
  isDraft: boolean;
  isPrerelease: boolean;
}

interface ChangelogSummary {
  totalReleases: number;
  latestRelease?: Release;
  majorChanges: string[];
  breakingChanges: string[];
  features: string[];
  bugFixes: string[];
  summary: string;
}

class GitHubCLIClient {
  private async runGHCommand(command: string): Promise<string> {
    try {
      const execAsyncLocal = promisify(exec);
      const { stdout, stderr } = await execAsyncLocal(`gh ${command}`);
      if (stderr && !stderr.includes('warning')) {
        throw new Error(`GitHub CLI error: ${stderr}`);
      }
      return stdout.trim();
    } catch (error) {
      throw new Error(`Failed to execute GitHub CLI command: ${(error as Error).message}`);
    }
  }

  async getRepositoryReleases(owner: string, repo: string, limit: number = 10): Promise<Release[]> {
    // First get basic release info
    const command = `release list --repo ${owner}/${repo} --json tagName,name,publishedAt,isDraft,isPrerelease --limit ${limit}`;
    const output = await this.runGHCommand(command);
    
    if (!output) {
      return [];
    }

    try {
      const basicReleases = JSON.parse(output);
      
      // For each release, get the full details including body
      const detailedReleases = await Promise.all(
        basicReleases.map(async (release: any) => {
          try {
            const detailCommand = `release view ${release.tagName} --repo ${owner}/${repo} --json tagName,name,body,publishedAt,url,isDraft,isPrerelease`;
            const detailOutput = await this.runGHCommand(detailCommand);
            const details = JSON.parse(detailOutput);
            // Preserve flags from list to ensure consistent filtering
            return {
              ...details,
              isDraft: release.isDraft,
              isPrerelease: release.isPrerelease,
            };
          } catch (error) {
            // If we can't get details, return basic info with empty body
            return {
              ...release,
              body: '',
              url: `https://github.com/${owner}/${repo}/releases/tag/${release.tagName}`
            };
          }
        })
      );
      
      return detailedReleases;
    } catch (error) {
      throw new Error(`Failed to parse GitHub CLI output: ${(error as Error).message}`);
    }
  }

  async getLatestRelease(owner: string, repo: string): Promise<Release | null> {
    try {
      const command = `release view --repo ${owner}/${repo} --json tagName,name,body,publishedAt,url,isDraft,isPrerelease`;
      const output = await this.runGHCommand(command);
      return JSON.parse(output);
    } catch (error) {
      // Return null if no releases found
      return null;
    }
  }

  async getRepositoryTags(owner: string, repo: string, limit: number = 20): Promise<string[]> {
    try {
      const command = `api repos/${owner}/${repo}/tags --paginate --limit ${limit} --jq '.[].name'`;
      const output = await this.runGHCommand(command);
      return output.split('\n').filter(tag => tag.trim());
    } catch (error) {
      return [];
    }
  }
}

class ChangelogSummarizer {
  public categorizeChanges(releaseBody: string): {
    breakingChanges: string[];
    features: string[];
    bugFixes: string[];
    other: string[];
  } {
    const lines = releaseBody.split('\n').map(line => line.trim()).filter(line => line);
    
    const breakingChanges: string[] = [];
    const features: string[] = [];
    const bugFixes: string[] = [];
    const other: string[] = [];

    for (const line of lines) {
      const lowerLine = line.toLowerCase();
      const isSectionHeading = lowerLine.startsWith('##') || lowerLine.startsWith('###');
      if (isSectionHeading) {
        // Skip markdown section headings from categorization lists
        continue;
      }
      
      if (lowerLine.includes('breaking') || lowerLine.includes('breaking change') || 
          lowerLine.includes('major') || lowerLine.includes('incompatible')) {
        breakingChanges.push(line);
      } else if (lowerLine.includes('feat') || lowerLine.includes('feature') || 
                 lowerLine.includes('add') || lowerLine.includes('new') ||
                 lowerLine.includes('implement')) {
        features.push(line);
      } else if (lowerLine.includes('fix') || lowerLine.includes('bug') || 
                 lowerLine.includes('patch') || lowerLine.includes('resolve')) {
        bugFixes.push(line);
      } else if (line.length > 10) { // Skip very short lines
        other.push(line);
      }
    }

    return { breakingChanges, features, bugFixes, other };
  }

  summarizeChangelog(releases: Release[]): ChangelogSummary {
    if (releases.length === 0) {
      return {
        totalReleases: 0,
        majorChanges: [],
        breakingChanges: [],
        features: [],
        bugFixes: [],
        summary: "No releases found for this repository."
      };
    }

    const latestRelease = releases[0];
    const allBreakingChanges: string[] = [];
    const allFeatures: string[] = [];
    const allBugFixes: string[] = [];
    const majorChanges: string[] = [];

    for (const release of releases) {
      if (!release.body) continue;

      const categorized = this.categorizeChanges(release.body);
      
      // Add to overall collections
      allBreakingChanges.push(...categorized.breakingChanges);
      allFeatures.push(...categorized.features);
      allBugFixes.push(...categorized.bugFixes);

      // Major changes are any substantial release
      if (categorized.breakingChanges.length > 0 || categorized.features.length > 3) {
        majorChanges.push(`${release.name || release.tagName}: ${this.summarizeRelease(release)}`);
      }
    }

    // Generate summary
    const summary = this.generateSummary(releases, {
      breakingChanges: allBreakingChanges,
      features: allFeatures,
      bugFixes: allBugFixes,
      majorChanges
    });

    return {
      totalReleases: releases.length,
      latestRelease,
      majorChanges: majorChanges.slice(0, 5), // Top 5 major changes
      breakingChanges: allBreakingChanges.slice(0, 10), // Top 10 breaking changes
      features: allFeatures.slice(0, 15), // Top 15 features
      bugFixes: allBugFixes.slice(0, 10), // Top 10 bug fixes
      summary
    };
  }

  private summarizeRelease(release: Release): string {
    if (!release.body) return "No details available.";
    
    const categorized = this.categorizeChanges(release.body);
    const parts: string[] = [];

    if (categorized.breakingChanges.length > 0) {
      parts.push(`${categorized.breakingChanges.length} breaking change(s)`);
    }
    if (categorized.features.length > 0) {
      parts.push(`${categorized.features.length} new feature(s)`);
    }
    if (categorized.bugFixes.length > 0) {
      parts.push(`${categorized.bugFixes.length} bug fix(es)`);
    }

    return parts.length > 0 ? parts.join(', ') : "General updates and improvements.";
  }

  private generateSummary(releases: Release[], aggregated: {
    breakingChanges: string[];
    features: string[];
    bugFixes: string[];
    majorChanges: string[];
  }): string {
    const { breakingChanges, features, bugFixes, majorChanges } = aggregated;
    const totalReleases = releases.length;
    const latestRelease = releases[0];

    let summary = `📊 **Changelog Summary for ${totalReleases} recent releases**\n\n`;

    if (latestRelease) {
      summary += `🏷️ **Latest Release**: ${latestRelease.name || latestRelease.tagName} (${new Date(latestRelease.publishedAt).toLocaleDateString()})\n`;
      summary += `${this.summarizeRelease(latestRelease)}\n\n`;
    }

    summary += `📈 **Overall Activity**:\n`;
    summary += `• ${features.length} features added\n`;
    summary += `• ${bugFixes.length} bugs fixed\n`;
    summary += `• ${breakingChanges.length} breaking changes\n`;
    summary += `• ${majorChanges.length} major releases\n\n`;

    if (breakingChanges.length > 0) {
      summary += `⚠️ **Notable Breaking Changes**:\n`;
      breakingChanges.slice(0, 3).forEach(change => {
        summary += `• ${change}\n`;
      });
      summary += '\n';
    }

    if (features.length > 0) {
      summary += `✨ **Key Features Added**:\n`;
      features.slice(0, 5).forEach(feature => {
        summary += `• ${feature}\n`;
      });
      summary += '\n';
    }

    const timespan = this.calculateTimespan(releases);
    summary += `⏱️ **Development Activity**: ${timespan}`;

    return summary;
  }

  private calculateTimespan(releases: Release[]): string {
    if (releases.length < 2) return "Single release analyzed.";

    const latest = new Date(releases[0].publishedAt);
    const oldest = new Date(releases[releases.length - 1].publishedAt);
    const diffInDays = Math.ceil((latest.getTime() - oldest.getTime()) / (1000 * 60 * 60 * 24));

    if (diffInDays < 30) {
      return `${diffInDays} days of development activity.`;
    } else if (diffInDays < 365) {
      const months = Math.ceil(diffInDays / 30);
      return `${months} months of development activity.`;
    } else {
      const years = Math.ceil(diffInDays / 365);
      return `${years} year(s) of development activity.`;
    }
  }
}

// Initialize clients
const githubCLI = new GitHubCLIClient();
const changelogSummarizer = new ChangelogSummarizer();

/**
 * Parse a conventional CHANGELOG.md into version sections.
 * Returns sections in the same order as they appear in the file (newest first).
 */
function parseChangelogSections(markdown: string): Array<{ version: string; body: string }> {
  const lines = markdown.split(/\r?\n/);
  const sections: Array<{ version: string; body: string }> = [];
  const headingRegex = /^##\s+([^\n]+)/; // capture heading text after '## '

  const versionFromHeading = (headingText: string): string | null => {
    const normalized = headingText.trim();
    if (/^unreleased$/i.test(normalized)) return null; // skip unreleased
    // Accept forms like 'v10.4.0', '10.4.0', '9.0.0-alpha.2'
    const match = normalized.match(/^v?([0-9]+(?:\.[0-9]+){1,2}(?:[-a-zA-Z0-9\.]+)?)\b/);
    return match ? match[1] : null;
  };

  type OpenSection = { version: string; startLine: number } | null;
  let open: OpenSection = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headingMatch = line.match(headingRegex);
    if (headingMatch) {
      const maybeVersion = versionFromHeading(headingMatch[1]);
      if (maybeVersion) {
        // close previous open section
        if (open) {
          const body = lines.slice(open.startLine, i).join("\n").trim();
          sections.push({ version: open.version, body });
        }
        open = { version: maybeVersion, startLine: i + 1 };
      }
    }
  }

  if (open) {
    const body = lines.slice(open.startLine).join("\n").trim();
    sections.push({ version: open.version, body });
  }

  return sections;
}

function normalizeVersion(input: string): string {
  return input.replace(/^v/i, "").trim();
}

function sliceSectionsBetween(
  sections: Array<{ version: string; body: string }>,
  fromVersionInput: string,
  toVersionInput: string
) {
  const fromVersion = normalizeVersion(fromVersionInput);
  const toVersion = normalizeVersion(toVersionInput);

  const indexOf = (v: string) => sections.findIndex((s) => s.version === v);
  let startIdx = indexOf(toVersion);
  let endIdx = indexOf(fromVersion);

  if (startIdx === -1 || endIdx === -1) {
    const missing = [startIdx === -1 ? toVersion : null, endIdx === -1 ? fromVersion : null]
      .filter(Boolean)
      .join(", ");
    throw new Error(`Version(s) not found in changelog: ${missing}`);
  }

  if (startIdx > endIdx) {
    // swap so startIdx <= endIdx (newest first ordering)
    const tmp = startIdx;
    startIdx = endIdx;
    endIdx = tmp;
  }

  // We want all versions > from and <= to in terms of file order (newest first),
  // which in index terms is [toIndex, fromIndex). Since file is newest-first,
  // that's indices [startIdx, endIdx). Ensure exclusivity of the lower bound.
  const inclusiveToExclusiveRange = sections.slice(startIdx, endIdx + 1);
  // Make lower bound exclusive by dropping the last element if it equals fromVersion
  const range = inclusiveToExclusiveRange.filter((s) => s.version !== fromVersion);

  return range;
}

export const getRepositoryChangelogTool = createTool({
  id: "get-repository-changelog",
  description: "Fetches and summarizes changelog/release information from a GitHub repository using GitHub CLI",
  inputSchema: z.object({
    owner: z.string().describe("Repository owner (username or organization)"),
    repo: z.string().describe("Repository name"),
    limit: z.number().default(10).describe("Number of releases to analyze (default: 10, max: 50)"),
    includePrerelease: z.boolean().default(false).describe("Include prerelease versions in analysis"),
  }),
  execute: async ({ context }) => {
    const { owner, repo, limit: requestedLimit, includePrerelease } = context;
    
    // Limit the number of releases to prevent excessive API calls
    const limit = Math.min(requestedLimit, 50);
    
    try {
      // Get releases using GitHub CLI
      const releases = await githubCLI.getRepositoryReleases(owner, repo, limit);
      
      // Filter out prereleases if not requested
      const filteredReleases = includePrerelease 
        ? releases 
        : releases.filter(release => !release.isPrerelease && !release.isDraft);

      if (filteredReleases.length === 0) {
        // Try to get tags if no releases found
        const tags = await githubCLI.getRepositoryTags(owner, repo, 10);
        
        return {
          success: true,
          repository: `${owner}/${repo}`,
          message: tags.length > 0 
            ? `No releases found, but repository has ${tags.length} tags. Consider looking at commit history or asking maintainers to create releases.`
            : "No releases or tags found for this repository.",
          releases: [],
          summary: null,
          tags: tags.slice(0, 5) // Show first 5 tags
        };
      }

      // Summarize the changelog
      const summary = changelogSummarizer.summarizeChangelog(filteredReleases);

      return {
        success: true,
        repository: `${owner}/${repo}`,
        releases: filteredReleases.map(release => ({
          tagName: release.tagName,
          name: release.name,
          publishedAt: release.publishedAt,
          url: release.url,
          isPrerelease: release.isPrerelease,
          bodyPreview: release.body?.substring(0, 200) + (release.body?.length > 200 ? '...' : '')
        })),
        summary,
        analyzed: {
          totalReleases: filteredReleases.length,
          includePrerelease,
          timeRange: filteredReleases.length > 1 ? {
            from: filteredReleases[filteredReleases.length - 1].publishedAt,
            to: filteredReleases[0].publishedAt
          } : null
        }
      };
    } catch (error) {
      return {
        success: false,
        repository: `${owner}/${repo}`,
        error: `Failed to fetch changelog: ${(error as Error).message}`,
        suggestion: "Make sure you have GitHub CLI installed and authenticated, and that the repository exists and is accessible."
      };
    }
  },
});

export const getLatestReleaseTool = createTool({
  id: "get-latest-release",
  description: "Fetches the latest release information from a GitHub repository using GitHub CLI",
  inputSchema: z.object({
    owner: z.string().describe("Repository owner (username or organization)"),
    repo: z.string().describe("Repository name"),
  }),
  execute: async ({ context }) => {
    const { owner, repo } = context;
    
    try {
      const release = await githubCLI.getLatestRelease(owner, repo);
      
      if (!release) {
        return {
          success: false,
          repository: `${owner}/${repo}`,
          message: "No releases found for this repository.",
        };
      }

      // Categorize changes in the latest release
      const categorized = new ChangelogSummarizer().categorizeChanges(release.body || '');

      return {
        success: true,
        repository: `${owner}/${repo}`,
        release: {
          tagName: release.tagName,
          name: release.name,
          body: release.body,
          publishedAt: release.publishedAt,
          url: release.url,
          isPrerelease: release.isPrerelease,
          isDraft: release.isDraft,
        },
        categorizedChanges: {
          breakingChanges: categorized.breakingChanges,
          features: categorized.features,
          bugFixes: categorized.bugFixes,
          other: categorized.other,
        },
        publishedDate: new Date(release.publishedAt).toLocaleDateString(),
      };
    } catch (error) {
      return {
        success: false,
        repository: `${owner}/${repo}`,
        error: `Failed to fetch latest release: ${(error as Error).message}`,
        suggestion: "Make sure you have GitHub CLI installed and authenticated, and that the repository exists and is accessible."
      };
    }
  },
});

export const summarizeChangelogBetweenVersionsTool = createTool({
  id: "summarize-changelog-between-versions",
  description:
    "Parses a local CHANGELOG.md and summarizes the changes between two versions (exclusive of fromVersion, inclusive of toVersion)",
  inputSchema: z.object({
    changelogPath: z
      .string()
      .default("CHANGELOG.md")
      .describe("Path to the CHANGELOG.md file"),
    fromVersion: z.string().describe("Lower bound version (excluded)"),
    toVersion: z.string().describe("Upper bound version (included)"),
  }),
  execute: async ({ context }) => {
    const { changelogPath, fromVersion, toVersion } = context as {
      changelogPath: string;
      fromVersion: string;
      toVersion: string;
    };

    try {
      const markdown = await readFile(changelogPath, "utf8");
      const sections = parseChangelogSections(markdown);
      const range = sliceSectionsBetween(sections, fromVersion, toVersion);

      if (range.length === 0) {
        return {
          success: true,
          changelogPath,
          range: { fromVersion, toVersion },
          includedVersions: [],
          summary: {
            totalReleases: 0,
            majorChanges: [],
            breakingChanges: [],
            features: [],
            bugFixes: [],
            summary: `No versions found between ${fromVersion} and ${toVersion}.`,
          },
        };
      }

      // Map sections to pseudo releases for reuse of summarizer
      const releases = range.map((s) => ({
        tagName: `v${s.version}`,
        name: s.version,
        body: s.body,
        publishedAt: "1970-01-01T00:00:00Z",
        url: "#",
        isDraft: false,
        isPrerelease: false,
      }));

      const summary = changelogSummarizer.summarizeChangelog(releases as any);

      return {
        success: true,
        changelogPath,
        range: { fromVersion, toVersion },
        includedVersions: releases.map((r) => r.name),
        summary,
      };
    } catch (error) {
      return {
        success: false,
        changelogPath,
        range: { fromVersion, toVersion },
        error: (error as Error).message,
      };
    }
  },
});
