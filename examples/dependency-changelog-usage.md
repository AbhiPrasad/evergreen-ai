# Dependency Changelog Agent Usage Examples

The Dependency Changelog Agent analyzes changelogs and highlights important changes that affect specific dependencies or your application in general.

## Basic Usage

### 1. Analyze all important changes between versions

```typescript
import { dependencyChangelogSummarizerTool } from '../src/mastra/tools/dependency-changelog-agent';

const result = await dependencyChangelogSummarizerTool.execute({
  context: {
    changelogPath: 'CHANGELOG.md',
    fromVersion: '10.0.0',  // excluded from analysis
    toVersion: '10.5.0',    // included in analysis
    dependencies: [],       // empty = all important changes
    includeAllChanges: false
  }
});

console.log(result.summary);
```

### 2. Focus on specific dependencies

```typescript
const result = await dependencyChangelogSummarizerTool.execute({
  context: {
    changelogPath: 'CHANGELOG.md',
    fromVersion: '9.0.0',
    toVersion: '10.0.0',
    dependencies: ['@sentry/core', '@sentry/node', '@sentry/browser'],
    includeAllChanges: false
  }
});

// Will only show changes affecting the specified Sentry packages
console.log(`Found ${result.analysis.totalChanges} relevant changes`);
console.log(result.summary);
```

### 3. Include all changes (not just important ones)

```typescript
const result = await dependencyChangelogSummarizerTool.execute({
  context: {
    changelogPath: 'CHANGELOG.md',
    fromVersion: '10.4.0',
    toVersion: '10.5.0',
    dependencies: [],
    includeAllChanges: true  // includes chores, docs, tests, etc.
  }
});
```

## Understanding the Output

The agent returns a structured analysis:

```typescript
{
  success: true,
  changelogPath: "CHANGELOG.md",
  versionRange: { fromVersion: "10.0.0", toVersion: "10.5.0" },
  dependencyFilter: ["@sentry/core", "@sentry/node"],
  analysis: {
    affectedDependencies: ["@sentry/core", "@sentry/node", "@sentry/cli"],
    totalChanges: 15,
    versionsAnalyzed: ["10.5.0", "10.4.0", "10.3.0", "10.2.0", "10.1.0"],
    breakingChanges: 2,
    newFeatures: 8,
    bugFixes: 4,
    securityUpdates: 1,
    performanceImprovements: 0
  },
  summary: "## Changelog Summary...", // Human-readable markdown summary
  detailedChanges: {
    breaking: [...],
    features: [...],
    fixes: [...],
    security: [...],
    performance: [...]
  }
}
```

## Real-world Examples

### Example 1: Upgrading Sentry SDK

```typescript
// Check what changed when upgrading Sentry from v9 to v10
const sentryUpgrade = await dependencyChangelogSummarizerTool.execute({
  context: {
    changelogPath: 'node_modules/@sentry/javascript/CHANGELOG.md',
    fromVersion: '9.44.0',
    toVersion: '10.5.0',
    dependencies: ['@sentry/core', '@sentry/node', '@sentry/browser', '@sentry/nextjs'],
  }
});

// Focus on breaking changes that might affect your app
if (sentryUpgrade.analysis.breakingChanges > 0) {
  console.log('⚠️ Breaking changes detected:');
  sentryUpgrade.detailedChanges.breaking.forEach(change => {
    console.log(`- ${change.scope}: ${change.description}`);
  });
}
```

### Example 2: Security Audit

```typescript
// Check for security updates in the last few releases
const securityCheck = await dependencyChangelogSummarizerTool.execute({
  context: {
    changelogPath: 'CHANGELOG.md',
    fromVersion: '2.0.0',
    toVersion: '2.5.0',
    dependencies: [], // check all security updates
  }
});

if (securityCheck.analysis.securityUpdates > 0) {
  console.log('🔒 Security updates found:');
  securityCheck.detailedChanges.security.forEach(update => {
    console.log(`- ${update.description}`);
  });
}
```

### Example 3: Feature Discovery

```typescript
// See what new features are available
const featureCheck = await dependencyChangelogSummarizerTool.execute({
  context: {
    changelogPath: 'CHANGELOG.md',
    fromVersion: '1.0.0',
    toVersion: '2.0.0',
    dependencies: ['core', 'api'], // Focus on core and API changes
  }
});

console.log(`🚀 ${featureCheck.analysis.newFeatures} new features available:`);
featureCheck.detailedChanges.features.slice(0, 5).forEach(feature => {
  console.log(`- ${feature.scope}: ${feature.description}`);
});
```

## Integration with CI/CD

You can use this agent in your CI/CD pipeline to automatically analyze dependency updates:

```typescript
// In your CI script
async function checkDependencyUpdates(oldVersion: string, newVersion: string) {
  const analysis = await dependencyChangelogSummarizerTool.execute({
    context: {
      changelogPath: './CHANGELOG.md',
      fromVersion: oldVersion,
      toVersion: newVersion,
      dependencies: process.env.TRACKED_DEPENDENCIES?.split(',') || [],
    }
  });

  if (analysis.success) {
    // Post to Slack, create GitHub issue, etc.
    await notifyTeam({
      title: `Dependency Update: ${oldVersion} → ${newVersion}`,
      summary: analysis.summary,
      breakingChanges: analysis.analysis.breakingChanges,
      securityUpdates: analysis.analysis.securityUpdates,
    });
  }
}
```

## Tips

1. **Version Format**: The agent accepts versions with or without 'v' prefix (`10.5.0` or `v10.5.0`)

2. **Dependency Matching**: Dependency names are matched against:
   - The scope in conventional commits: `feat(package-name):`
   - Package names in dependency bump messages
   - Direct mentions in change descriptions

3. **Important Changes**: When no dependencies are specified, the agent automatically filters for "important" changes including:
   - Breaking changes
   - New features
   - Bug fixes
   - Security updates
   - Performance improvements

4. **File Path**: The `changelogPath` can be relative to your current directory or an absolute path