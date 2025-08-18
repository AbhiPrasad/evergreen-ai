import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { readFile } from "fs/promises";

interface ParsedChangelogEntry {
  type: 'feat' | 'fix' | 'chore' | 'docs' | 'test' | 'refactor' | 'perf' | 'style' | 'ci' | 'build' | 'revert' | 'other';
  scope?: string;
  description: string;
  breaking: boolean;
  dependency?: string;
  rawText: string;
}

interface VersionSection {
  version: string;
  entries: ParsedChangelogEntry[];
  rawBody: string;
}

interface ChangelogSummary {
  affectedDependencies: string[];
  importantChanges: {
    breaking: ParsedChangelogEntry[];
    features: ParsedChangelogEntry[];
    fixes: ParsedChangelogEntry[];
    performance: ParsedChangelogEntry[];
    security: ParsedChangelogEntry[];
  };
  summary: string;
  versions: string[];
  filteredEntries: ParsedChangelogEntry[];
}

class DependencyChangelogAnalyzer {
  /**
   * Parse a conventional CHANGELOG.md into version sections.
   * Returns sections in the same order as they appear in the file (newest first).
   */
  private parseChangelogSections(markdown: string): VersionSection[] {
    const lines = markdown.split(/\r?\n/);
    const sections: VersionSection[] = [];
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
            const entries = this.parseChangelogEntries(body);
            sections.push({ version: open.version, entries, rawBody: body });
          }
          open = { version: maybeVersion, startLine: i + 1 };
        }
      }
    }

    if (open) {
      const body = lines.slice(open.startLine).join("\n").trim();
      const entries = this.parseChangelogEntries(body);
      sections.push({ version: open.version, entries, rawBody: body });
    }

    return sections;
  }

  /**
   * Parse individual changelog entries from a version section
   */
  private parseChangelogEntries(sectionBody: string): ParsedChangelogEntry[] {
    const lines = sectionBody.split('\n').filter(line => line.trim());
    const entries: ParsedChangelogEntry[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      
      // Skip markdown formatting, headers, and non-entry lines
      if (!trimmed || 
          trimmed.startsWith('#') || 
          trimmed.startsWith('<details') ||
          trimmed.startsWith('</details') ||
          trimmed.startsWith('<summary') ||
          trimmed.startsWith('</summary') ||
          trimmed.includes('Work in this release was contributed') ||
          trimmed.includes('Thank you for your contribution')) {
        continue;
      }

      // Parse conventional commit format: - type(scope): description
      const conventionalMatch = trimmed.match(/^-\s*(feat|fix|chore|docs|test|refactor|perf|style|ci|build|revert)(?:\(([^)]+)\))?\s*:\s*(.+)$/);
      
      if (conventionalMatch) {
        const [, type, scope, description] = conventionalMatch;
        const breaking = this.isBreakingChange(trimmed);
        const dependency = this.extractDependency(trimmed);
        
        entries.push({
          type: type as ParsedChangelogEntry['type'],
          scope,
          description,
          breaking,
          dependency,
          rawText: trimmed
        });
      } else if (trimmed.startsWith('-')) {
        // Parse other bullet point entries
        const description = trimmed.substring(1).trim();
        const breaking = this.isBreakingChange(description);
        const dependency = this.extractDependency(description);
        
        entries.push({
          type: 'other',
          description,
          breaking,
          dependency,
          rawText: trimmed
        });
      }
    }

    return entries;
  }

  /**
   * Check if a change is marked as breaking
   */
  private isBreakingChange(text: string): boolean {
    const lowerText = text.toLowerCase();
    return lowerText.includes('breaking') || 
           lowerText.includes('breaking change') ||
           lowerText.includes('!:') || // conventional commits breaking change marker
           lowerText.includes('major') ||
           lowerText.includes('incompatible');
  }

  /**
   * Extract dependency name from changelog entry
   */
  private extractDependency(text: string): string | undefined {
    // Look for common dependency patterns
    const patterns = [
      // Bump patterns: "Bump @package/name from x to y"
      /bump\s+(@?[\w-]+\/[\w-]+|\@[\w-]+|[\w-]+)\s+from/i,
      // Update patterns: "Update @package/name to x"
      /update\s+(@?[\w-]+\/[\w-]+|\@[\w-]+|[\w-]+)\s+to/i,
      // Package name in parentheses: feat(package-name):
      /\((@?[\w-]+\/[\w-]+|\@[\w-]+|[\w-]+)\)/,
      // Direct package mentions with @ symbol
      /(@[\w-]+\/[\w-]+|\@[\w-]+)/,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        return match[1];
      }
    }

    return undefined;
  }

  /**
   * Check if an entry is related to specified dependencies
   */
  private isRelevantToDependencies(entry: ParsedChangelogEntry, dependencies: string[]): boolean {
    if (dependencies.length === 0) return true; // No filter, include all

    const entryText = entry.rawText.toLowerCase();
    const entryScope = entry.scope?.toLowerCase();
    const entryDependency = entry.dependency?.toLowerCase();

    return dependencies.some(dep => {
      const depLower = dep.toLowerCase();
      return entryText.includes(depLower) ||
             entryScope === depLower ||
             entryDependency === depLower ||
             (entryDependency && entryDependency.includes(depLower));
    });
  }

  /**
   * Check if a change is considered important
   */
  private isImportantChange(entry: ParsedChangelogEntry): boolean {
    if (entry.breaking) return true;
    
    const importantTypes = ['feat', 'fix', 'perf'];
    if (importantTypes.includes(entry.type)) return true;

    const description = entry.description.toLowerCase();
    const importantKeywords = [
      'security', 'vulnerability', 'cve',
      'performance', 'memory', 'leak',
      'api', 'interface', 'public',
      'deprecat', 'remove', 'delete',
      'migrate', 'migration',
      'critical', 'urgent', 'hotfix'
    ];

    return importantKeywords.some(keyword => description.includes(keyword));
  }

  /**
   * Categorize entries by type and importance
   */
  private categorizeEntries(entries: ParsedChangelogEntry[]) {
    return {
      breaking: entries.filter(e => e.breaking),
      features: entries.filter(e => e.type === 'feat'),
      fixes: entries.filter(e => e.type === 'fix'),
      performance: entries.filter(e => e.type === 'perf' || 
        e.description.toLowerCase().includes('performance') ||
        e.description.toLowerCase().includes('memory') ||
        e.description.toLowerCase().includes('speed')),
      security: entries.filter(e => 
        e.description.toLowerCase().includes('security') ||
        e.description.toLowerCase().includes('vulnerability') ||
        e.description.toLowerCase().includes('cve'))
    };
  }

  /**
   * Generate human-readable summary
   */
  private generateSummary(
    versions: string[],
    filteredEntries: ParsedChangelogEntry[],
    categorized: ReturnType<typeof this.categorizeEntries>,
    affectedDependencies: string[]
  ): string {
    const versionRange = versions.length > 1 
      ? `${versions[versions.length - 1]} to ${versions[0]}`
      : versions[0];

    let summary = `## Changelog Summary (${versionRange})\n\n`;

    if (affectedDependencies.length > 0) {
      summary += `**🎯 Filtered for dependencies:** ${affectedDependencies.join(', ')}\n\n`;
    }

    summary += `**📊 Overview:**\n`;
    summary += `- **${filteredEntries.length}** total changes analyzed\n`;
    summary += `- **${versions.length}** versions included\n`;
    
    if (categorized.breaking.length > 0) {
      summary += `- **⚠️ ${categorized.breaking.length}** breaking changes\n`;
    }
    if (categorized.features.length > 0) {
      summary += `- **✨ ${categorized.features.length}** new features\n`;
    }
    if (categorized.fixes.length > 0) {
      summary += `- **🐛 ${categorized.fixes.length}** bug fixes\n`;
    }
    if (categorized.performance.length > 0) {
      summary += `- **⚡ ${categorized.performance.length}** performance improvements\n`;
    }
    if (categorized.security.length > 0) {
      summary += `- **🔒 ${categorized.security.length}** security updates\n`;
    }

    summary += '\n';

    // Breaking changes section
    if (categorized.breaking.length > 0) {
      summary += `### ⚠️ Breaking Changes\n`;
      categorized.breaking.slice(0, 5).forEach(entry => {
        summary += `- **${entry.scope || 'core'}**: ${entry.description}\n`;
      });
      summary += '\n';
    }

    // Important features
    if (categorized.features.length > 0) {
      summary += `### ✨ New Features\n`;
      categorized.features.slice(0, 5).forEach(entry => {
        summary += `- **${entry.scope || 'core'}**: ${entry.description}\n`;
      });
      summary += '\n';
    }

    // Security updates
    if (categorized.security.length > 0) {
      summary += `### 🔒 Security Updates\n`;
      categorized.security.forEach(entry => {
        summary += `- **${entry.scope || 'core'}**: ${entry.description}\n`;
      });
      summary += '\n';
    }

    // Performance improvements
    if (categorized.performance.length > 0) {
      summary += `### ⚡ Performance Improvements\n`;
      categorized.performance.slice(0, 3).forEach(entry => {
        summary += `- **${entry.scope || 'core'}**: ${entry.description}\n`;
      });
      summary += '\n';
    }

    summary += `### 💡 Impact Assessment\n`;
    if (categorized.breaking.length > 0) {
      summary += `**🚨 High Impact**: Breaking changes require code updates\n`;
    } else if (categorized.security.length > 0) {
      summary += `**🔶 Medium Impact**: Security updates recommend updating\n`;
    } else if (categorized.features.length > 0) {
      summary += `**🟢 Low Impact**: New features available, optional updates\n`;
    } else {
      summary += `**🟢 Low Impact**: Mostly maintenance and bug fixes\n`;
    }

    return summary;
  }

  /**
   * Get sections between two versions (exclusive of fromVersion, inclusive of toVersion)
   */
  private sliceSectionsBetween(
    sections: VersionSection[],
    fromVersionInput: string,
    toVersionInput: string
  ): VersionSection[] {
    const normalizeVersion = (input: string): string => {
      return input.replace(/^v/i, "").trim();
    };

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

  /**
   * Analyze changelog between versions with dependency filtering
   */
  analyzeChangelog(
    markdown: string,
    fromVersion: string,
    toVersion: string,
    dependencies: string[] = []
  ): ChangelogSummary {
    const sections = this.parseChangelogSections(markdown);
    const relevantSections = this.sliceSectionsBetween(sections, fromVersion, toVersion);

    // Collect all entries from relevant sections
    const allEntries = relevantSections.flatMap(section => section.entries);

    // Filter entries by dependencies if specified
    const filteredEntries = dependencies.length > 0
      ? allEntries.filter(entry => this.isRelevantToDependencies(entry, dependencies))
      : allEntries.filter(entry => this.isImportantChange(entry));

    // Get unique affected dependencies
    const affectedDependencies = [...new Set(
      filteredEntries
        .map(entry => entry.dependency)
        .filter(Boolean)
        .concat(dependencies.filter(dep => 
          allEntries.some(entry => this.isRelevantToDependencies(entry, [dep]))
        ))
    )].sort();

    // Categorize changes
    const categorized = this.categorizeEntries(filteredEntries);

    // Generate summary
    const versions = relevantSections.map(section => section.version);
    const summary = this.generateSummary(versions, filteredEntries, categorized, affectedDependencies);

    return {
      affectedDependencies,
      importantChanges: categorized,
      summary,
      versions,
      filteredEntries
    };
  }
}

