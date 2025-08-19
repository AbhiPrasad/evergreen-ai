// Mock responses for GitHub API calls

export const mockReleasesList = [
  {
    tagName: 'v19.1.1',
    name: '19.1.1 (July 28, 2025)',
    publishedAt: '2025-07-28T15:04:10Z',
    isDraft: false,
    isPrerelease: false,
  },
  {
    tagName: 'v19.1.0',
    name: '19.1.0 (March 28, 2025)',
    publishedAt: '2025-03-28T21:02:48Z',
    isDraft: false,
    isPrerelease: false,
  },
  {
    tagName: 'v19.0.0',
    name: '19.0.0 (December 5, 2024)',
    publishedAt: '2024-12-05T21:05:14Z',
    isDraft: false,
    isPrerelease: false,
  },
];

export const mockReleaseDetail = {
  tagName: 'v19.1.1',
  name: '19.1.1 (July 28, 2025)',
  body: "## What's Changed\n\n### Bug Fixes\n\n* Fixed memory leak in component unmounting by @user1 in #12345\n* Resolved issue with state updates after component unmount by @user2 in #12346\n\n### Features\n\n* Added new useCallback optimization by @user3 in #12347\n* Implement new React Server Components feature by @user4 in #12348\n\n### Breaking Changes\n\n* Removed deprecated createClass API - use class components or hooks instead\n\n### Documentation\n\n* Updated migration guide for v19\n* Added examples for new Server Components\n\n**Full Changelog**: https://github.com/facebook/react/compare/v19.1.0...v19.1.1",
  publishedAt: '2025-07-28T15:04:10Z',
  url: 'https://github.com/facebook/react/releases/tag/v19.1.1',
  isDraft: false,
  isPrerelease: false,
};

export const mockLatestRelease = {
  tagName: 'v15.4.6',
  name: 'v15.4.6',
  body: '### Features\n\n- Added new caching mechanism for better performance\n- Improved TypeScript support for app directory\n\n### Bug Fixes\n\n- Fixed issue with dynamic imports in production\n\n### Documentation\n\n- Updated deployment guide',
  publishedAt: '2025-08-06T10:30:00Z',
  url: 'https://github.com/vercel/next.js/releases/tag/v15.4.6',
  isDraft: false,
  isPrerelease: false,
};

export const mockEmptyReleases: any[] = [];

export const mockPrereleasesList = [
  {
    tagName: 'v19.2.0-beta.1',
    name: '19.2.0 Beta 1',
    publishedAt: '2025-08-15T12:00:00Z',
    isDraft: false,
    isPrerelease: true,
  },
  ...mockReleasesList,
];

export const mockTagsList = ['v19.1.1', 'v19.1.0', 'v19.0.0', 'v18.3.1', 'v18.3.0'];

// Error responses
export const mockGitHubAPIError = {
  message: 'Repository not found or access denied',
  status: 404,
};

export const mockNoReleasesResponse = {
  data: [],
};

export const mockAuthError = {
  message: 'Bad credentials',
  status: 401,
};
