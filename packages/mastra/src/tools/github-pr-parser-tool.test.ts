import { describe, it, expect, vi, beforeEach } from 'vitest';
import { githubPRParserTool, isValidGitHubPRUrl, parseGitHubPRUrl } from './github-pr-parser-tool';

// Mock child_process
vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

describe('GitHub PR Parser Tool', () => {
  const mockExecSync = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.doMock('child_process', () => ({
      execSync: mockExecSync,
    }));
  });

  describe('URL validation', () => {
    it('should validate correct GitHub PR URLs', () => {
      expect(isValidGitHubPRUrl('https://github.com/facebook/react/pull/12345')).toBe(true);
      expect(isValidGitHubPRUrl('https://github.com/owner/repo/pull/1')).toBe(true);
      expect(isValidGitHubPRUrl('https://github.com/my-org/my-repo/pull/999')).toBe(true);
    });

    it('should reject invalid GitHub PR URLs', () => {
      expect(isValidGitHubPRUrl('https://github.com/owner/repo')).toBe(false);
      expect(isValidGitHubPRUrl('https://github.com/owner/repo/issues/123')).toBe(false);
      expect(isValidGitHubPRUrl('https://gitlab.com/owner/repo/pull/123')).toBe(false);
      expect(isValidGitHubPRUrl('not-a-url')).toBe(false);
    });
  });

  describe('URL parsing', () => {
    it('should correctly parse GitHub PR URLs', () => {
      const result = parseGitHubPRUrl('https://github.com/facebook/react/pull/12345');
      expect(result).toEqual({
        owner: 'facebook',
        repo: 'react',
        prNumber: 12345,
      });
    });

    it('should return null for invalid URLs', () => {
      expect(parseGitHubPRUrl('https://github.com/owner/repo')).toBeNull();
      expect(parseGitHubPRUrl('invalid-url')).toBeNull();
    });
  });

  describe('PR data extraction', () => {
    const mockPRData = {
      number: 123,
      title: 'Add new feature',
      state: 'open',
      draft: false,
      merged: false,
      mergeable: true,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-02T00:00:00Z',
      base: {
        ref: 'main',
        sha: 'abc123',
        repo: {
          full_name: 'owner/repo',
          clone_url: 'https://github.com/owner/repo.git',
          ssh_url: 'git@github.com:owner/repo.git',
          owner: { login: 'owner' },
          name: 'repo',
        },
      },
      head: {
        ref: 'feature-branch',
        sha: 'def456',
        repo: {
          full_name: 'owner/repo',
          clone_url: 'https://github.com/owner/repo.git',
          owner: { login: 'owner' },
          name: 'repo',
        },
      },
      user: {
        login: 'contributor',
        type: 'User',
      },
      commits: 3,
      additions: 100,
      deletions: 50,
      changed_files: 5,
      labels: [{ name: 'enhancement', color: '84b6eb', description: 'New feature' }],
      html_url: 'https://github.com/owner/repo/pull/123',
      diff_url: 'https://github.com/owner/repo/pull/123.diff',
      patch_url: 'https://github.com/owner/repo/pull/123.patch',
    };

    it('should extract basic PR information', async () => {
      mockExecSync.mockReturnValue(JSON.stringify(mockPRData));

      const result = await githubPRParserTool.execute({
        context: {
          prUrl: 'https://github.com/owner/repo/pull/123',
          includeCommits: false,
          includeDiffUrls: false,
        },
      });

      expect(mockExecSync).toHaveBeenCalledWith('gh api repos/owner/repo/pulls/123', { encoding: 'utf-8' });

      expect(result.prNumber).toBe(123);
      expect(result.title).toBe('Add new feature');
      expect(result.state).toBe('open');
      expect(result.repository.owner).toBe('owner');
      expect(result.repository.name).toBe('repo');
    });

    it('should extract git diff inputs correctly', async () => {
      mockExecSync.mockReturnValue(JSON.stringify(mockPRData));

      const result = await githubPRParserTool.execute({
        context: {
          prUrl: 'https://github.com/owner/repo/pull/123',
          includeCommits: false,
          includeDiffUrls: false,
        },
      });

      expect(result.gitDiffInputs).toEqual({
        base: 'main',
        compare: 'feature-branch',
        baseSha: 'abc123',
        headSha: 'def456',
        isCrossRepository: false,
        headRepository: {
          owner: 'owner',
          name: 'repo',
          fullName: 'owner/repo',
          cloneUrl: 'https://github.com/owner/repo.git',
        },
      });

      expect(result.gitDiffToolConfig).toEqual({
        base: 'main',
        compare: 'feature-branch',
        alternativeConfig: {
          base: 'abc123',
          compare: 'def456',
        },
      });
    });

    it('should handle cross-repository PRs (forks)', async () => {
      const crossRepoPRData = {
        ...mockPRData,
        head: {
          ...mockPRData.head,
          repo: {
            full_name: 'contributor/repo',
            clone_url: 'https://github.com/contributor/repo.git',
            owner: { login: 'contributor' },
            name: 'repo',
          },
        },
      };

      mockExecSync.mockReturnValue(JSON.stringify(crossRepoPRData));

      const result = await githubPRParserTool.execute({
        context: {
          prUrl: 'https://github.com/owner/repo/pull/123',
          includeCommits: false,
          includeDiffUrls: false,
        },
      });

      expect(result.gitDiffInputs.isCrossRepository).toBe(true);
      expect(result.gitDiffInputs.headRepository).toEqual({
        owner: 'contributor',
        name: 'repo',
        fullName: 'contributor/repo',
        cloneUrl: 'https://github.com/contributor/repo.git',
      });

      expect(result.gitCommands.addRemote).toBe('git remote add contributor https://github.com/contributor/repo.git');
      expect(result.gitCommands.fetchFromFork).toBe('git fetch contributor feature-branch');
      expect(result.gitCommands.diffCrossRepo).toBe('git diff main...contributor/feature-branch');
    });

    it('should include commits when requested', async () => {
      const mockCommits = [
        {
          sha: 'commit1',
          commit: {
            message: 'First commit',
            author: {
              name: 'John Doe',
              email: 'john@example.com',
              date: '2024-01-01T00:00:00Z',
            },
          },
          html_url: 'https://github.com/owner/repo/commit/commit1',
        },
      ];

      mockExecSync.mockReturnValueOnce(JSON.stringify(mockPRData)).mockReturnValueOnce(JSON.stringify(mockCommits));

      const result = await githubPRParserTool.execute({
        context: {
          prUrl: 'https://github.com/owner/repo/pull/123',
          includeCommits: true,
          includeDiffUrls: false,
        },
      });

      expect(mockExecSync).toHaveBeenCalledTimes(2);
      expect(mockExecSync).toHaveBeenLastCalledWith('gh api repos/owner/repo/pulls/123/commits', { encoding: 'utf-8' });

      expect(result.commits).toHaveLength(1);
      expect(result.commits[0]).toEqual({
        sha: 'commit1',
        message: 'First commit',
        author: {
          name: 'John Doe',
          email: 'john@example.com',
          date: '2024-01-01T00:00:00Z',
        },
        url: 'https://github.com/owner/repo/commit/commit1',
      });
    });

    it('should include diff URLs when requested', async () => {
      mockExecSync.mockReturnValue(JSON.stringify(mockPRData));

      const result = await githubPRParserTool.execute({
        context: {
          prUrl: 'https://github.com/owner/repo/pull/123',
          includeCommits: false,
          includeDiffUrls: true,
        },
      });

      expect(result.diffUrls).toEqual({
        html: 'https://github.com/owner/repo/pull/123',
        diff: 'https://github.com/owner/repo/pull/123.diff',
        patch: 'https://github.com/owner/repo/pull/123.patch',
        commits: 'https://github.com/owner/repo/pull/123/commits',
        files: 'https://github.com/owner/repo/pull/123/files',
      });
    });

    it('should provide helpful git commands', async () => {
      mockExecSync.mockReturnValue(JSON.stringify(mockPRData));

      const result = await githubPRParserTool.execute({
        context: {
          prUrl: 'https://github.com/owner/repo/pull/123',
          includeCommits: false,
          includeDiffUrls: false,
        },
      });

      expect(result.gitCommands.fetchPR).toBe('git fetch origin pull/123/head:pr-123');
      expect(result.gitCommands.checkoutPR).toBe('git checkout pr-123');
      expect(result.gitCommands.diffCommand).toBe('git diff main...feature-branch');
    });
  });

  describe('Error handling', () => {
    it('should throw error for invalid PR URL format', async () => {
      await expect(
        githubPRParserTool.execute({
          context: {
            prUrl: 'https://github.com/owner/repo/issues/123',
            includeCommits: false,
            includeDiffUrls: false,
          },
        }),
      ).rejects.toThrow('Invalid GitHub PR URL format');
    });

    it('should handle 404 errors gracefully', async () => {
      mockExecSync.mockImplementation(() => {
        const error = new Error('404 Not Found');
        throw error;
      });

      await expect(
        githubPRParserTool.execute({
          context: {
            prUrl: 'https://github.com/owner/repo/pull/999999',
            includeCommits: false,
            includeDiffUrls: false,
          },
        }),
      ).rejects.toThrow('Pull request not found');
    });

    it('should handle other API errors', async () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('API rate limit exceeded');
      });

      await expect(
        githubPRParserTool.execute({
          context: {
            prUrl: 'https://github.com/owner/repo/pull/123',
            includeCommits: false,
            includeDiffUrls: false,
          },
        }),
      ).rejects.toThrow('Failed to parse GitHub PR: API rate limit exceeded');
    });
  });
});
