import { githubPRParserTool, gitDiffTool, gitDiffSummaryAgent } from '@evergreen-ai/mastra';

/**
 * Example: Analyzing a GitHub PR using the integrated tools
 *
 * This example shows how to:
 * 1. Parse a GitHub PR URL to get branch information
 * 2. Generate a git diff using the extracted information
 * 3. Get an AI-powered summary of the changes
 */

async function analyzeGitHubPR(prUrl: string, githubToken?: string) {
  console.log(`\n🔍 Analyzing GitHub PR: ${prUrl}\n`);

  try {
    // Step 1: Parse the GitHub PR URL
    console.log('📋 Fetching PR information...');
    const prInfo = await githubPRParserTool.execute({
      context: {
        prUrl,
        includeCommits: true,
        includeDiffUrls: true,
        githubToken,
      },
    });

    console.log(`\n✅ PR #${prInfo.prNumber}: ${prInfo.title}`);
    console.log(`   Author: ${prInfo.author.login}`);
    console.log(`   State: ${prInfo.state}${prInfo.draft ? ' (Draft)' : ''}`);
    console.log(`   Base: ${prInfo.gitDiffInputs.base} (${prInfo.gitDiffInputs.baseSha.substring(0, 7)})`);
    console.log(`   Head: ${prInfo.gitDiffInputs.compare} (${prInfo.gitDiffInputs.headSha.substring(0, 7)})`);
    console.log(
      `   Stats: ${prInfo.stats.commits} commits, ${prInfo.stats.changedFiles} files, +${prInfo.stats.additions}/-${prInfo.stats.deletions}`,
    );

    if (prInfo.gitDiffInputs.isCrossRepository) {
      console.log(`   ⚠️  Cross-repository PR from: ${prInfo.gitDiffInputs.headRepository.fullName}`);
    }

    // Step 2: Generate git diff using the extracted information
    console.log('\n📊 Generating git diff...');

    // First, show the git commands that would be needed
    console.log('\n   Git commands to work with this PR locally:');
    console.log(`   $ ${prInfo.gitCommands.fetchPR}`);
    console.log(`   $ ${prInfo.gitCommands.checkoutPR}`);
    if (prInfo.gitCommands.addRemote) {
      console.log(`   $ ${prInfo.gitCommands.addRemote}`);
      console.log(`   $ ${prInfo.gitCommands.fetchFromFork}`);
    }

    // Note: In a real scenario, you would need to have the repository cloned locally
    // For this example, we'll show how to use the git diff tool with the PR info
    console.log('\n   Git diff configuration:');
    console.log(`   Base: ${prInfo.gitDiffToolConfig.base}`);
    console.log(`   Compare: ${prInfo.gitDiffToolConfig.compare}`);

    // Example of how you would use the git diff tool with this PR
    // (This would work if you have the repository cloned locally)
    /*
    const diff = await gitDiffTool.execute({
      context: {
        repository: './path-to-cloned-repo',
        base: prInfo.gitDiffToolConfig.base,
        compare: prInfo.gitDiffToolConfig.compare,
        diffType: 'stat'
      }
    });
    */

    // Step 3: Show commit information
    if (prInfo.commits && prInfo.commits.length > 0) {
      console.log(`\n📝 Commits (${prInfo.commits.length}):`);
      prInfo.commits.forEach((commit: any, index: number) => {
        const message = commit.message.split('\n')[0]; // First line only
        console.log(`   ${index + 1}. ${commit.sha.substring(0, 7)} - ${message}`);
        console.log(`      Author: ${commit.author.name} <${commit.author.email}>`);
      });
    }

    // Step 4: Show labels
    if (prInfo.labels.length > 0) {
      console.log('\n🏷️  Labels:');
      prInfo.labels.forEach((label: any) => {
        console.log(`   - ${label.name}${label.description ? ` (${label.description})` : ''}`);
      });
    }

    // Step 5: Show diff URLs
    if (prInfo.diffUrls) {
      console.log('\n🔗 Useful URLs:');
      console.log(`   PR: ${prInfo.diffUrls.html}`);
      console.log(`   Files: ${prInfo.diffUrls.files}`);
      console.log(`   Raw diff: ${prInfo.diffUrls.diff}`);
      console.log(`   Patch: ${prInfo.diffUrls.patch}`);
    }

    return prInfo;
  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  }
}

/**
 * Example: Complete PR analysis workflow
 *
 * This shows how to combine all tools for a comprehensive PR review
 */
async function completeWorkflow(prUrl: string, localRepoPath?: string, githubToken?: string) {
  try {
    // Step 1: Get PR information
    const prInfo = await analyzeGitHubPR(prUrl, githubToken);

    // Step 2: If local repo is available, generate actual diff
    if (localRepoPath) {
      console.log('\n\n🔄 Generating actual git diff from local repository...\n');

      const diffResult = await gitDiffTool.execute({
        context: {
          repository: localRepoPath,
          base: prInfo.gitDiffToolConfig.base,
          compare: prInfo.gitDiffToolConfig.compare,
          diffType: 'stat',
        },
      });

      console.log('📈 Diff Statistics:');
      console.log(diffResult.diff);

      // Step 3: Get AI-powered summary
      console.log('\n\n🤖 Generating AI-powered summary...\n');

      const summary = await gitDiffSummaryAgent.generateText({
        prompt: `Analyze the git diff for PR #${prInfo.prNumber}: "${prInfo.title}".
                 The PR is from ${prInfo.gitDiffInputs.base} to ${prInfo.gitDiffInputs.compare}.
                 Use the git diff tool to analyze the changes and provide a comprehensive summary.
                 Repository: ${localRepoPath}
                 Base: ${prInfo.gitDiffToolConfig.base}
                 Compare: ${prInfo.gitDiffToolConfig.compare}`,
        messages: [],
      });

      console.log('📋 AI Summary:');
      console.log(summary.text);
    } else {
      console.log('\n\nℹ️  To generate actual diffs and AI summaries, provide a local repository path.');
      console.log('   Example: completeWorkflow(prUrl, "/path/to/local/repo")');
    }
  } catch (error) {
    console.error('Error in workflow:', error);
  }
}

// Example usage
async function main() {
  // Example 1: Analyze a specific PR
  const examplePRUrl = 'https://github.com/facebook/react/pull/28500';

  console.log('='.repeat(80));
  console.log('GitHub PR Analysis Example');
  console.log('='.repeat(80));

  // Basic PR analysis
  await analyzeGitHubPR(examplePRUrl);

  // Example 2: Complete workflow with local repository
  // Uncomment and adjust the path to test with a local repository
  /*
  const localRepoPath = '/path/to/react/repository';
  await completeWorkflow(examplePRUrl, localRepoPath);
  */

  console.log('\n\n💡 Tip: This tool uses the GitHub API via octokit.js.');
  console.log('   For private repositories or higher rate limits, provide a GitHub personal access token.');
  console.log('   You can either:');
  console.log('   1. Pass it as the githubToken parameter');
  console.log('   2. Set environment variable: GITHUB_TOKEN, GH_TOKEN, or GITHUB_ACCESS_TOKEN');
  console.log('   Create a token at: https://github.com/settings/tokens');
}

// Execute if run directly
if (require.main === module) {
  main().catch(console.error);
}

// Export functions for use in other modules
export { analyzeGitHubPR, completeWorkflow };
