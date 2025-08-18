import { fetchChangelogTool, type FetchChangelogOutput, type ChangelogSection } from '../src/mastra/tools/fetch-changelog-tool';

/**
 * Example demonstrating the use of fetch-changelog-tool with TypeScript types
 * The output schema provides type safety and better IDE support
 */

async function analyzeChangelog() {
  try {
    // Fetch changelog with type-safe output
    const result: FetchChangelogOutput = await fetchChangelogTool.execute({
      context: {
        owner: 'facebook',
        repo: 'react',
        branch: 'main',
        fromVersion: '18.0.0',
        toVersion: '18.3.0'
      }
    });

    // TypeScript knows the exact shape of the result
    console.log(`📋 Changelog Analysis for ${result.repository}`);
    console.log(`📁 Source: ${result.sourceFile} (${result.branch} branch)`);
    console.log(`📊 Sections: ${result.filteredSections} of ${result.totalSections} (${result.versionRange})`);
    console.log('');

    // Analyze each section with type safety
    result.changelog.forEach((section: ChangelogSection) => {
      console.log(`\n🔖 Version ${section.version || 'Unknown'}${section.date ? ` (${section.date})` : ''}`);
      
      // Count PR and issue links
      const prCount = section.prLinks.filter(link => link.type === 'pr').length;
      const issueCount = section.prLinks.filter(link => link.type === 'issue').length;
      
      console.log(`   📌 Links: ${prCount} PRs, ${issueCount} issues`);
      
      // Show first few lines of content
      const firstLines = section.content.split('\n').slice(0, 3).filter(line => line.trim());
      firstLines.forEach(line => console.log(`   ${line.substring(0, 80)}${line.length > 80 ? '...' : ''}`));
    });

    // Example: Extract all PR numbers with type safety
    const allPRNumbers = result.changelog
      .flatMap(section => section.prLinks)
      .filter(link => link.type === 'pr')
      .map(link => link.number);
    
    console.log(`\n📊 Total PRs referenced: ${allPRNumbers.length}`);

    // Example: Find sections with the most changes
    const sectionsWithMostLinks = result.changelog
      .map(section => ({
        version: section.version || 'Unknown',
        linkCount: section.prLinks.length
      }))
      .sort((a, b) => b.linkCount - a.linkCount)
      .slice(0, 3);

    console.log('\n🏆 Top 3 versions by number of PR/issue links:');
    sectionsWithMostLinks.forEach((item, index) => {
      console.log(`   ${index + 1}. v${item.version}: ${item.linkCount} links`);
    });

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

/**
 * Example showing how the output schema helps with error handling
 */
async function safeChangelogFetch(owner: string, repo: string): Promise<FetchChangelogOutput | null> {
  try {
    const result = await fetchChangelogTool.execute({
      context: { owner, repo }
    });
    
    // The output schema ensures we can safely access these properties
    if (result.totalSections === 0) {
      console.warn(`⚠️ No changelog sections found in ${result.repository}`);
      return null;
    }
    
    return result;
  } catch (error) {
    console.error(`Failed to fetch changelog for ${owner}/${repo}:`, error);
    return null;
  }
}

/**
 * Example: Type-safe changelog processing function
 */
function processChangelogSection(section: ChangelogSection): {
  hasBreakingChanges: boolean;
  featureCount: number;
  bugfixCount: number;
} {
  const content = section.content.toLowerCase();
  
  return {
    hasBreakingChanges: content.includes('breaking') || content.includes('deprecated'),
    featureCount: (content.match(/feat(?:ure)?[:\s]/g) || []).length,
    bugfixCount: (content.match(/fix(?:es)?[:\s]/g) || []).length
  };
}

// Run the example
if (require.main === module) {
  analyzeChangelog().catch(console.error);
}