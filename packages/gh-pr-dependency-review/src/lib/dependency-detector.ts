import type { DependencyInfo } from './types.js';

export function detectDependencyUpgrade(prData: any): DependencyInfo {
  const title = prData.title.toLowerCase();
  const labels = prData.labels ? prData.labels.map((l: any) => l.name?.toLowerCase() || '') : [];

  // Check for common dependency upgrade patterns
  const dependencyKeywords = [
    'bump',
    'update',
    'upgrade',
    'dependency',
    'dependencies',
    'chore(deps)',
    'build(deps)',
    'deps:',
    'npm update',
    'yarn upgrade',
    'go get',
    'pip install',
    'bundle update',
    'mvn dependency',
  ];

  const isDependencyUpgrade = dependencyKeywords.some(
    keyword => title.includes(keyword) || labels.some((label: string) => label.includes(keyword)),
  );

  if (!isDependencyUpgrade) {
    return { isDependencyUpgrade: false };
  }

  // Try to detect ecosystem based on title and common patterns
  let ecosystem: DependencyInfo['ecosystem'] = 'unknown';

  if (
    title.includes('package.json') ||
    title.includes('npm') ||
    title.includes('yarn') ||
    title.includes('typescript') ||
    title.includes('javascript')
  ) {
    ecosystem = 'javascript';
  } else if (title.includes('pom.xml') || title.includes('gradle') || title.includes('maven')) {
    ecosystem = 'java';
  } else if (title.includes('go.mod') || title.includes('go get')) {
    ecosystem = 'go';
  } else if (title.includes('requirements.txt') || title.includes('setup.py') || title.includes('pip')) {
    ecosystem = 'python';
  } else if (title.includes('gemfile') || title.includes('bundle')) {
    ecosystem = 'ruby';
  }

  // Try to extract dependency name and versions from title
  let dependencyName: string | undefined;
  let oldVersion: string | undefined;
  let newVersion: string | undefined;

  // Pattern: "Bump something from 1.0.0 to 2.0.0"
  const bumpPattern = /bump\s+([^\s]+)\s+from\s+([^\s]+)\s+to\s+([^\s]+)/i;
  const bumpMatch = title.match(bumpPattern);
  if (bumpMatch) {
    dependencyName = bumpMatch[1];
    oldVersion = bumpMatch[2];
    newVersion = bumpMatch[3];
  }

  // Pattern: "Update something to 2.0.0"
  const updatePattern = /update\s+([^\s]+)\s+to\s+([^\s]+)/i;
  const updateMatch = title.match(updatePattern);
  if (updateMatch && !bumpMatch) {
    dependencyName = updateMatch[1];
    newVersion = updateMatch[2];
  }

  return {
    isDependencyUpgrade: true,
    ecosystem,
    dependencyName,
    oldVersion,
    newVersion,
  };
}
