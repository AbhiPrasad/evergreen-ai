import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { fetchChangelogTool, type FetchChangelogOutput } from '../fetch-changelog-tool';

// Schema for Ruby gem version comparison results
const rubyVersionComparisonSchema = z.object({
  gemName: z.string().describe('Name of the gem being compared'),
  fromVersion: z.string().describe('Starting version for comparison'),
  toVersion: z.string().describe('Target version for comparison'),
  versionDifference: z.object({
    majorChange: z.boolean().describe('Whether this is a major version change'),
    minorChange: z.boolean().describe('Whether this is a minor version change'),
    patchChange: z.boolean().describe('Whether this is a patch version change'),
    semverType: z.enum(['major', 'minor', 'patch', 'prerelease', 'unknown']).describe('Type of semantic version change'),
    isPessimisticCompatible: z.boolean().describe('Whether upgrade is compatible with pessimistic operator (~>)'),
    pessimisticConstraint: z.string().describe('Recommended pessimistic constraint for the target version'),
  }),
  rubygemsInfo: z.object({
    gemExists: z.boolean().describe('Whether gem exists on RubyGems.org'),
    homepage: z.string().nullable().describe('Gem homepage URL'),
    sourceCodeUri: z.string().nullable().describe('Source code repository URL'),
    changelogUri: z.string().nullable().describe('Changelog URL'),
    documentationUri: z.string().nullable().describe('Documentation URL'),
    downloads: z.number().nullable().describe('Total download count'),
    currentVersion: z.string().nullable().describe('Latest version on RubyGems.org'),
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
  rubyCompatibility: z.object({
    requiredRubyVersion: z.string().nullable().describe('Required Ruby version for target gem version'),
    rubyVersionChanges: z.array(z.string()).describe('Changes in Ruby version requirements'),
  }),
  upgradeComplexity: z.enum(['low', 'medium', 'high', 'unknown']).describe('Estimated complexity of the upgrade'),
  upgradeRecommendations: z.array(z.string()).describe('Specific recommendations for upgrading'),
  riskAssessment: z.object({
    level: z.enum(['low', 'medium', 'high', 'critical']).describe('Risk level of the upgrade'),
    factors: z.array(z.string()).describe('Factors contributing to the risk assessment'),
  }),
});

export type RubyVersionComparison = z.infer<typeof rubyVersionComparisonSchema>;

/**
 * Tool for comparing Ruby gem versions and analyzing upgrade impact
 */
export const rubyPackageVersionComparisonTool = createTool({
  id: 'ruby-package-version-comparison',
  description:
    'Compares two versions of a Ruby gem and analyzes the upgrade impact, including breaking changes, new features, and upgrade recommendations',
  inputSchema: z.object({
    gemName: z.string().describe('Name of the gem to compare (e.g., "rails", "nokogiri")'),
    fromVersion: z.string().describe('Current/starting version (e.g., "6.1.7")'),
    toVersion: z.string().describe('Target version to upgrade to (e.g., "7.0.0")'),
    repositoryUrl: z
      .string()
      .optional()
      .describe('GitHub repository URL if gem name lookup fails (e.g., "https://github.com/rails/rails")'),
    githubToken: z.string().optional().describe('GitHub token for API access (optional for public repos)'),
  }),
  outputSchema: rubyVersionComparisonSchema,
  execute: async ({ context, runtimeContext }) => {
    const { gemName, fromVersion, toVersion, repositoryUrl, githubToken } = context;

    try {
      // 1. Analyze semantic version difference
      const versionDifference = analyzeVersionDifference(fromVersion, toVersion);

      // 2. Fetch gem information from RubyGems.org
      const rubygemsInfo = await fetchGemInfo(gemName);

      // 3. Try to find the repository for the gem
      const repositoryInfo = await findGemRepository(gemName, repositoryUrl, rubygemsInfo.sourceCodeUri);

      let changelogData: FetchChangelogOutput | null = null;
      let breakingChanges: string[] = [];
      let newFeatures: string[] = [];
      let bugFixes: string[] = [];
      let deprecations: string[] = [];

      // 4. Fetch changelog if repository is found
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

          // 5. Parse changelog for specific types of changes
          const changeAnalysis = analyzeChangelogForUpgrade(changelogData.changelog);
          breakingChanges = changeAnalysis.breakingChanges;
          newFeatures = changeAnalysis.newFeatures;
          bugFixes = changeAnalysis.bugFixes;
          deprecations = changeAnalysis.deprecations;
        } catch (error) {
          // Changelog analysis failed, continue with basic analysis
          console.warn(`Failed to fetch changelog for ${gemName}:`, error);
        }
      }

      // 6. Analyze Ruby version compatibility
      const rubyCompatibility = await analyzeRubyCompatibility(gemName, toVersion, rubygemsInfo);

      // 7. Assess upgrade complexity and risk
      const upgradeComplexity = assessUpgradeComplexity(versionDifference, breakingChanges, newFeatures, rubyCompatibility);
      const riskAssessment = assessUpgradeRisk(versionDifference, breakingChanges, gemName, rubyCompatibility);

      // 8. Generate upgrade recommendations
      const upgradeRecommendations = generateUpgradeRecommendations(
        gemName,
        versionDifference,
        breakingChanges,
        newFeatures,
        deprecations,
        upgradeComplexity,
        rubyCompatibility,
      );

      return {
        gemName,
        fromVersion,
        toVersion,
        versionDifference,
        rubygemsInfo,
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
        rubyCompatibility,
        upgradeComplexity,
        upgradeRecommendations,
        riskAssessment,
      };
    } catch (error) {
      throw new Error(
        `Failed to compare gem versions: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  },
});

/**
 * Analyze the semantic version difference between two Ruby gem versions
 */
function analyzeVersionDifference(fromVersion: string, toVersion: string) {
  const cleanFrom = fromVersion.replace(/^v/, '');
  const cleanTo = toVersion.replace(/^v/, '');

  const fromParts = cleanFrom.split('.').map(part => {
    const numPart = part.split('-')[0];
    return parseInt(numPart) || 0;
  });
  
  const toParts = cleanTo.split('.').map(part => {
    const numPart = part.split('-')[0];
    return parseInt(numPart) || 0;
  });

  const fromMajor = fromParts[0] || 0;
  const fromMinor = fromParts[1] || 0;
  const fromPatch = fromParts[2] || 0;

  const toMajor = toParts[0] || 0;
  const toMinor = toParts[1] || 0;
  const toPatch = toParts[2] || 0;

  const majorChange = toMajor !== fromMajor;
  const minorChange = !majorChange && toMinor !== fromMinor;
  const patchChange = !majorChange && !minorChange && toPatch !== fromPatch;

  let semverType: 'major' | 'minor' | 'patch' | 'prerelease' | 'unknown' = 'unknown';
  if (majorChange) semverType = 'major';
  else if (minorChange) semverType = 'minor';
  else if (patchChange) semverType = 'patch';
  else if (cleanTo.includes('-') || cleanFrom.includes('-')) semverType = 'prerelease';

  // Check pessimistic operator compatibility
  // ~> 1.2.3 is compatible with 1.2.x but not 1.3.x
  // ~> 1.2 is compatible with 1.x but not 2.x
  const isPessimisticCompatible = !majorChange && (fromParts.length <= 2 ? true : !minorChange);
  
  // Generate recommended pessimistic constraint
  let pessimisticConstraint = '';
  if (toParts.length >= 2) {
    pessimisticConstraint = `~> ${toMajor}.${toMinor}`;
    if (toParts.length >= 3 && toPatch > 0) {
      pessimisticConstraint = `~> ${toMajor}.${toMinor}.${toPatch}`;
    }
  }

  return {
    majorChange,
    minorChange,
    patchChange,
    semverType,
    isPessimisticCompatible,
    pessimisticConstraint,
  };
}

/**
 * Fetch gem information from RubyGems.org API
 */
async function fetchGemInfo(gemName: string) {
  const result = {
    gemExists: false,
    homepage: null as string | null,
    sourceCodeUri: null as string | null,
    changelogUri: null as string | null,
    documentationUri: null as string | null,
    downloads: null as number | null,
    currentVersion: null as string | null,
  };

  try {
    const response = await fetch(`https://rubygems.org/api/v1/gems/${gemName}.json`);
    if (response.ok) {
      const gemInfo = await response.json();
      result.gemExists = true;
      result.homepage = gemInfo.homepage_uri;
      result.sourceCodeUri = gemInfo.source_code_uri;
      result.changelogUri = gemInfo.changelog_uri;
      result.documentationUri = gemInfo.documentation_uri;
      result.downloads = gemInfo.downloads;
      result.currentVersion = gemInfo.version;
    }
  } catch (error) {
    // Failed to fetch gem info
  }

  return result;
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
    // If we can't get the default branch, fall back to common defaults
  }

  // Common Ruby project default branches
  return 'main';
}

/**
 * Find repository information for a gem
 */
async function findGemRepository(
  gemName: string,
  repositoryUrl?: string,
  sourceCodeUri?: string | null,
): Promise<{ owner: string; repo: string } | null> {
  // Try provided repository URL first
  if (repositoryUrl) {
    const match = repositoryUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
    if (match) {
      return { owner: match[1], repo: match[2].replace(/\.git$/, '') };
    }
  }

  // Try source code URI from RubyGems
  if (sourceCodeUri) {
    const match = sourceCodeUri.match(/github\.com\/([^\/]+)\/([^\/]+)/);
    if (match) {
      return { owner: match[1], repo: match[2].replace(/\.git$/, '') };
    }
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
    const lines = section.content.split('\n').filter(line => line.trim());

    for (const line of lines) {
      const lowerLine = line.toLowerCase();

      // Breaking changes
      if (
        lowerLine.includes('breaking') ||
        lowerLine.includes('breaking change') ||
        lowerLine.includes('removed') ||
        lowerLine.includes('incompatible') ||
        lowerLine.match(/\b(drop|dropped|remove|removed)\b.*support/) ||
        lowerLine.includes('backwards incompatible')
      ) {
        breakingChanges.push(line.trim());
      }

      // New features
      else if (
        lowerLine.includes('add') ||
        lowerLine.includes('new') ||
        lowerLine.includes('feature') ||
        lowerLine.includes('enhance') ||
        lowerLine.includes('implement') ||
        lowerLine.match(/^\s*[\-\*]\s*(add|new|feature|enhance|implement)/)
      ) {
        newFeatures.push(line.trim());
      }

      // Bug fixes
      else if (
        lowerLine.includes('fix') ||
        lowerLine.includes('bug') ||
        lowerLine.includes('resolve') ||
        lowerLine.includes('correct') ||
        lowerLine.match(/^\s*[\-\*]\s*(fix|bug|resolve|correct)/)
      ) {
        bugFixes.push(line.trim());
      }

      // Deprecations
      else if (
        lowerLine.includes('deprecat') ||
        lowerLine.includes('obsolete') ||
        lowerLine.includes('will be removed') ||
        lowerLine.includes('end of life')
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
 * Analyze Ruby version compatibility requirements
 */
async function analyzeRubyCompatibility(gemName: string, version: string, rubygemsInfo: any) {
  const result = {
    requiredRubyVersion: null as string | null,
    rubyVersionChanges: [] as string[],
  };

  try {
    // Try to get version-specific info from RubyGems API
    const response = await fetch(`https://rubygems.org/api/v1/gems/${gemName}/versions/${version}.json`);
    if (response.ok) {
      const versionInfo = await response.json();
      
      // Look for Ruby version requirements
      if (versionInfo.requirements && versionInfo.requirements.ruby) {
        result.requiredRubyVersion = versionInfo.requirements.ruby;
      }
    }
  } catch (error) {
    // Failed to fetch version-specific info
  }

  return result;
}

/**
 * Assess the complexity of a Ruby gem upgrade
 */
function assessUpgradeComplexity(
  versionDiff: { majorChange: boolean; minorChange: boolean; patchChange: boolean },
  breakingChanges: string[],
  newFeatures: string[],
  rubyCompatibility: { requiredRubyVersion: string | null; rubyVersionChanges: string[] },
): 'low' | 'medium' | 'high' | 'unknown' {
  if (versionDiff.majorChange || breakingChanges.length > 0 || rubyCompatibility.rubyVersionChanges.length > 0) {
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
 * Assess the risk of a Ruby gem upgrade
 */
function assessUpgradeRisk(
  versionDiff: { majorChange: boolean; minorChange: boolean; semverType: string },
  breakingChanges: string[],
  gemName: string,
  rubyCompatibility: { requiredRubyVersion: string | null; rubyVersionChanges: string[] },
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

  // Ruby version compatibility risk
  if (rubyCompatibility.rubyVersionChanges.length > 0) {
    riskScore += 2;
    factors.push('Ruby version requirement changes');
  }

  // Critical gem risk
  const criticalGems = ['rails', 'activerecord', 'activesupport', 'actionpack', 'bundler', 'rake', 'nokogiri'];
  if (criticalGems.some(gem => gemName.includes(gem))) {
    riskScore += 2;
    factors.push('Critical framework/core dependency');
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
  gemName: string,
  versionDiff: { majorChange: boolean; minorChange: boolean; semverType: string; pessimisticConstraint: string },
  breakingChanges: string[],
  newFeatures: string[],
  deprecations: string[],
  complexity: string,
  rubyCompatibility: { requiredRubyVersion: string | null },
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

  // Pessimistic operator recommendation
  if (versionDiff.pessimisticConstraint) {
    recommendations.push(`Consider using pessimistic constraint: gem '${gemName}', '${versionDiff.pessimisticConstraint}'`);
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

  // Ruby version compatibility
  if (rubyCompatibility.requiredRubyVersion) {
    recommendations.push(`Ensure your Ruby version meets the requirement: ${rubyCompatibility.requiredRubyVersion}`);
  }

  // Testing recommendations
  if (complexity === 'high') {
    recommendations.push('Run comprehensive tests including unit, integration, and system tests.');
    recommendations.push('Consider setting up a staging environment to test the upgrade.');
    recommendations.push('Have a rollback plan ready in case issues are discovered.');
    recommendations.push('Run bundle audit to check for security vulnerabilities after upgrade.');
  } else if (complexity === 'medium') {
    recommendations.push('Run your existing test suite and add tests for any new features you plan to use.');
    recommendations.push('Check for any deprecation warnings in your logs.');
  } else {
    recommendations.push('Run your existing test suite to ensure no regressions.');
  }

  // Gem-specific recommendations
  if (gemName.includes('rails')) {
    recommendations.push('Review Rails upgrade guides for version-specific changes.');
    recommendations.push('Check that all installed gems are compatible with the new Rails version.');
    recommendations.push('Update config/application.rb and other configuration files as needed.');
  } else if (gemName.includes('nokogiri')) {
    recommendations.push('Check for any native dependency compilation issues.');
    recommendations.push('Verify XML/HTML parsing behavior with your existing code.');
  } else if (gemName.includes('activerecord')) {
    recommendations.push('Review database migrations and model code for compatibility.');
    recommendations.push('Test database queries thoroughly, especially complex ones.');
  }

  // New features recommendations
  if (newFeatures.length > 0) {
    recommendations.push(`Consider adopting ${newFeatures.length} new features to improve your codebase.`);
  }

  // General Ruby best practices
  recommendations.push('Update your Gemfile.lock by running bundle update after the upgrade.');
  recommendations.push('Consider running bundle outdated to check other gems for updates.');

  return recommendations;
}