import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { fetchChangelogTool, type FetchChangelogOutput } from '../fetch-changelog-tool';

// Schema for Python version comparison results
const pythonVersionComparisonSchema = z.object({
  packageName: z.string().describe('Name of the Python package being compared'),
  fromVersion: z.string().describe('Starting version for comparison'),
  toVersion: z.string().describe('Target version for comparison'),
  versionDifference: z.object({
    majorChange: z.boolean().describe('Whether this is a major version change'),
    minorChange: z.boolean().describe('Whether this is a minor version change'),
    patchChange: z.boolean().describe('Whether this is a patch version change'),
    preReleaseChange: z.boolean().describe('Whether this involves pre-release versions'),
    semverType: z.enum(['major', 'minor', 'patch', 'prerelease', 'unknown']).describe('Type of semantic version change'),
    pep440Compliant: z.boolean().describe('Whether versions are PEP 440 compliant'),
  }),
  pypiInfo: z.object({
    packageExists: z.boolean().describe('Whether the package exists on PyPI'),
    latestVersion: z.string().optional().describe('Latest version available on PyPI'),
    projectUrl: z.string().optional().describe('Project URL from PyPI'),
    repositoryUrl: z.string().optional().describe('Repository URL from PyPI'),
    description: z.string().optional().describe('Package description from PyPI'),
    maintainer: z.string().optional().describe('Package maintainer from PyPI'),
    pythonVersions: z.array(z.string()).describe('Supported Python versions'),
    license: z.string().optional().describe('Package license'),
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
  securityFixes: z.array(z.string()).describe('Detected security fixes from changelog'),
  upgradeComplexity: z.enum(['low', 'medium', 'high', 'unknown']).describe('Estimated complexity of the upgrade'),
  upgradeRecommendations: z.array(z.string()).describe('Specific recommendations for upgrading'),
  riskAssessment: z.object({
    level: z.enum(['low', 'medium', 'high', 'critical']).describe('Risk level of the upgrade'),
    factors: z.array(z.string()).describe('Factors contributing to the risk assessment'),
  }),
  pythonCompatibility: z.object({
    currentRequirement: z.string().optional().describe('Current Python version requirement'),
    newRequirement: z.string().optional().describe('New Python version requirement'),
    isCompatible: z.boolean().describe('Whether the upgrade maintains Python compatibility'),
    droppedVersions: z.array(z.string()).describe('Python versions no longer supported'),
  }),
});

export type PythonPackageVersionComparison = z.infer<typeof pythonVersionComparisonSchema>;

/**
 * Tool for comparing Python package versions and analyzing upgrade impact
 */
export const pythonPackageVersionComparisonTool = createTool({
  id: 'python-package-version-comparison',
  description:
    'Compares two versions of a Python package and analyzes the upgrade impact, including breaking changes, new features, and Python compatibility',
  inputSchema: z.object({
    packageName: z.string().describe('Name of the Python package to compare (e.g., "django", "numpy")'),
    fromVersion: z.string().describe('Current/starting version (e.g., "4.1.0")'),
    toVersion: z.string().describe('Target version to upgrade to (e.g., "5.0.0")'),
    repositoryUrl: z
      .string()
      .optional()
      .describe('GitHub repository URL if package name lookup fails (e.g., "https://github.com/django/django")'),
    githubToken: z.string().optional().describe('GitHub token for API access (optional for public repos)'),
  }),
  outputSchema: pythonVersionComparisonSchema,
  execute: async ({ context, runtimeContext }) => {
    const { packageName, fromVersion, toVersion, repositoryUrl, githubToken } = context;

    try {
      // 1. Analyze semantic version difference with PEP 440 compliance
      const versionDifference = analyzePythonVersionDifference(fromVersion, toVersion);

      // 2. Get PyPI information
      const pypiInfo = await fetchPyPIInfo(packageName);

      // 3. Try to find the repository for the package
      const repositoryInfo = await findPackageRepository(packageName, repositoryUrl, pypiInfo);

      let changelogData: FetchChangelogOutput | null = null;
      let breakingChanges: string[] = [];
      let newFeatures: string[] = [];
      let bugFixes: string[] = [];
      let deprecations: string[] = [];
      let securityFixes: string[] = [];

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
          const changeAnalysis = analyzePythonChangelogForUpgrade(changelogData.changelog);
          breakingChanges = changeAnalysis.breakingChanges;
          newFeatures = changeAnalysis.newFeatures;
          bugFixes = changeAnalysis.bugFixes;
          deprecations = changeAnalysis.deprecations;
          securityFixes = changeAnalysis.securityFixes;
        } catch (error) {
          console.warn(`Failed to fetch changelog for ${packageName}:`, error);
        }
      }

      // 6. Assess Python compatibility
      const pythonCompatibility = assessPythonCompatibility(pypiInfo, fromVersion, toVersion);

      // 7. Assess upgrade complexity and risk
      const upgradeComplexity = assessPythonUpgradeComplexity(versionDifference, breakingChanges, newFeatures, pythonCompatibility);
      const riskAssessment = assessPythonUpgradeRisk(versionDifference, breakingChanges, packageName, pythonCompatibility);

      // 8. Generate upgrade recommendations
      const upgradeRecommendations = generatePythonUpgradeRecommendations(
        packageName,
        versionDifference,
        breakingChanges,
        newFeatures,
        deprecations,
        securityFixes,
        upgradeComplexity,
        pythonCompatibility,
      );

      return {
        packageName,
        fromVersion,
        toVersion,
        versionDifference,
        pypiInfo,
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
        securityFixes,
        upgradeComplexity,
        upgradeRecommendations,
        riskAssessment,
        pythonCompatibility,
      };
    } catch (error) {
      throw new Error(
        `Failed to compare Python package versions: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  },
});

/**
 * Analyze Python version difference with PEP 440 compliance
 */
function analyzePythonVersionDifference(fromVersion: string, toVersion: string) {
  // Clean versions and check PEP 440 compliance
  const cleanFrom = normalizeVersion(fromVersion);
  const cleanTo = normalizeVersion(toVersion);

  const pep440Compliant = isPEP440Compliant(fromVersion) && isPEP440Compliant(toVersion);

  // Parse versions according to PEP 440
  const fromParts = parseVersion(cleanFrom);
  const toParts = parseVersion(cleanTo);

  const majorChange = fromParts.major !== toParts.major;
  const minorChange = !majorChange && fromParts.minor !== toParts.minor;
  const patchChange = !majorChange && !minorChange && fromParts.patch !== toParts.patch;
  const preReleaseChange = fromParts.prerelease !== toParts.prerelease;

  let semverType: 'major' | 'minor' | 'patch' | 'prerelease' | 'unknown' = 'unknown';
  if (majorChange) semverType = 'major';
  else if (minorChange) semverType = 'minor';
  else if (patchChange) semverType = 'patch';
  else if (preReleaseChange) semverType = 'prerelease';

  return {
    majorChange,
    minorChange,
    patchChange,
    preReleaseChange,
    semverType,
    pep440Compliant,
  };
}

/**
 * Normalize version string for parsing
 */
function normalizeVersion(version: string): string {
  return version.replace(/^v/, '').trim();
}

/**
 * Check if version is PEP 440 compliant
 */
function isPEP440Compliant(version: string): boolean {
  // Simplified PEP 440 regex - covers most common cases
  const pep440Regex = /^(\d+!)?\d+(\.\d+)*((a|b|rc)\d+)?(\.post\d+)?(\.dev\d+)?$/;
  return pep440Regex.test(normalizeVersion(version));
}

/**
 * Parse version string into components
 */
function parseVersion(version: string) {
  const cleanVersion = normalizeVersion(version);
  
  // Extract epoch (if present)
  let epoch = '';
  let versionPart = cleanVersion;
  if (cleanVersion.includes('!')) {
    [epoch, versionPart] = cleanVersion.split('!');
  }

  // Extract pre-release, post-release, and dev components
  let prerelease = '';
  let postrelease = '';
  let dev = '';

  // Extract dev version
  if (versionPart.includes('.dev')) {
    const devMatch = versionPart.match(/\.dev\d+$/);
    if (devMatch) {
      dev = devMatch[0];
      versionPart = versionPart.replace(devMatch[0], '');
    }
  }

  // Extract post version
  if (versionPart.includes('.post')) {
    const postMatch = versionPart.match(/\.post\d+$/);
    if (postMatch) {
      postrelease = postMatch[0];
      versionPart = versionPart.replace(postMatch[0], '');
    }
  }

  // Extract pre-release (alpha, beta, release candidate)
  const prereleaseMatch = versionPart.match(/(a|b|rc)\d+$/);
  if (prereleaseMatch) {
    prerelease = prereleaseMatch[0];
    versionPart = versionPart.replace(prereleaseMatch[0], '');
  }

  // Parse main version numbers
  const parts = versionPart.split('.').map(part => parseInt(part) || 0);
  const major = parts[0] || 0;
  const minor = parts[1] || 0;
  const patch = parts[2] || 0;

  return {
    epoch,
    major,
    minor,
    patch,
    prerelease: prerelease || null,
    postrelease: postrelease || null,
    dev: dev || null,
  };
}

/**
 * Fetch package information from PyPI
 */
async function fetchPyPIInfo(packageName: string) {
  try {
    const response = await fetch(`https://pypi.org/pypi/${packageName}/json`);
    
    if (!response.ok) {
      return {
        packageExists: false,
        pythonVersions: [],
      };
    }

    const data = await response.json();
    const info = data.info;
    const urls = data.urls || [];

    // Extract repository URL from project URLs
    let repositoryUrl: string | undefined;
    if (info.project_urls) {
      repositoryUrl = info.project_urls['Source'] || 
                    info.project_urls['Repository'] || 
                    info.project_urls['Homepage'];
    }
    repositoryUrl = repositoryUrl || info.home_page || info.download_url;

    // Extract Python version classifiers
    const pythonVersions: string[] = [];
    if (info.classifiers) {
      for (const classifier of info.classifiers) {
        const match = classifier.match(/Programming Language :: Python :: ([0-9.]+)/);
        if (match) {
          pythonVersions.push(match[1]);
        }
      }
    }

    return {
      packageExists: true,
      latestVersion: info.version,
      projectUrl: info.project_url,
      repositoryUrl,
      description: info.summary,
      maintainer: info.maintainer || info.author,
      pythonVersions: pythonVersions.sort(),
      license: info.license,
    };
  } catch (error) {
    return {
      packageExists: false,
      pythonVersions: [],
    };
  }
}

/**
 * Get the default branch for a GitHub repository
 */
async function getDefaultBranch(owner: string, repo: string, githubToken?: string): Promise<string> {
  try {
    const authToken = githubToken || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_ACCESS_TOKEN;

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
 * Find repository information for a Python package
 */
async function findPackageRepository(
  packageName: string,
  repositoryUrl?: string,
  pypiInfo?: any,
): Promise<{ owner: string; repo: string } | null> {
  // First try provided repository URL
  if (repositoryUrl) {
    const match = repositoryUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
    if (match) {
      return { owner: match[1], repo: match[2].replace(/\.git$/, '') };
    }
  }

  // Then try PyPI info
  if (pypiInfo?.repositoryUrl) {
    const match = pypiInfo.repositoryUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
    if (match) {
      return { owner: match[1], repo: match[2].replace(/\.git$/, '') };
    }
  }

  return null;
}

/**
 * Analyze changelog content for Python upgrade-relevant information
 */
function analyzePythonChangelogForUpgrade(changelogSections: Array<{ version?: string; content: string }>) {
  const breakingChanges: string[] = [];
  const newFeatures: string[] = [];
  const bugFixes: string[] = [];
  const deprecations: string[] = [];
  const securityFixes: string[] = [];

  for (const section of changelogSections) {
    const lines = section.content.split('\n').filter(line => line.trim());

    for (const line of lines) {
      const lowerLine = line.toLowerCase();

      // Breaking changes
      if (
        lowerLine.includes('breaking') ||
        lowerLine.includes('breaking change') ||
        lowerLine.includes('backwards incompatible') ||
        lowerLine.includes('removed') ||
        lowerLine.includes('incompatible') ||
        lowerLine.match(/\b(drop|dropped|remove|removed)\b.*support/) ||
        lowerLine.includes('no longer') ||
        lowerLine.includes('changed behavior')
      ) {
        breakingChanges.push(line.trim());
      }

      // Security fixes
      else if (
        lowerLine.includes('security') ||
        lowerLine.includes('cve-') ||
        lowerLine.includes('vulnerability') ||
        lowerLine.includes('exploit') ||
        lowerLine.includes('csrf') ||
        lowerLine.includes('xss') ||
        lowerLine.includes('injection')
      ) {
        securityFixes.push(line.trim());
      }

      // New features
      else if (
        lowerLine.includes('add') ||
        lowerLine.includes('new') ||
        lowerLine.includes('feature') ||
        lowerLine.includes('enhance') ||
        lowerLine.includes('support for') ||
        lowerLine.match(/^\s*[\-\*]\s*(add|new|feature|enhance)/)
      ) {
        newFeatures.push(line.trim());
      }

      // Bug fixes
      else if (
        lowerLine.includes('fix') ||
        lowerLine.includes('bug') ||
        lowerLine.includes('resolve') ||
        lowerLine.includes('correct') ||
        lowerLine.match(/^\s*[\-\*]\s*(fix|bug|resolve)/)
      ) {
        bugFixes.push(line.trim());
      }

      // Deprecations
      else if (
        lowerLine.includes('deprecat') ||
        lowerLine.includes('obsolete') ||
        lowerLine.includes('will be removed') ||
        lowerLine.includes('planned removal') ||
        lowerLine.includes('discouraged')
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
    securityFixes: [...new Set(securityFixes)],
  };
}

/**
 * Assess Python compatibility between versions
 */
function assessPythonCompatibility(pypiInfo: any, fromVersion: string, toVersion: string) {
  const currentRequirement = pypiInfo?.pythonVersions ? `>=${pypiInfo.pythonVersions[0]}` : undefined;
  
  // This is a simplified assessment - in practice, you'd need version-specific data
  const isCompatible = true; // Default assumption
  const droppedVersions: string[] = [];

  return {
    currentRequirement,
    newRequirement: currentRequirement, // Simplified - would need specific version data
    isCompatible,
    droppedVersions,
  };
}

/**
 * Assess the complexity of a Python upgrade
 */
function assessPythonUpgradeComplexity(
  versionDiff: { majorChange: boolean; minorChange: boolean; patchChange: boolean },
  breakingChanges: string[],
  newFeatures: string[],
  pythonCompatibility: any,
): 'low' | 'medium' | 'high' | 'unknown' {
  if (versionDiff.majorChange || breakingChanges.length > 0 || !pythonCompatibility.isCompatible) {
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
 * Assess the risk of a Python upgrade
 */
function assessPythonUpgradeRisk(
  versionDiff: { majorChange: boolean; minorChange: boolean; semverType: string },
  breakingChanges: string[],
  packageName: string,
  pythonCompatibility: any,
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

  // Python compatibility risk
  if (!pythonCompatibility.isCompatible) {
    riskScore += 2;
    factors.push('Python version compatibility issues detected');
  }

  // Critical Python packages risk
  const criticalPackages = [
    'django', 'flask', 'fastapi', 'requests', 'numpy', 'pandas', 'sqlalchemy',
    'pytest', 'celery', 'gunicorn', 'uwsgi', 'pillow', 'psycopg2', 'mysqlclient'
  ];
  
  if (criticalPackages.some(pkg => packageName.includes(pkg))) {
    riskScore += 2;
    factors.push('Critical framework/library dependency');
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
 * Generate specific upgrade recommendations for Python packages
 */
function generatePythonUpgradeRecommendations(
  packageName: string,
  versionDiff: { majorChange: boolean; minorChange: boolean; semverType: string },
  breakingChanges: string[],
  newFeatures: string[],
  deprecations: string[],
  securityFixes: string[],
  complexity: string,
  pythonCompatibility: any,
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

  // Security recommendations
  if (securityFixes.length > 0) {
    recommendations.push(`This upgrade includes ${securityFixes.length} security fixes. Upgrading is strongly recommended.`);
    recommendations.push('Security updates should be prioritized and deployed as soon as possible.');
  }

  // Breaking changes recommendations
  if (breakingChanges.length > 0) {
    recommendations.push(`Review and address ${breakingChanges.length} breaking changes before upgrading.`);
    recommendations.push('Search your codebase for usage patterns that may be affected by breaking changes.');
    recommendations.push('Consider using automated refactoring tools if available for this package.');
  }

  // Deprecation recommendations
  if (deprecations.length > 0) {
    recommendations.push(`Address ${deprecations.length} deprecations to future-proof your code.`);
    recommendations.push('Plan to migrate away from deprecated APIs in upcoming releases.');
  }

  // Python compatibility recommendations
  if (!pythonCompatibility.isCompatible) {
    recommendations.push('Verify Python version compatibility before upgrading.');
    recommendations.push('Consider upgrading Python version if required by the new package version.');
  }

  // Testing recommendations
  if (complexity === 'high') {
    recommendations.push('Run comprehensive tests including unit, integration, and end-to-end tests.');
    recommendations.push('Set up a staging environment to test the upgrade.');
    recommendations.push('Have a rollback plan ready in case issues are discovered.');
    recommendations.push('Consider gradual rollout if this is a production system.');
  } else if (complexity === 'medium') {
    recommendations.push('Run your existing test suite and add tests for any new features you plan to use.');
    recommendations.push('Test in a development environment first.');
  } else {
    recommendations.push('Run your existing test suite to ensure no regressions.');
  }

  // Package-specific recommendations
  if (packageName.includes('django')) {
    recommendations.push('Check Django documentation for migration guides and breaking changes.');
    recommendations.push('Run Django system checks after upgrading.');
    recommendations.push('Test database migrations in a non-production environment first.');
  } else if (packageName.includes('flask')) {
    recommendations.push('Check Flask extensions compatibility with the new version.');
    recommendations.push('Test all routes and middleware after upgrading.');
  } else if (packageName.includes('requests')) {
    recommendations.push('Test all HTTP requests and ensure SSL/TLS settings still work correctly.');
  } else if (packageName.includes('numpy') || packageName.includes('pandas')) {
    recommendations.push('Test data processing pipelines thoroughly for numerical accuracy.');
    recommendations.push('Check for performance regressions in data operations.');
  } else if (packageName.includes('sqlalchemy')) {
    recommendations.push('Test all database queries and ORM operations.');
    recommendations.push('Check connection pooling and transaction handling.');
  } else if (packageName.includes('pytest')) {
    recommendations.push('Verify all test plugins are compatible with the new pytest version.');
    recommendations.push('Check for changes in test discovery or reporting.');
  }

  // Virtual environment recommendations
  recommendations.push('Perform the upgrade in a virtual environment first before updating production.');
  recommendations.push('Document the upgrade process and any issues encountered for future reference.');

  // New features recommendations
  if (newFeatures.length > 0) {
    recommendations.push(`Consider adopting ${newFeatures.length} new features to improve your codebase.`);
    recommendations.push('Review new features for potential performance improvements or simplified code.');
  }

  return recommendations;
}