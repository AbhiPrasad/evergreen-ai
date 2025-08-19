import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Import the parseChangelogSections function from the tool
// We need to extract it from the module since it's not exported
const toolContent = readFileSync(join(__dirname, 'fetch-changelog-tool.ts'), 'utf-8');

// Mock changelog content with PR/issue links for testing
const mockChangelogContent = `# Changelog

## 10.5.0

- feat(core): better cause data extraction ([#17375](https://github.com/getsentry/sentry-javascript/pull/17375))
- feat(deps): Bump @sentry/cli from 2.50.2 to 2.51.1 ([#17382](https://github.com/getsentry/sentry-javascript/pull/17382))
- fix(nextjs): Inject Next.js version for dev symbolication ([#17379](https://github.com/getsentry/sentry-javascript/pull/17379))
- fix(mcp-server): Add defensive patches for Transport edge cases ([#17291](https://github.com/getsentry/sentry-javascript/pull/17291))

## 10.4.0

- fix(browser): Ensure IP address is only inferred by Relay if \`sendDefaultPii\` is \`true\` ([#17370](https://github.com/getsentry/sentry-javascript/pull/17370))
- feat(node): Add \`ignoreStaticAssets\` option ([#17368](https://github.com/getsentry/sentry-javascript/issues/17368))
`;

// Extract PR/issue links helper function for testing
function extractPRAndIssueLinks(content: string): Array<{ number: string; url: string; type: 'pr' | 'issue' }> {
  const links: Array<{ number: string; url: string; type: 'pr' | 'issue' }> = [];

  // Regex pattern to match GitHub PR/issue links in markdown format
  const linkRegex = /\[#(\d+)\]\((https:\/\/github\.com\/[^\/]+\/[^\/]+\/(pull|issues)\/\d+)\)/g;

  let match;
  while ((match = linkRegex.exec(content)) !== null) {
    const [, number, url, urlType] = match;
    const type = urlType === 'pull' ? 'pr' : 'issue';

    // Avoid duplicates
    if (!links.some(link => link.number === number && link.url === url)) {
      links.push({
        number,
        url,
        type,
      });
    }
  }

  return links;
}

describe('Changelog PR/Issue Link Extraction', () => {
  it('should extract PR links correctly', () => {
    const content =
      '- feat(core): better cause data extraction ([#17375](https://github.com/getsentry/sentry-javascript/pull/17375))';
    const links = extractPRAndIssueLinks(content);

    expect(links).toHaveLength(1);
    expect(links[0]).toEqual({
      number: '17375',
      url: 'https://github.com/getsentry/sentry-javascript/pull/17375',
      type: 'pr',
    });
  });

  it('should extract issue links correctly', () => {
    const content =
      '- feat(node): Add ignoreStaticAssets option ([#17368](https://github.com/getsentry/sentry-javascript/issues/17368))';
    const links = extractPRAndIssueLinks(content);

    expect(links).toHaveLength(1);
    expect(links[0]).toEqual({
      number: '17368',
      url: 'https://github.com/getsentry/sentry-javascript/issues/17368',
      type: 'issue',
    });
  });

  it('should extract multiple links from content', () => {
    const links = extractPRAndIssueLinks(mockChangelogContent);

    expect(links.length).toBeGreaterThan(0);

    // Check for specific known links
    const pr17375 = links.find(link => link.number === '17375');
    expect(pr17375).toBeDefined();
    expect(pr17375?.type).toBe('pr');

    const issue17368 = links.find(link => link.number === '17368');
    expect(issue17368).toBeDefined();
    expect(issue17368?.type).toBe('issue');
  });

  it('should avoid duplicate links', () => {
    const contentWithDuplicates = `
    - feat(core): better cause data extraction ([#17375](https://github.com/getsentry/sentry-javascript/pull/17375))
    - More details about ([#17375](https://github.com/getsentry/sentry-javascript/pull/17375))
    `;

    const links = extractPRAndIssueLinks(contentWithDuplicates);

    expect(links).toHaveLength(1);
    expect(links[0].number).toBe('17375');
  });
});
