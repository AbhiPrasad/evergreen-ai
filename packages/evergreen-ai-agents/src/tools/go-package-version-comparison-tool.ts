import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { fetchChangelogTool, type FetchChangelogOutput } from './fetch-changelog-tool';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

// Schema for Go version comparison results
const goVersionComparisonSchema = z.object({
  moduleName: z.string().describe('Name of the Go module being compared'),
  fromVersion: z.string().describe('Starting version for comparison'),
  toVersion: z.string().describe('Target version for comparison'),
  versionDifference: z.object({
    majorChange: z.boolean().describe('Whether this is a major version change'),
    minorChange: z.boolean().describe('Whether this is a minor version change'),
    patchChange: z.boolean().describe('Whether this is a patch version change'),
    prereleaseChange: z.boolean().describe('Whether this involves prerelease versions'),
    semverType: z.enum(['major', 'minor', 'patch', 'prerelease', 'unknown']).describe('Type of semantic version change'),
    versionDistance: z.number().describe('Number of versions between from and to'),
  }),
  moduleInfo: z.object({
    isStandardLibrary: z.boolean().describe('Whether this is a Go standard library module'),
    repositoryUrl: z.string().optional().describe('Repository URL if found'),
    latestVersion: z.string().optional().describe('Latest available version'),
    deprecated: z.boolean().describe('Whether the module is deprecated'),
    replacedBy: z.string().optional().describe('Module that replaces this one if deprecated'),
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
  goVersionRequirement: z.object({
    fromRequirement: z.string().optional().describe('Go version requirement for from version'),
    toRequirement: z.string().optional().describe('Go version requirement for to version'),
    requiresUpgrade: z.boolean().describe('Whether Go version upgrade is required'),
  }),
  upgradeComplexity: z.enum(['low', 'medium', 'high', 'unknown']).describe('Estimated complexity of the upgrade'),
  upgradeRecommendations: z.array(z.string()).describe('Specific recommendations for upgrading'),
  riskAssessment: z.object({
    level: z.enum(['low', 'medium', 'high', 'critical']).describe('Risk level of the upgrade'),
    factors: z.array(z.string()).describe('Factors contributing to the risk assessment'),
  }),
  compatibilityNotes: z.array(z.string()).describe('Go-specific compatibility considerations'),
});

export type GoPackageVersionComparison = z.infer<typeof goVersionComparisonSchema>;

/**
 * Tool for comparing Go module versions and analyzing upgrade impact
 */
export const goPackageVersionComparisonTool = createTool({
  id: 'go-package-version-comparison',
  description:
    'Compares two versions of a Go module and analyzes the upgrade impact, including breaking changes, Go version requirements, and upgrade recommendations',
  inputSchema: z.object({
    moduleName: z.string().describe('Name of the Go module to compare (e.g., "github.com/gin-gonic/gin")'),
    fromVersion: z.string().describe('Current/starting version (e.g., "v1.8.1")'),
    toVersion: z.string().describe('Target version to upgrade to (e.g., "v1.9.0")'),
    repositoryUrl: z
      .string()
      .optional()
      .describe('GitHub repository URL if module name lookup fails'),
    githubToken: z.string().optional().describe('GitHub token for API access (optional for public repos)'),
    includePrerelease: z.boolean().describe('Whether to consider prerelease versions').optional(),
  }),
  outputSchema: goVersionComparisonSchema,
  execute: async ({ context, runtimeContext }) => {
    const { moduleName, fromVersion, toVersion, repositoryUrl, githubToken, includePrerelease = false } = context;

    try {
      // 1. Analyze semantic version difference
      const versionDifference = analyzeGoVersionDifference(fromVersion, toVersion);

      // 2. Get module information from Go proxy and source
      const moduleInfo = await getGoModuleInfo(moduleName, toVersion, repositoryUrl);

      // 3. Try to find the repository for the module
      const repositoryInfo = await findGoModuleRepository(moduleName, repositoryUrl);

      let changelogData: FetchChangelogOutput | null = null;
      let breakingChanges: string[] = [];
      let newFeatures: string[] = [];
      let bugFixes: string[] = [];
      let deprecations: string[] = [];

      // 4. Fetch changelog if repository is found
      if (repositoryInfo) {
        try {
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
          const changeAnalysis = analyzeGoChangelogForUpgrade(changelogData.changelog);
          breakingChanges = changeAnalysis.breakingChanges;
          newFeatures = changeAnalysis.newFeatures;
          bugFixes = changeAnalysis.bugFixes;
          deprecations = changeAnalysis.deprecations;
        } catch (error) {
          console.warn(`Failed to fetch changelog for ${moduleName}:`, error);
        }
      }

      // 6. Check Go version requirements
      const goVersionRequirement = await analyzeGoVersionRequirements(moduleName, fromVersion, toVersion);

      // 7. Assess upgrade complexity and risk
      const upgradeComplexity = assessGoUpgradeComplexity(versionDifference, breakingChanges, newFeatures, goVersionRequirement);
      const riskAssessment = assessGoUpgradeRisk(versionDifference, breakingChanges, moduleName, goVersionRequirement);

      // 8. Generate Go-specific compatibility notes
      const compatibilityNotes = generateGoCompatibilityNotes(moduleName, versionDifference, goVersionRequirement);

      // 9. Generate upgrade recommendations
      const upgradeRecommendations = generateGoUpgradeRecommendations(
        moduleName,
        versionDifference,
        breakingChanges,
        newFeatures,
        deprecations,
        upgradeComplexity,
        goVersionRequirement,
      );

      return {
        moduleName,
        fromVersion,
        toVersion,
        versionDifference,
        moduleInfo,
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
        goVersionRequirement,
        upgradeComplexity,
        upgradeRecommendations,
        riskAssessment,
        compatibilityNotes,
      };
    } catch (error) {
      throw new Error(
        `Failed to compare Go module versions: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  },
});

/**
 * Analyze the semantic version difference between two Go module versions
 */
function analyzeGoVersionDifference(fromVersion: string, toVersion: string) {
  // Clean version strings (Go versions often have 'v' prefix)
  const cleanFrom = fromVersion.replace(/^v/, '');
  const cleanTo = toVersion.replace(/^v/, '');

  const fromParts = parseGoVersion(cleanFrom);
  const toParts = parseGoVersion(cleanTo);

  const majorChange = toParts.major !== fromParts.major;
  const minorChange = !majorChange && toParts.minor !== fromParts.minor;
  const patchChange = !majorChange && !minorChange && toParts.patch !== fromParts.patch;
  const prereleaseChange = fromParts.prerelease !== toParts.prerelease;

  let semverType: 'major' | 'minor' | 'patch' | 'prerelease' | 'unknown' = 'unknown';
  if (majorChange) semverType = 'major';
  else if (minorChange) semverType = 'minor';
  else if (patchChange) semverType = 'patch';
  else if (prereleaseChange) semverType = 'prerelease';

  // Calculate version distance (simplified)
  const versionDistance = Math.abs(
    (toParts.major - fromParts.major) * 1000000 +
    (toParts.minor - fromParts.minor) * 1000 +
    (toParts.patch - fromParts.patch)
  );

  return {
    majorChange,
    minorChange,
    patchChange,
    prereleaseChange,
    semverType,
    versionDistance,
  };
}

/**
 * Parse Go version string into components
 */
function parseGoVersion(version: string) {
  // Handle prerelease versions (e.g., "1.2.3-alpha.1", "1.2.3-rc1")
  const prereleaseMatch = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-(.+))?/);
  
  if (prereleaseMatch) {
    return {
      major: parseInt(prereleaseMatch[1]) || 0,
      minor: parseInt(prereleaseMatch[2]) || 0,
      patch: parseInt(prereleaseMatch[3]) || 0,
      prerelease: prereleaseMatch[4] || null,
    };
  }

  // Fallback for simpler versions
  const parts = version.split('.').map(part => parseInt(part.split('-')[0]) || 0);
  return {
    major: parts[0] || 0,
    minor: parts[1] || 0,
    patch: parts[2] || 0,
    prerelease: version.includes('-') ? version.split('-')[1] : null,
  };
}

/**
 * Get module information from Go proxy and other sources
 */
async function getGoModuleInfo(
  moduleName: string, 
  version: string, 
  repositoryUrl?: string
): Promise<GoPackageVersionComparison['moduleInfo']> {
  const moduleInfo = {
    isStandardLibrary: isStandardLibraryModule(moduleName),
    repositoryUrl,
    latestVersion: undefined as string | undefined,
    deprecated: false,
    replacedBy: undefined as string | undefined,
  };

  // Don't query proxy for standard library modules
  if (moduleInfo.isStandardLibrary) {
    return moduleInfo;
  }

  try {
    // Try to get info from Go module proxy
    const proxyUrl = `https://proxy.golang.org/${moduleName}/@latest`;
    const response = await fetch(proxyUrl);
    
    if (response.ok) {
      const data = await response.json();
      moduleInfo.latestVersion = data.Version;
    }
  } catch (error) {
    // Ignore proxy errors
  }

  try {
    // Try to get repository URL from go mod download if not provided
    if (!repositoryUrl) {
      const { stdout } = await execAsync(`go list -m -json ${moduleName}@${version}`, { timeout: 10000 });
      const modInfo = JSON.parse(stdout);
      
      if (modInfo.Origin && modInfo.Origin.VCS === 'git' && modInfo.Origin.URL) {
        moduleInfo.repositoryUrl = modInfo.Origin.URL;
      }

      // Check for deprecation or replacement
      if (modInfo.Deprecated) {
        moduleInfo.deprecated = true;
      }
    }
  } catch (error) {
    // Ignore go list errors
  }

  return moduleInfo;
}

/**
 * Check if module is part of Go standard library
 */
function isStandardLibraryModule(moduleName: string): boolean {
  // Standard library modules don't have dots in their names (except for some special cases)
  // and don't start with a domain name
  return !moduleName.includes('.') || 
         moduleName.startsWith('golang.org/x/') ||
         ['context', 'crypto', 'database', 'encoding', 'fmt', 'net', 'os', 'strings'].includes(moduleName.split('/')[0]);
}

/**
 * Find repository information for a Go module
 */
async function findGoModuleRepository(
  moduleName: string,
  repositoryUrl?: string,
): Promise<{ owner: string; repo: string } | null> {
  if (repositoryUrl) {
    const match = repositoryUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
    if (match) {
      return { owner: match[1], repo: match[2].replace(/\.git$/, '') };
    }
  }

  // For GitHub modules, extract owner/repo from module path
  if (moduleName.startsWith('github.com/')) {
    const parts = moduleName.split('/');
    if (parts.length >= 3) {
      return { owner: parts[1], repo: parts[2] };
    }
  }

  // For other hosting platforms, could add similar logic
  // For now, return null for non-GitHub modules without explicit repository URL
  return null;
}

/**
 * Get the default branch for a GitHub repository
 */
async function getDefaultBranch(owner: string, repo: string, githubToken?: string): Promise<string> {
  try {
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
 * Analyze changelog content for Go-specific upgrade information
 */
function analyzeGoChangelogForUpgrade(changelogSections: Array<{ version?: string; content: string }>) {
  const breakingChanges: string[] = [];
  const newFeatures: string[] = [];
  const bugFixes: string[] = [];
  const deprecations: string[] = [];

  for (const section of changelogSections) {
    const lines = section.content.split('\n').filter(line => line.trim());

    for (const line of lines) {
      const lowerLine = line.toLowerCase();

      // Go-specific breaking changes patterns
      if (
        lowerLine.includes('breaking') ||
        lowerLine.includes('breaking change') ||
        lowerLine.includes('removed') ||
        lowerLine.includes('incompatible') ||
        lowerLine.match(/\b(drop|dropped|remove|removed)\b.*support/) ||
        lowerLine.includes('api change') ||
        lowerLine.includes('signature change')
      ) {
        breakingChanges.push(line.trim());
      }

      // Go-specific new features
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
        lowerLine.includes('marked for removal')
      ) {
        deprecations.push(line.trim());
      }
    }
  }

  return {
    breakingChanges: [...new Set(breakingChanges)],
    newFeatures: [...new Set(newFeatures)],
    bugFixes: [...new Set(bugFixes)],
    deprecations: [...new Set(deprecations)],
  };
}

/**
 * Analyze Go version requirements for the module versions
 */
async function analyzeGoVersionRequirements(
  moduleName: string, 
  fromVersion: string, 
  toVersion: string
): Promise<GoPackageVersionComparison['goVersionRequirement']> {
  const result = {
    fromRequirement: undefined as string | undefined,
    toRequirement: undefined as string | undefined,
    requiresUpgrade: false,
  };

  try {
    // Get go.mod info for both versions
    const fromInfo = await getModuleGoVersion(moduleName, fromVersion);
    const toInfo = await getModuleGoVersion(moduleName, toVersion);

    result.fromRequirement = fromInfo;
    result.toRequirement = toInfo;

    // Check if Go version upgrade is required
    if (fromInfo && toInfo && compareGoVersions(toInfo, fromInfo) > 0) {
      result.requiresUpgrade = true;
    }
  } catch (error) {
    // Ignore errors in Go version analysis
  }

  return result;
}

/**
 * Get Go version requirement for a specific module version
 */
async function getModuleGoVersion(moduleName: string, version: string): Promise<string | undefined> {
  try {
    const { stdout } = await execAsync(`go mod download -json ${moduleName}@${version}`, { timeout: 10000 });
    const modInfo = JSON.parse(stdout);
    
    // Go version is typically found in the go.mod file
    if (modInfo.GoMod) {
      // Parse go.mod content for go directive
      const goModContent = modInfo.GoMod;
      const goVersionMatch = goModContent.match(/go\s+(\d+\.\d+(?:\.\d+)?)/);
      if (goVersionMatch) {
        return goVersionMatch[1];
      }
    }
  } catch (error) {
    // Ignore errors
  }

  return undefined;
}

/**
 * Compare Go version strings
 */
function compareGoVersions(version1: string, version2: string): number {
  const v1Parts = version1.split('.').map(Number);
  const v2Parts = version2.split('.').map(Number);

  for (let i = 0; i < Math.max(v1Parts.length, v2Parts.length); i++) {
    const v1Part = v1Parts[i] || 0;
    const v2Part = v2Parts[i] || 0;

    if (v1Part > v2Part) return 1;
    if (v1Part < v2Part) return -1;
  }

  return 0;
}

/**
 * Assess the complexity of a Go module upgrade
 */
function assessGoUpgradeComplexity(
  versionDiff: { majorChange: boolean; minorChange: boolean; patchChange: boolean },
  breakingChanges: string[],
  newFeatures: string[],
  goVersionReq: { requiresUpgrade: boolean },
): 'low' | 'medium' | 'high' | 'unknown' {
  // Go version requirement upgrade increases complexity
  if (goVersionReq.requiresUpgrade) {
    return 'high';
  }

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
 * Assess the risk of a Go module upgrade
 */
function assessGoUpgradeRisk(
  versionDiff: { majorChange: boolean; minorChange: boolean; semverType: string },
  breakingChanges: string[],
  moduleName: string,
  goVersionReq: { requiresUpgrade: boolean },
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

  // Go version requirement risk
  if (goVersionReq.requiresUpgrade) {
    riskScore += 2;
    factors.push('Requires Go version upgrade');
  }

  // Critical Go modules
  const criticalModules = [
    'github.com/gin-gonic/gin',
    'github.com/gorilla/mux',
    'github.com/labstack/echo',
    'github.com/gofiber/fiber',
    'github.com/stretchr/testify',
    'gorm.io/gorm',
    'go.uber.org/zap',
  ];

  if (criticalModules.some(mod => moduleName.includes(mod))) {
    riskScore += 2;
    factors.push('Critical framework/library dependency');
  }

  // Standard library or x/ packages (generally stable)
  if (moduleName.startsWith('golang.org/x/') || !moduleName.includes('.')) {
    riskScore -= 1;
    factors.push('Official Go extended library (generally stable)');
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
 * Generate Go-specific compatibility notes
 */
function generateGoCompatibilityNotes(
  moduleName: string,
  versionDiff: { majorChange: boolean; minorChange: boolean },
  goVersionReq: { fromRequirement?: string; toRequirement?: string; requiresUpgrade: boolean },
): string[] {
  const notes: string[] = [];

  if (goVersionReq.requiresUpgrade && goVersionReq.toRequirement) {
    notes.push(`Go ${goVersionReq.toRequirement} or later is required for the target version.`);
  }

  if (versionDiff.majorChange) {
    notes.push('Major version changes in Go modules may include significant API changes.');
    notes.push('Review import paths - major version changes may require /v2, /v3, etc. suffixes.');
  }

  // Module-specific notes
  if (moduleName.includes('gorm')) {
    notes.push('GORM upgrades often include database migration considerations.');
  }

  if (moduleName.includes('gin') || moduleName.includes('echo') || moduleName.includes('fiber')) {
    notes.push('Web framework upgrades may affect middleware compatibility and routing behavior.');
  }

  if (moduleName.includes('testify')) {
    notes.push('Test framework changes may require updating test assertions and mocking patterns.');
  }

  if (moduleName.startsWith('golang.org/x/')) {
    notes.push('This is an official Go extended library with generally stable APIs.');
  }

  return notes;
}

/**
 * Generate specific upgrade recommendations for Go modules
 */
function generateGoUpgradeRecommendations(
  moduleName: string,
  versionDiff: { majorChange: boolean; minorChange: boolean; semverType: string },
  breakingChanges: string[],
  newFeatures: string[],
  deprecations: string[],
  complexity: string,
  goVersionReq: { requiresUpgrade: boolean; toRequirement?: string },
): string[] {
  const recommendations: string[] = [];

  // Go version upgrade recommendations
  if (goVersionReq.requiresUpgrade) {
    recommendations.push(`Upgrade Go to version ${goVersionReq.toRequirement} or later before upgrading this module.`);
    recommendations.push('Update your go.mod file to specify the new Go version requirement.');
  }

  // General upgrade strategy
  if (versionDiff.majorChange) {
    recommendations.push('This is a major version upgrade. Review all breaking changes carefully before upgrading.');
    recommendations.push('Check if import paths need to be updated (e.g., /v2, /v3 suffixes for major versions).');
    recommendations.push('Consider upgrading in a separate branch and testing thoroughly.');
  } else if (versionDiff.minorChange) {
    recommendations.push('This is a minor version upgrade. Review new features and any behavioral changes.');
  } else {
    recommendations.push('This is a patch version upgrade. Should be relatively safe to upgrade.');
  }

  // Breaking changes recommendations
  if (breakingChanges.length > 0) {
    recommendations.push(`Review and address ${breakingChanges.length} breaking changes before upgrading.`);
    recommendations.push('Search your codebase for usage patterns that may be affected by breaking changes.');
    recommendations.push('Use `go build` and `go test` to identify compilation issues after upgrade.');
  }

  // Deprecation recommendations
  if (deprecations.length > 0) {
    recommendations.push(`Address ${deprecations.length} deprecations to future-proof your code.`);
    recommendations.push('Plan to migrate away from deprecated APIs in upcoming releases.');
  }

  // Testing recommendations
  if (complexity === 'high') {
    recommendations.push('Run comprehensive tests: `go test ./...` for the entire module tree.');
    recommendations.push('Consider running race detection tests: `go test -race ./...`');
    recommendations.push('Test with different build tags if your code uses them.');
    recommendations.push('Have a rollback plan ready in case issues are discovered.');
  } else if (complexity === 'medium') {
    recommendations.push('Run your existing test suite: `go test ./...`');
    recommendations.push('Add tests for any new features you plan to use.');
  } else {
    recommendations.push('Run your existing test suite to ensure no regressions: `go test ./...`');
  }

  // Go-specific recommendations
  recommendations.push('Use `go mod tidy` after upgrading to clean up dependencies.');
  recommendations.push('Check for any new indirect dependencies with `go list -m all`');
  
  if (versionDiff.majorChange) {
    recommendations.push('Verify that `go mod verify` passes after the upgrade.');
  }

  // Module-specific recommendations
  if (moduleName.includes('gin') || moduleName.includes('echo') || moduleName.includes('fiber')) {
    recommendations.push('Test all HTTP endpoints and middleware after upgrading web framework.');
  } else if (moduleName.includes('gorm')) {
    recommendations.push('Test database operations and check for any migration requirements.');
  } else if (moduleName.includes('testify')) {
    recommendations.push('Run all tests and check for any assertion or mocking changes.');
  }

  // New features recommendations
  if (newFeatures.length > 0) {
    recommendations.push(`Consider adopting ${newFeatures.length} new features to improve your codebase.`);
  }

  return recommendations;
}