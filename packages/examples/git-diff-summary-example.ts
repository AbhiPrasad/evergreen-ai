import { gitDiffTool, gitDiffSummaryAgent } from '@evergreen-ai/mastra';

// Example 1: Using the git diff tool directly
async function useGitDiffTool() {
  console.log('=== Git Diff Tool Example ===\n');

  try {
    // Get diff between main and current branch
    const diffResult = await gitDiffTool.execute({
      context: {
        repository: '.', // Current repository
        base: 'main',
        compare: 'HEAD',
        diffType: 'unified',
        includeContext: 5,
      },
    });

    console.log(`Diff Summary:`);
    console.log(`- Repository: ${diffResult.repository}`);
    console.log(`- Base: ${diffResult.base}`);
    console.log(`- Compare: ${diffResult.compare}`);
    console.log(`- Current Branch: ${diffResult.currentBranch}`);
    console.log(`- Files Changed: ${diffResult.stats.filesChanged}`);
    console.log(`- Insertions: ${diffResult.stats.insertions}`);
    console.log(`- Deletions: ${diffResult.stats.deletions}`);
    console.log('\nChanged Files:');
    diffResult.stats.files.forEach(file => {
      console.log(`  - ${file.path} (${file.status})`);
    });

    // Get diff with file statistics
    const statResult = await gitDiffTool.execute({
      context: {
        repository: '.',
        base: 'main',
        diffType: 'stat',
      },
    });

    console.log('\n=== Diff Statistics ===');
    console.log(statResult.diff);
  } catch (error) {
    console.error('Error:', error);
  }
}

// Example 2: Using the git diff summary agent
async function useGitDiffSummaryAgent() {
  console.log('\n=== Git Diff Summary Agent Example ===\n');

  try {
    // Generate a comprehensive summary of changes
    const summary = await gitDiffSummaryAgent.generateText({
      prompt: `Analyze the git diff between the main branch and the current HEAD. 
               Focus on identifying the types of changes, their purpose, and any potential issues.
               Use the git diff tool to get the changes.`,
      messages: [],
    });

    console.log('Agent Summary:');
    console.log(summary.text);

    // You can also provide specific instructions
    const focusedSummary = await gitDiffSummaryAgent.generateText({
      prompt: `Analyze the git diff for the last 3 commits and highlight any security-sensitive changes 
               or breaking API changes. Use git diff HEAD~3..HEAD`,
      messages: [],
    });

    console.log('\n\nFocused Analysis:');
    console.log(focusedSummary.text);
  } catch (error) {
    console.error('Error:', error);
  }
}

// Run examples
async function main() {
  await useGitDiffTool();
  await useGitDiffSummaryAgent();
}

// Execute if run directly
if (require.main === module) {
  main().catch(console.error);
}
