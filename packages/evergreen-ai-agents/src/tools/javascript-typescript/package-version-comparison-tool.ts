import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { fetchChangelogTool, type FetchChangelogOutput } from '../fetch-changelog-tool';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

// Schema for version comparison results
const versionComparisonSchema = z.object({
  packageName: z.string().describe('Name of the package being compared'),
  fromVersion: z.string().describe('Starting version for comparison'),
  toVersion: z.string().describe('Target version for comparison'),
  versionDifference: z.object({
    majorChange: z.boolean().describe('Whether this is a major version change'),
    minorChange: z.boolean().describe('Whether this is a minor version change'),
    patchChange: z.boolean().describe('Whether this is a patch version change'),
    semverType: z.enum(['major', 'minor', 'patch', 'unknown']).describe('Type of semantic version change'),
  }),
  changelog: z.object({
    hasChangelog: z.boolean().describe('Whether changelog information was found'),
    relevantSections: z
      .array(
        z.object({
          version: z.string().optional(),
          content: z.string(),
          prLinks: z.array(
            z.object({
              number: z.string(),
              url: z.string(),
              type: z.enum(['pr', 'issue']),
            }),
          ),
        }),
      )
      .describe('Changelog sections relevant to the version range'),
    sourceFile: z.string().optional().describe('Source changelog file used'),
    repository: z.string().optional().describe('Repository where changelog was found'),
  }),
  breakingChanges: z.array(z.string()).describe('Detected breaking changes from changelog'),
  newFeatures: z.array(z.string()).describe('Detected new features from changelog'),
  bugFixes: z.array(z.string()).describe('Detected bug fixes from changelog'),
  deprecations: z.array(z.string()).describe('Detected deprecations from changelog'),
  upgradeComplexity: z.enum(['low', 'medium', 'high', 'unknown']).describe('Estimated complexity of the upgrade'),
  upgradeRecommendations: z.array(z.string()).describe('Specific recommendations for upgrading'),
  riskAssessment: z.object({
    level: z.enum(['low', 'medium', 'high', 'critical']).describe('Risk level of the upgrade'),
    factors: z.array(z.string()).describe('Factors contributing to the risk assessment'),
  }),
});

export type PackageVersionComparison = z.infer<typeof versionComparisonSchema>;

/**
 * Tool for comparing package versions and analyzing upgrade impact
 */
