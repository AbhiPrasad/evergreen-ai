import { describe, it, expect, vi, beforeEach } from 'vitest';
import { rubyPackageVersionComparisonTool } from './ruby-package-version-comparison-tool';

// Mock the fetch function
global.fetch = vi.fn();

// Mock the fetchChangelogTool
vi.mock('../fetch-changelog-tool', () => ({
  fetchChangelogTool: {
    execute: vi.fn(),
  },
}));

describe('rubyPackageVersionComparisonTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should analyze version difference correctly', async () => {
    // Mock RubyGems API response
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        version: '7.0.4',
        homepage_uri: 'https://rubyonrails.org',
        source_code_uri: 'https://github.com/rails/rails',
        downloads: 1000000,
      }),
    });

    const result = await rubyPackageVersionComparisonTool.execute({
      context: {
        gemName: 'rails',
        fromVersion: '6.1.7',
        toVersion: '7.0.0',
      },
      runtimeContext: {},
    });

    expect(result.gemName).toBe('rails');
    expect(result.fromVersion).toBe('6.1.7');
    expect(result.toVersion).toBe('7.0.0');
    expect(result.versionDifference.majorChange).toBe(true);
    expect(result.versionDifference.semverType).toBe('major');
    expect(result.versionDifference.isPessimisticCompatible).toBe(false);
    expect(result.versionDifference.pessimisticConstraint).toBe('~> 7.0');
  });

  it('should handle minor version changes', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });

    const result = await rubyPackageVersionComparisonTool.execute({
      context: {
        gemName: 'nokogiri',
        fromVersion: '1.13.9',
        toVersion: '1.14.0',
      },
      runtimeContext: {},
    });

    expect(result.versionDifference.majorChange).toBe(false);
    expect(result.versionDifference.minorChange).toBe(true);
    expect(result.versionDifference.semverType).toBe('minor');
    expect(result.versionDifference.isPessimisticCompatible).toBe(false);
    expect(result.versionDifference.pessimisticConstraint).toBe('~> 1.14');
  });

  it('should handle patch version changes', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });

    const result = await rubyPackageVersionComparisonTool.execute({
      context: {
        gemName: 'rspec',
        fromVersion: '3.12.0',
        toVersion: '3.12.1',
      },
      runtimeContext: {},
    });

    expect(result.versionDifference.majorChange).toBe(false);
    expect(result.versionDifference.minorChange).toBe(false);
    expect(result.versionDifference.patchChange).toBe(true);
    expect(result.versionDifference.semverType).toBe('patch');
    expect(result.versionDifference.isPessimisticCompatible).toBe(true);
    expect(result.versionDifference.pessimisticConstraint).toBe('~> 3.12.1');
  });

  it('should handle prerelease versions', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });

    const result = await rubyPackageVersionComparisonTool.execute({
      context: {
        gemName: 'rails',
        fromVersion: '7.0.0.rc1',
        toVersion: '7.0.0',
      },
      runtimeContext: {},
    });

    expect(result.versionDifference.semverType).toBe('prerelease');
  });

  it('should fetch gem information from RubyGems API', async () => {
    const mockGemInfo = {
      version: '7.0.4',
      homepage_uri: 'https://rubyonrails.org',
      source_code_uri: 'https://github.com/rails/rails',
      changelog_uri: 'https://github.com/rails/rails/releases',
      documentation_uri: 'https://api.rubyonrails.org',
      downloads: 1000000,
    };

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockGemInfo,
    });

    const result = await rubyPackageVersionComparisonTool.execute({
      context: {
        gemName: 'rails',
        fromVersion: '6.1.0',
        toVersion: '7.0.0',
      },
      runtimeContext: {},
    });

    expect(result.rubygemsInfo.gemExists).toBe(true);
    expect(result.rubygemsInfo.homepage).toBe('https://rubyonrails.org');
    expect(result.rubygemsInfo.sourceCodeUri).toBe('https://github.com/rails/rails');
    expect(result.rubygemsInfo.changelogUri).toBe('https://github.com/rails/rails/releases');
    expect(result.rubygemsInfo.downloads).toBe(1000000);
  });

  it('should handle RubyGems API failure gracefully', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 404,
    });

    const result = await rubyPackageVersionComparisonTool.execute({
      context: {
        gemName: 'nonexistent-gem',
        fromVersion: '1.0.0',
        toVersion: '2.0.0',
      },
      runtimeContext: {},
    });

    expect(result.rubygemsInfo.gemExists).toBe(false);
    expect(result.rubygemsInfo.homepage).toBeNull();
    expect(result.rubygemsInfo.downloads).toBeNull();
  });

  it('should assess upgrade complexity correctly', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });

    // Major version change should be high complexity
    const majorResult = await rubyPackageVersionComparisonTool.execute({
      context: {
        gemName: 'rails',
        fromVersion: '6.1.0',
        toVersion: '7.0.0',
      },
      runtimeContext: {},
    });

    expect(majorResult.upgradeComplexity).toBe('high');

    // Patch version change should be low complexity
    const patchResult = await rubyPackageVersionComparisonTool.execute({
      context: {
        gemName: 'rails',
        fromVersion: '7.0.0',
        toVersion: '7.0.1',
      },
      runtimeContext: {},
    });

    expect(patchResult.upgradeComplexity).toBe('low');
  });

  it('should assess risk correctly for critical gems', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });

    const result = await rubyPackageVersionComparisonTool.execute({
      context: {
        gemName: 'rails',
        fromVersion: '6.1.0',
        toVersion: '7.0.0',
      },
      runtimeContext: {},
    });

    expect(result.riskAssessment.level).toBe('high');
    expect(result.riskAssessment.factors).toContain('Major version change detected');
    expect(result.riskAssessment.factors).toContain('Critical framework/core dependency');
  });

  it('should generate appropriate upgrade recommendations', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });

    const result = await rubyPackageVersionComparisonTool.execute({
      context: {
        gemName: 'rails',
        fromVersion: '6.1.0',
        toVersion: '7.0.0',
      },
      runtimeContext: {},
    });

    expect(result.upgradeRecommendations).toContain('This is a major version upgrade. Review all breaking changes carefully before upgrading.');
    expect(result.upgradeRecommendations).toContain("Consider using pessimistic constraint: gem 'rails', '~> 7.0'");
    expect(result.upgradeRecommendations).some(r => r.includes('Rails upgrade guides'));
    expect(result.upgradeRecommendations).toContain('Update your Gemfile.lock by running bundle update after the upgrade.');
  });

  it('should handle repository URL parameter', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });

    const result = await rubyPackageVersionComparisonTool.execute({
      context: {
        gemName: 'custom-gem',
        fromVersion: '1.0.0',
        toVersion: '2.0.0',
        repositoryUrl: 'https://github.com/example/custom-gem',
      },
      runtimeContext: {},
    });

    // Should still work even with custom repository
    expect(result.gemName).toBe('custom-gem');
    expect(result.versionDifference.majorChange).toBe(true);
  });

  it('should handle version strings with v prefix', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });

    const result = await rubyPackageVersionComparisonTool.execute({
      context: {
        gemName: 'gem-with-v',
        fromVersion: 'v1.0.0',
        toVersion: 'v2.0.0',
      },
      runtimeContext: {},
    });

    expect(result.versionDifference.majorChange).toBe(true);
    expect(result.fromVersion).toBe('v1.0.0'); // Should preserve original format
    expect(result.toVersion).toBe('v2.0.0');
  });

  it('should generate pessimistic constraints correctly', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });

    const result = await rubyPackageVersionComparisonTool.execute({
      context: {
        gemName: 'example',
        fromVersion: '1.2.3',
        toVersion: '1.2.5',
      },
      runtimeContext: {},
    });

    expect(result.versionDifference.pessimisticConstraint).toBe('~> 1.2.5');
    expect(result.versionDifference.isPessimisticCompatible).toBe(true);
  });

  it('should handle gem-specific recommendations', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });

    const nokogiriResult = await rubyPackageVersionComparisonTool.execute({
      context: {
        gemName: 'nokogiri',
        fromVersion: '1.13.0',
        toVersion: '1.14.0',
      },
      runtimeContext: {},
    });

    expect(nokogiriResult.upgradeRecommendations).toContain('Check for any native dependency compilation issues.');

    const activerecordResult = await rubyPackageVersionComparisonTool.execute({
      context: {
        gemName: 'activerecord',
        fromVersion: '6.1.0',
        toVersion: '7.0.0',
      },
      runtimeContext: {},
    });

    expect(activerecordResult.upgradeRecommendations).toContain('Review database migrations and model code for compatibility.');
  });
});