export const dependencyChangelogSummarizerTool = createTool({
  id: "dependency-changelog-summarizer",
  description: "Analyzes a CHANGELOG.md between two versions and highlights important changes affecting specified dependencies",
  inputSchema: z.object({
    changelogPath: z
      .string()
      .default("CHANGELOG.md")
      .describe("Path to the CHANGELOG.md file"),
    fromVersion: z.string().describe("Lower bound version (excluded from analysis)"),
    toVersion: z.string().describe("Upper bound version (included in analysis)"),
    dependencies: z
      .array(z.string())
      .default([])
      .describe("List of dependencies to focus on (e.g., ['@sentry/core', '@sentry/node']). If empty, includes all important changes."),
    includeAllChanges: z
      .boolean()
      .default(false)
      .describe("Include all changes, not just important ones (only applies when dependencies list is empty)")
  }),
  execute: async ({ context }) => {
    const { changelogPath, fromVersion, toVersion, dependencies, includeAllChanges } = context;

    try {
      const markdown = await readFile(changelogPath, "utf8");
      const analyzer = new DependencyChangelogAnalyzer();
      
      // If no dependencies specified and includeAllChanges is true, pass all entries
      const effectiveDependencies = dependencies.length === 0 && includeAllChanges ? [] : dependencies;
      
      const analysis = analyzer.analyzeChangelog(
        markdown, 
        fromVersion, 
        toVersion, 
        effectiveDependencies
      );

      return {
        success: true,
        changelogPath,
        versionRange: { fromVersion, toVersion },
        dependencyFilter: dependencies,
        analysis: {
          affectedDependencies: analysis.affectedDependencies,
          totalChanges: analysis.filteredEntries.length,
          versionsAnalyzed: analysis.versions,
          breakingChanges: analysis.importantChanges.breaking.length,
          newFeatures: analysis.importantChanges.features.length,
          bugFixes: analysis.importantChanges.fixes.length,
          securityUpdates: analysis.importantChanges.security.length,
          performanceImprovements: analysis.importantChanges.performance.length,
        },
        summary: analysis.summary,
        detailedChanges: {
          breaking: analysis.importantChanges.breaking.map(e => ({
            scope: e.scope,
            description: e.description,
            dependency: e.dependency,
            rawText: e.rawText
          })),
          features: analysis.importantChanges.features.slice(0, 10).map(e => ({
            scope: e.scope,
            description: e.description,
            dependency: e.dependency,
            rawText: e.rawText
          })),
          fixes: analysis.importantChanges.fixes.slice(0, 10).map(e => ({
            scope: e.scope,
            description: e.description,
            dependency: e.dependency,
            rawText: e.rawText
          })),
          security: analysis.importantChanges.security.map(e => ({
            scope: e.scope,
            description: e.description,
            dependency: e.dependency,
            rawText: e.rawText
          })),
          performance: analysis.importantChanges.performance.map(e => ({
            scope: e.scope,
            description: e.description,
            dependency: e.dependency,
            rawText: e.rawText
          }))
        }
      };
    } catch (error) {
      return {
        success: false,
        changelogPath,
        versionRange: { fromVersion, toVersion },
        error: (error as Error).message,
        suggestion: error.message.includes('not found') 
          ? "Check that the specified versions exist in the changelog file"
          : "Ensure the changelog file exists and is properly formatted"
      };
    }
  },
});