export const packageVersionComparisonTool = createTool({
  id: 'package-version-comparison',
  description:
    'Compares two versions of a package and analyzes the upgrade impact, including breaking changes, new features, and upgrade recommendations',
  inputSchema: z.object({
    packageName: z.string().describe('Name of the package to compare (e.g., "lodash", "react")'),
    fromVersion: z.string().describe('Current/starting version (e.g., "4.17.21")'),
    toVersion: z.string().describe('Target version to upgrade to (e.g., "5.0.0")'),
    repositoryUrl: z
      .string()
      .optional()
      .describe('GitHub repository URL if package name lookup fails (e.g., "https://github.com/lodash/lodash")'),
    githubToken: z.string().optional().describe('GitHub token for API access (optional for public repos)'),
  }),
  outputSchema: versionComparisonSchema,
  execute: async ({ context, runtimeContext }) => {
    const { packageName, fromVersion, toVersion, repositoryUrl, githubToken } = context;

    try {
      // 1. Analyze semantic version difference
      const versionDifference = analyzeVersionDifference(fromVersion, toVersion);

      // 2. Try to find the repository for the package
      const repositoryInfo = await findPackageRepository(packageName, repositoryUrl);

      let changelogData: FetchChangelogOutput | null = null;
      let breakingChanges: string[] = [];
      let newFeatures: string[] = [];
      let bugFixes: string[] = [];
      let deprecations: string[] = [];

      // 3. Fetch changelog if repository is found
      if (repositoryInfo) {
        try {
          // First, get the default branch for the repository
          const defaultBranch = await getDefaultBranch(repositoryInfo.owner, repositoryInfo.repo, githubToken);

          changelogData = await fetchChangelogTool.execute({
            context: {
              owner: repositoryInfo.owner,
              repo: repositoryInfo.repo,
              branch: defaultBranch,
              fromVersion: fromVersion,
              toVersion: toVersion,
              githubToken,
            },
            runtimeContext,
          });

          // 4. Parse changelog for specific types of changes
          const changeAnalysis = analyzeChangelogForUpgrade(changelogData.changelog);
          breakingChanges = changeAnalysis.breakingChanges;
          newFeatures = changeAnalysis.newFeatures;
          bugFixes = changeAnalysis.bugFixes;
          deprecations = changeAnalysis.deprecations;
        } catch (error) {
          // Changelog analysis failed, continue with basic analysis
          console.warn(`Failed to fetch changelog for ${packageName}:`, error);
        }
      }

      // 5. Assess upgrade complexity and risk
      const upgradeComplexity = assessUpgradeComplexity(versionDifference, breakingChanges, newFeatures);
      const riskAssessment = assessUpgradeRisk(versionDifference, breakingChanges, packageName);

      // 6. Generate upgrade recommendations
      const upgradeRecommendations = generateUpgradeRecommendations(
        packageName,
        versionDifference,
        breakingChanges,
        newFeatures,
        deprecations,
        upgradeComplexity,
      );

      return {
        packageName,
        fromVersion,
        toVersion,
        versionDifference,
        changelog: {
          hasChangelog: changelogData !== null,
          relevantSections:
            changelogData?.changelog.map(section => ({
              version: section.version,
              content: section.content,
              prLinks: section.prLinks,
            })) || [],
          sourceFile: changelogData?.sourceFile,
          repository: changelogData?.repository,
        },
        breakingChanges,
        newFeatures,
        bugFixes,
        deprecations,
        upgradeComplexity,
        upgradeRecommendations,
        riskAssessment,
      };
    } catch (error) {
      throw new Error(
        `Failed to compare package versions: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  },
});

/**
 * Analyze the semantic version difference between two versions
 */
function analyzeVersionDifference(fromVersion: string, toVersion: string) {
  const cleanFrom = fromVersion.replace(/^v/, '');
  const cleanTo = toVersion.replace(/^v/, '');

  const fromParts = cleanFrom.split('.').map(part => parseInt(part.split('-')[0]) || 0);
  const toParts = cleanTo.split('.').map(part => parseInt(part.split('-')[0]) || 0);

  const fromMajor = fromParts[0] || 0;
  const fromMinor = fromParts[1] || 0;
  const fromPatch = fromParts[2] || 0;

  const toMajor = toParts[0] || 0;
  const toMinor = toParts[1] || 0;
  const toPatch = toParts[2] || 0;

  const majorChange = toMajor !== fromMajor;
  const minorChange = !majorChange && toMinor !== fromMinor;
  const patchChange = !majorChange && !minorChange && toPatch !== fromPatch;

  let semverType: 'major' | 'minor' | 'patch' | 'unknown' = 'unknown';
  if (majorChange) semverType = 'major';
  else if (minorChange) semverType = 'minor';
  else if (patchChange) semverType = 'patch';

  return {
    majorChange,
    minorChange,
    patchChange,
    semverType,
  };
}

/**
 * Get the default branch for a GitHub repository
 */
async function getDefaultBranch(owner: string, repo: string, githubToken?: string): Promise<string> {
  try {
    // Get auth token from parameter or environment variables
    const authToken =
      githubToken || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_ACCESS_TOKEN;

    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: authToken ? { Authorization: `token ${authToken}` } : {},
    });

    if (response.ok) {
      const repoInfo = await response.json();
      return repoInfo.default_branch || 'main';
    }
  } catch (error) {
    // If we can't get the default branch, fall back to 'main'
  }

  return 'main';
}

/**
 * Find repository information for a package
 */
async function findPackageRepository(
  packageName: string,
  repositoryUrl?: string,
): Promise<{ owner: string; repo: string } | null> {
  if (repositoryUrl) {
    const match = repositoryUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
    if (match) {
      return { owner: match[1], repo: match[2].replace(/\.git$/, '') };
    }
  }

  try {
    // Try to get repository info from npm registry
    const response = await fetch(`https://registry.npmjs.org/${packageName}`);
    if (response.ok) {
      const packageInfo = await response.json();
      const repoUrl = packageInfo.repository?.url || packageInfo.homepage;

      if (repoUrl) {
        const match = repoUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
        if (match) {
          return { owner: match[1], repo: match[2].replace(/\.git$/, '') };
        }
      }
    }
  } catch (error) {
    // Failed to fetch from npm registry
  }

  return null;
}

/**
 * Analyze changelog content for upgrade-relevant information
 */
function analyzeChangelogForUpgrade(changelogSections: Array<{ version?: string; content: string }>) {
  const breakingChanges: string[] = [];
  const newFeatures: string[] = [];
  const bugFixes: string[] = [];
  const deprecations: string[] = [];

  for (const section of changelogSections) {
    const content = section.content.toLowerCase();
    const lines = section.content.split('\n').filter(line => line.trim());

    for (const line of lines) {
      const lowerLine = line.toLowerCase();

      // Breaking changes
      if (
        lowerLine.includes('breaking') ||
        lowerLine.includes('breaking change') ||
        lowerLine.includes('removed') ||
        lowerLine.includes('incompatible') ||
        lowerLine.match(/\b(drop|dropped|remove|removed)\b.*support/)
      ) {
        breakingChanges.push(line.trim());
      }

      // New features
      else if (
        lowerLine.includes('add') ||
        lowerLine.includes('new') ||
        lowerLine.includes('feature') ||
        lowerLine.includes('enhance') ||
        lowerLine.match(/^\s*[\-\*]\s*(add|new|feature|enhance)/)
      ) {
        newFeatures.push(line.trim());
      }

      // Bug fixes
      else if (
        lowerLine.includes('fix') ||
        lowerLine.includes('bug') ||
        lowerLine.includes('resolve') ||
        lowerLine.match(/^\s*[\-\*]\s*(fix|bug|resolve)/)
      ) {
        bugFixes.push(line.trim());
      }

      // Deprecations
      else if (
        lowerLine.includes('deprecat') ||
        lowerLine.includes('obsolete') ||
        lowerLine.includes('will be removed')
      ) {
        deprecations.push(line.trim());
      }
    }
  }

  return {
    breakingChanges: [...new Set(breakingChanges)], // Remove duplicates
    newFeatures: [...new Set(newFeatures)],
    bugFixes: [...new Set(bugFixes)],
    deprecations: [...new Set(deprecations)],
  };
}

/**
 * Assess the complexity of an upgrade
 */
function assessUpgradeComplexity(
  versionDiff: { majorChange: boolean; minorChange: boolean; patchChange: boolean },
  breakingChanges: string[],
  newFeatures: string[],
): 'low' | 'medium' | 'high' | 'unknown' {
  if (versionDiff.majorChange || breakingChanges.length > 0) {
    return 'high';
  }

  if (versionDiff.minorChange || newFeatures.length > 3) {
    return 'medium';
  }

  if (versionDiff.patchChange) {
    return 'low';
  }

  return 'unknown';
}

/**
 * Assess the risk of an upgrade
 */
function assessUpgradeRisk(
  versionDiff: { majorChange: boolean; minorChange: boolean; semverType: string },
  breakingChanges: string[],
  packageName: string,
): { level: 'low' | 'medium' | 'high' | 'critical'; factors: string[] } {
  const factors: string[] = [];
  let riskScore = 0;

  // Version change risk
  if (versionDiff.majorChange) {
    riskScore += 3;
    factors.push('Major version change detected');
  } else if (versionDiff.minorChange) {
    riskScore += 1;
    factors.push('Minor version change');
  }

  // Breaking changes risk
  if (breakingChanges.length > 0) {
    riskScore += breakingChanges.length;
    factors.push(`${breakingChanges.length} breaking changes detected`);
  }

  // Critical package risk
  const criticalPackages = ['react', 'vue', 'angular', 'express', 'webpack', 'typescript', 'babel'];
  if (criticalPackages.some(pkg => packageName.includes(pkg))) {
    riskScore += 2;
    factors.push('Critical framework/build tool dependency');
  }

  // Determine risk level
  let level: 'low' | 'medium' | 'high' | 'critical';
  if (riskScore >= 5) {
    level = 'critical';
  } else if (riskScore >= 3) {
    level = 'high';
  } else if (riskScore >= 1) {
    level = 'medium';
  } else {
    level = 'low';
  }

  return { level, factors };
}

/**
 * Generate specific upgrade recommendations
 */
function generateUpgradeRecommendations(
  packageName: string,
  versionDiff: { majorChange: boolean; minorChange: boolean; semverType: string },
  breakingChanges: string[],
  newFeatures: string[],
  deprecations: string[],
  complexity: string,
): string[] {
  const recommendations: string[] = [];

  // General upgrade strategy
  if (versionDiff.majorChange) {
    recommendations.push('This is a major version upgrade. Review all breaking changes carefully before upgrading.');
    recommendations.push('Consider upgrading in a separate branch and testing thoroughly.');
    recommendations.push('Update any code that depends on deprecated or removed APIs.');
  } else if (versionDiff.minorChange) {
    recommendations.push('This is a minor version upgrade. Review new features and any behavioral changes.');
  } else {
    recommendations.push('This is a patch version upgrade. Should be relatively safe to upgrade.');
  }

  // Breaking changes recommendations
  if (breakingChanges.length > 0) {
    recommendations.push(`Review and address ${breakingChanges.length} breaking changes before upgrading.`);
    recommendations.push('Search your codebase for usage patterns that may be affected by breaking changes.');
  }

  // Deprecation recommendations
  if (deprecations.length > 0) {
    recommendations.push(`Address ${deprecations.length} deprecations to future-proof your code.`);
    recommendations.push('Plan to migrate away from deprecated APIs in upcoming releases.');
  }

  // Testing recommendations
  if (complexity === 'high') {
    recommendations.push('Run comprehensive tests including unit, integration, and end-to-end tests.');
    recommendations.push('Consider setting up a staging environment to test the upgrade.');
    recommendations.push('Have a rollback plan ready in case issues are discovered.');
  } else if (complexity === 'medium') {
    recommendations.push('Run your existing test suite and add tests for any new features you plan to use.');
  } else {
    recommendations.push('Run your existing test suite to ensure no regressions.');
  }

  // Package-specific recommendations
  if (packageName.includes('react')) {
    recommendations.push('Check React DevTools compatibility and update if needed.');
    recommendations.push('Review component lifecycle changes and hooks usage.');
  } else if (packageName.includes('typescript')) {
    recommendations.push('Check for TypeScript compilation errors and type definition updates.');
    recommendations.push('Review tsconfig.json settings for any new compiler options.');
  } else if (packageName.includes('webpack')) {
    recommendations.push('Review webpack configuration for any breaking changes.');
    recommendations.push('Test build process and bundle output thoroughly.');
  }

  // New features recommendations
  if (newFeatures.length > 0) {
    recommendations.push(`Consider adopting ${newFeatures.length} new features to improve your codebase.`);
  }

  return recommendations;
}
