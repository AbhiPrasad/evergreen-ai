import { describe, it, expect } from 'vitest';
import { dependencyChangelogSummarizerTool } from '../src/mastra/tools/dependency-changelog-agent';

describe('Dependency Changelog Agent', () => {
  const mockChangelogPath = 'test/mocks/CHANGELOG.md';

  it('should analyze changelog between versions with dependency filtering', async () => {
    const result = await dependencyChangelogSummarizerTool.execute({
      context: {
        changelogPath: mockChangelogPath,
        fromVersion: '10.0.0',
        toVersion: '10.5.0',
        dependencies: ['@sentry/core', '@sentry/node', '@sentry/nextjs'],
        includeAllChanges: false
      }
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.analysis.versionsAnalyzed).toContain('10.5.0');
      expect(result.analysis.versionsAnalyzed).toContain('10.4.0');
      expect(result.analysis.versionsAnalyzed).not.toContain('10.0.0'); // excluded as lower bound
      expect(result.summary).toContain('Changelog Summary');
      expect(result.versionRange).toEqual({
        fromVersion: '10.0.0',
        toVersion: '10.5.0'
      });
      expect(result.dependencyFilter).toEqual(['@sentry/core', '@sentry/node', '@sentry/nextjs']);
    }
  });

  it('should analyze changelog without dependency filtering (all important changes)', async () => {
    const result = await dependencyChangelogSummarizerTool.execute({
      context: {
        changelogPath: mockChangelogPath,
        fromVersion: '10.3.0',
        toVersion: '10.4.0',
        dependencies: [],
        includeAllChanges: false
      }
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.analysis.versionsAnalyzed).toEqual(['10.4.0']);
      expect(result.analysis.totalChanges).toBeGreaterThan(0);
      expect(result.summary).toContain('Changelog Summary');
    }
  });

  it('should include all changes when includeAllChanges is true', async () => {
    const result = await dependencyChangelogSummarizerTool.execute({
      context: {
        changelogPath: mockChangelogPath,
        fromVersion: '10.4.0',
        toVersion: '10.5.0',
        dependencies: [],
        includeAllChanges: true
      }
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.analysis.versionsAnalyzed).toEqual(['10.5.0']);
      // With includeAllChanges: true, should have more total changes
      expect(result.analysis.totalChanges).toBeGreaterThan(0);
    }
  });

  it('should handle non-existent versions gracefully', async () => {
    const result = await dependencyChangelogSummarizerTool.execute({
      context: {
        changelogPath: mockChangelogPath,
        fromVersion: '999.0.0',
        toVersion: '1000.0.0',
        dependencies: [],
        includeAllChanges: false
      }
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('not found in changelog');
  });

  it('should handle non-existent changelog file', async () => {
    const result = await dependencyChangelogSummarizerTool.execute({
      context: {
        changelogPath: 'non-existent-file.md',
        fromVersion: '1.0.0',
        toVersion: '2.0.0',
        dependencies: [],
        includeAllChanges: false
      }
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('should categorize different types of changes correctly', async () => {
    const result = await dependencyChangelogSummarizerTool.execute({
      context: {
        changelogPath: mockChangelogPath,
        fromVersion: '10.0.0',
        toVersion: '10.5.0',
        dependencies: [],
        includeAllChanges: true
      }
    });

    expect(result.success).toBe(true);
    if (result.success) {
      // Should have categorized changes
      expect(result.analysis).toHaveProperty('breakingChanges');
      expect(result.analysis).toHaveProperty('newFeatures');
      expect(result.analysis).toHaveProperty('bugFixes');
      expect(result.analysis).toHaveProperty('securityUpdates');
      expect(result.analysis).toHaveProperty('performanceImprovements');
      
      // Should have detailed changes for each category
      expect(result.detailedChanges).toHaveProperty('breaking');
      expect(result.detailedChanges).toHaveProperty('features');
      expect(result.detailedChanges).toHaveProperty('fixes');
      expect(result.detailedChanges).toHaveProperty('security');
      expect(result.detailedChanges).toHaveProperty('performance');
    }
  });

  it('should identify dependency-specific changes', async () => {
    const result = await dependencyChangelogSummarizerTool.execute({
      context: {
        changelogPath: mockChangelogPath,
        fromVersion: '10.0.0',
        toVersion: '10.5.0',
        dependencies: ['deps'],
        includeAllChanges: false
      }
    });

    expect(result.success).toBe(true);
    if (result.success) {
      // Should find dependency bumps that contain 'deps' in the feat(deps) entries
      const hasDepChanges = result.detailedChanges.features.some(
        change => change.rawText.toLowerCase().includes('deps') || 
                 change.scope === 'deps'
      );
      expect(hasDepChanges).toBe(true);
    }
  });
});