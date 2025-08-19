import { describe, it, expect, vi, beforeEach } from 'vitest';
import { packageVersionComparisonTool } from './package-version-comparison-tool';

// Mock the fetch function for npm registry calls
global.fetch = vi.fn();

// Mock the child_process.exec function
vi.mock('node:child_process', () => ({
  exec: vi.fn(),
}));

// Mock the fetchChangelogTool
vi.mock('./fetch-changelog-tool', () => ({
  fetchChangelogTool: {
    execute: vi.fn(),
  },
}));

describe('packageVersionComparisonTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should analyze semantic version differences correctly', async () => {
    // Mock npm registry response for madge
    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          repository: {
            url: 'https://github.com/pahen/madge.git',
          },
        }),
      })
      // Mock GitHub API response for default branch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          default_branch: 'main',
        }),
      });

    // Mock changelog fetch
    const { fetchChangelogTool } = await import('./fetch-changelog-tool');
    (fetchChangelogTool.execute as any).mockResolvedValueOnce({
      changelog: [
        {
          version: '6.0.0',
          content: `## Breaking Changes
- Removed deprecated API methods
- Changed default behavior for circular detection
- Updated minimum Node.js version requirement

## New Features  
- Added ESM support
- Improved performance for large codebases
- New CLI options for better control`,
          prLinks: [],
        },
      ],
      totalSections: 1,
      filteredSections: 1,
      sourceFile: 'CHANGELOG.md',
      repository: 'pahen/madge',
    });

    const result = await packageVersionComparisonTool.execute({
      context: {
        packageName: 'madge',
        fromVersion: '5.0.1',
        toVersion: '6.0.0',
      },
      runtimeContext: {},
    });

    expect(result.packageName).toBe('madge');
    expect(result.fromVersion).toBe('5.0.1');
    expect(result.toVersion).toBe('6.0.0');
    expect(result.versionDifference.majorChange).toBe(true);
    expect(result.versionDifference.semverType).toBe('major');
    expect(result.upgradeComplexity).toBe('high');
    expect(result.riskAssessment.level).toBe('critical');
    expect(result.breakingChanges).toContain('- Removed deprecated API methods');
    expect(result.newFeatures).toContain('- Added ESM support');
    expect(result.upgradeRecommendations).toContain(
      'This is a major version upgrade. Review all breaking changes carefully before upgrading.',
    );
  });

  it('should handle minor version upgrades with lower complexity', async () => {
    // Mock npm registry response
    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          repository: {
            url: 'https://github.com/example/package.git',
          },
        }),
      })
      // Mock GitHub API response for default branch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          default_branch: 'main',
        }),
      });

    // Mock changelog with minor changes
    const { fetchChangelogTool } = await import('./fetch-changelog-tool');
    (fetchChangelogTool.execute as any).mockResolvedValueOnce({
      changelog: [
        {
          version: '2.1.0',
          content: `## New Features
- Added new utility function
- Improved error messages

## Bug Fixes
- Fixed edge case in parsing`,
          prLinks: [],
        },
      ],
      totalSections: 1,
      filteredSections: 1,
      sourceFile: 'CHANGELOG.md',
      repository: 'example/package',
    });

    const result = await packageVersionComparisonTool.execute({
      context: {
        packageName: 'example-package',
        fromVersion: '2.0.5',
        toVersion: '2.1.0',
      },
      runtimeContext: {},
    });

    expect(result.versionDifference.minorChange).toBe(true);
    expect(result.versionDifference.semverType).toBe('minor');
    expect(result.upgradeComplexity).toBe('medium');
    expect(result.riskAssessment.level).toBe('medium');
    expect(result.upgradeRecommendations).toContain(
      'This is a minor version upgrade. Review new features and any behavioral changes.',
    );
  });

  it('should handle patch version upgrades with low complexity', async () => {
    // Mock npm registry response
    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          repository: {
            url: 'https://github.com/example/package.git',
          },
        }),
      })
      // Mock GitHub API response for default branch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          default_branch: 'main',
        }),
      });

    // Mock changelog with patch changes
    const { fetchChangelogTool } = await import('./fetch-changelog-tool');
    (fetchChangelogTool.execute as any).mockResolvedValueOnce({
      changelog: [
        {
          version: '1.0.1',
          content: `## Bug Fixes
- Fixed memory leak in parser
- Corrected typo in error message`,
          prLinks: [],
        },
      ],
      totalSections: 1,
      filteredSections: 1,
      sourceFile: 'CHANGELOG.md',
      repository: 'example/package',
    });

    const result = await packageVersionComparisonTool.execute({
      context: {
        packageName: 'example-package',
        fromVersion: '1.0.0',
        toVersion: '1.0.1',
      },
      runtimeContext: {},
    });

    expect(result.versionDifference.patchChange).toBe(true);
    expect(result.versionDifference.semverType).toBe('patch');
    expect(result.upgradeComplexity).toBe('low');
    expect(result.riskAssessment.level).toBe('low');
    expect(result.upgradeRecommendations).toContain(
      'This is a patch version upgrade. Should be relatively safe to upgrade.',
    );
  });

  it('should handle packages without repository information', async () => {
    // Mock npm registry response without repository
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        name: 'some-package',
        // No repository field
      }),
    });

    const result = await packageVersionComparisonTool.execute({
      context: {
        packageName: 'some-package',
        fromVersion: '1.0.0',
        toVersion: '2.0.0',
      },
      runtimeContext: {},
    });

    expect(result.packageName).toBe('some-package');
    expect(result.versionDifference.majorChange).toBe(true);
    expect(result.changelog.hasChangelog).toBe(false);
    expect(result.upgradeComplexity).toBe('high'); // Major version without changelog info
    expect(result.riskAssessment.level).toBe('high');
  });

  it('should use provided repository URL when npm lookup fails', async () => {
    // Mock npm registry failure
    (global.fetch as any)
      .mockRejectedValueOnce(new Error('Not found'))
      // Mock GitHub API response for default branch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          default_branch: 'master',
        }),
      });

    // Mock changelog fetch
    const { fetchChangelogTool } = await import('./fetch-changelog-tool');
    (fetchChangelogTool.execute as any).mockResolvedValueOnce({
      changelog: [],
      totalSections: 0,
      filteredSections: 0,
      sourceFile: 'CHANGELOG.md',
      repository: 'custom/repo',
    });

    const result = await packageVersionComparisonTool.execute({
      context: {
        packageName: 'custom-package',
        fromVersion: '1.0.0',
        toVersion: '1.1.0',
        repositoryUrl: 'https://github.com/custom/repo',
      },
      runtimeContext: {},
    });

    expect(result.packageName).toBe('custom-package');
    expect(result.changelog.repository).toBe('custom/repo');
  });

  it('should handle repositories with different default branches', async () => {
    // Mock npm registry response
    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          repository: {
            url: 'https://github.com/legacy/package.git',
          },
        }),
      })
      // Mock GitHub API response for default branch (master instead of main)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          default_branch: 'master',
        }),
      });

    // Mock changelog fetch
    const { fetchChangelogTool } = await import('./fetch-changelog-tool');
    (fetchChangelogTool.execute as any).mockResolvedValueOnce({
      changelog: [],
      totalSections: 0,
      filteredSections: 0,
      sourceFile: 'CHANGELOG.md',
      repository: 'legacy/package',
    });

    const result = await packageVersionComparisonTool.execute({
      context: {
        packageName: 'legacy-package',
        fromVersion: '1.0.0',
        toVersion: '1.1.0',
      },
      runtimeContext: {},
    });

    expect(result.packageName).toBe('legacy-package');
    expect(result.changelog.repository).toBe('legacy/package');
    // Verify that the fetchChangelogTool was called with the correct branch
    expect(fetchChangelogTool.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({
          branch: 'master',
        }),
      }),
    );
  });
});
