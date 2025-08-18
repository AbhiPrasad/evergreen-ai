import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { gitDiffTool } from './git-diff-tool';

describe('Git Diff Tool', () => {
  let testRepo: string;

  beforeAll(() => {
    // Create a temporary git repository for testing
    testRepo = mkdtempSync(join(tmpdir(), 'git-diff-test-'));

    // Initialize git repo
    execSync('git init', { cwd: testRepo });
    execSync('git config user.email "test@example.com"', { cwd: testRepo });
    execSync('git config user.name "Test User"', { cwd: testRepo });

    // Create initial commit
    writeFileSync(join(testRepo, 'file1.txt'), 'Initial content\n');
    writeFileSync(join(testRepo, 'file2.js'), 'console.log("hello");\n');
    execSync('git add .', { cwd: testRepo });
    execSync('git commit -m "Initial commit"', { cwd: testRepo });

    // Create a feature branch with changes
    execSync('git checkout -b feature-branch', { cwd: testRepo });
    writeFileSync(join(testRepo, 'file1.txt'), 'Initial content\nModified content\n');
    writeFileSync(join(testRepo, 'file3.md'), '# New Documentation\n');
    execSync('git add .', { cwd: testRepo });
    execSync('git commit -m "Add feature changes"', { cwd: testRepo });

    // Go back to main branch
    execSync('git checkout main', { cwd: testRepo });
  });

  afterAll(() => {
    // Clean up test repository
    rmSync(testRepo, { recursive: true, force: true });
  });

  describe('Basic functionality', () => {
    it('should generate diff between branches', async () => {
      const result = await gitDiffTool.execute({
        context: {
          repository: testRepo,
          base: 'main',
          compare: 'feature-branch',
          diffType: 'unified',
          includeContext: 3,
        },
      });

      expect(result.diff).toContain('file1.txt');
      expect(result.diff).toContain('Modified content');
      expect(result.diff).toContain('file3.md');
      expect(result.stats.filesChanged).toBe(2);
      expect(result.currentBranch).toBe('main');
    });

    it('should generate diff with name-only option', async () => {
      const result = await gitDiffTool.execute({
        context: {
          repository: testRepo,
          base: 'main',
          compare: 'feature-branch',
          diffType: 'name-only',
          includeContext: 3,
        },
      });

      expect(result.diff).toContain('file1.txt');
      expect(result.diff).toContain('file3.md');
      expect(result.diff).not.toContain('Modified content');
      expect(result.stats.files).toHaveLength(2);
    });

    it('should generate diff with stat option', async () => {
      const result = await gitDiffTool.execute({
        context: {
          repository: testRepo,
          base: 'main',
          compare: 'feature-branch',
          diffType: 'stat',
          includeContext: 3,
        },
      });

      expect(result.diff).toContain('2 files changed');
      expect(result.stats.filesChanged).toBe(2);
      expect(result.stats.insertions).toBeGreaterThan(0);
    });

    it('should generate diff for specific file', async () => {
      const result = await gitDiffTool.execute({
        context: {
          repository: testRepo,
          base: 'main',
          compare: 'feature-branch',
          filePath: 'file1.txt',
          diffType: 'unified',
          includeContext: 3,
        },
      });

      expect(result.diff).toContain('file1.txt');
      expect(result.diff).not.toContain('file3.md');
      expect(result.stats.filesChanged).toBe(1);
    });
  });

  describe('Working directory diffs', () => {
    it('should show unstaged changes when no base or compare specified', async () => {
      // Make a change in working directory
      execSync('git checkout feature-branch', { cwd: testRepo });
      writeFileSync(join(testRepo, 'file1.txt'), 'Initial content\nModified content\nUnstaged change\n');

      const result = await gitDiffTool.execute({
        context: {
          repository: testRepo,
          diffType: 'unified',
          includeContext: 3,
        },
      });

      expect(result.diff).toContain('Unstaged change');
      expect(result.base).toBe('working directory');
      expect(result.compare).toBe('HEAD');

      // Clean up
      execSync('git checkout file1.txt', { cwd: testRepo });
      execSync('git checkout main', { cwd: testRepo });
    });

    it('should diff from specific commit to working directory', async () => {
      execSync('git checkout feature-branch', { cwd: testRepo });
      writeFileSync(join(testRepo, 'file1.txt'), 'Initial content\nModified content\nWorking dir change\n');

      const result = await gitDiffTool.execute({
        context: {
          repository: testRepo,
          base: 'main',
          diffType: 'unified',
          includeContext: 3,
        },
      });

      expect(result.diff).toContain('Working dir change');
      expect(result.stats.filesChanged).toBeGreaterThan(0);

      // Clean up
      execSync('git checkout file1.txt', { cwd: testRepo });
      execSync('git checkout main', { cwd: testRepo });
    });
  });

  describe('Error handling', () => {
    it('should handle invalid repository path', async () => {
      await expect(
        gitDiffTool.execute({
          context: {
            repository: '/invalid/path',
            base: 'main',
            compare: 'feature-branch',
            diffType: 'unified',
            includeContext: 3,
          },
        }),
      ).rejects.toThrow('Failed to generate git diff');
    });

    it('should handle invalid branch names', async () => {
      await expect(
        gitDiffTool.execute({
          context: {
            repository: testRepo,
            base: 'non-existent-branch',
            compare: 'feature-branch',
            diffType: 'unified',
            includeContext: 3,
          },
        }),
      ).rejects.toThrow('Failed to generate git diff');
    });
  });

  describe('Diff statistics parsing', () => {
    it('should correctly parse unified diff stats', async () => {
      const result = await gitDiffTool.execute({
        context: {
          repository: testRepo,
          base: 'main',
          compare: 'feature-branch',
          diffType: 'unified',
          includeContext: 3,
        },
      });

      expect(result.stats).toBeDefined();
      expect(result.stats.filesChanged).toBe(2);
      expect(result.stats.insertions).toBeGreaterThan(0);
      expect(result.stats.files).toHaveLength(2);
    });

    it('should correctly parse name-status diff', async () => {
      // Create a more complex scenario
      execSync('git checkout feature-branch', { cwd: testRepo });
      writeFileSync(join(testRepo, 'deleted.txt'), 'To be deleted');
      execSync('git add deleted.txt', { cwd: testRepo });
      execSync('git commit -m "Add file to delete"', { cwd: testRepo });
      execSync('rm deleted.txt', { cwd: testRepo });
      execSync('git add deleted.txt', { cwd: testRepo });
      execSync('git commit -m "Delete file"', { cwd: testRepo });

      const result = await gitDiffTool.execute({
        context: {
          repository: testRepo,
          base: 'main',
          compare: 'feature-branch',
          diffType: 'name-status',
          includeContext: 3,
        },
      });

      expect(result.stats.files.some(f => f.status === 'added')).toBe(true);
      expect(result.stats.files.some(f => f.status === 'modified')).toBe(true);

      // Clean up
      execSync('git checkout main', { cwd: testRepo });
    });
  });

  describe('Context lines', () => {
    it('should respect custom context line settings', async () => {
      const resultDefault = await gitDiffTool.execute({
        context: {
          repository: testRepo,
          base: 'main',
          compare: 'feature-branch',
          diffType: 'unified',
          includeContext: 3,
        },
      });

      const resultExpanded = await gitDiffTool.execute({
        context: {
          repository: testRepo,
          base: 'main',
          compare: 'feature-branch',
          diffType: 'unified',
          includeContext: 10,
        },
      });

      // The expanded context diff should generally be longer
      expect(resultExpanded.command).toContain('-U10');
      expect(resultDefault.command).toContain('-U3');
    });
  });
});
