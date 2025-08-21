import type { APIRoute } from 'astro';
import * as Sentry from '@sentry/astro';
import {
  githubPRAnalyzerAgent,
  gitDiffSummaryAgent,
  changelogSummaryAgent,
  dependencyUpgradeRecommendationAgent,
  githubPREcosystemDetectorAgent,
} from '@sentry/evergreen-ai-agents';
import type { AnalysisStep } from '../../lib/types.js';
import { getDependencyAnalysisAgent } from '../../lib/agent-selector.js';

export const GET: APIRoute = async ({ url }) => {
  try {
    const prUrl = url.searchParams.get('prUrl');

    if (!prUrl) {
      return new Response(JSON.stringify({ error: 'PR URL is required' }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
        },
      });
    }

    const steps: AnalysisStep[] = [
      { id: 'parse-pr', name: 'Parse GitHub PR', status: 'pending' },
      { id: 'detect-dependency', name: 'Detect Dependency Upgrade', status: 'pending' },
      { id: 'git-diff-summary', name: 'Analyze Git Diff', status: 'pending' },
      { id: 'changelog-summary', name: 'Get Changelog Summary', status: 'pending' },
      { id: 'dependency-diff', name: 'Analyze Dependency Changes', status: 'pending' },
      { id: 'ecosystem-analysis', name: 'Ecosystem-Specific Analysis', status: 'pending' },
      { id: 'recommendation', name: 'Generate Recommendation', status: 'pending' },
    ];

    // Step 1: Parse GitHub PR
    steps[0].status = 'running';
    try {
      const prompt = `Please parse and analyze the GitHub PR at: ${prUrl}
      
      Include commits and diff URLs in your analysis. Return the parsed PR data in JSON format.`;

      const result = await githubPRAnalyzerAgent.generate(prompt);

      console.log('result', result);

      // Extract JSON from the response
      let prData;
      try {
        const jsonMatch = result.text.match(/```json\s*([\s\S]*?)\s*```/);
        if (jsonMatch) {
          prData = JSON.parse(jsonMatch[1]);
        } else {
          // Try to parse the entire response as JSON
          prData = JSON.parse(result.text);
        }
      } catch (parseError) {
        throw new Error('Failed to parse PR data from agent response');
      }

      steps[0].status = 'completed';
      steps[0].result = prData;
    } catch (error) {
      steps[0].status = 'error';
      steps[0].error = error instanceof Error ? error.message : 'Unknown error';
      return new Response(JSON.stringify({ error: steps[0].error, steps }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
        },
      });
    }

    const prData = steps[0].result;

    // Step 2: Detect ecosystem and dependency upgrade using AI agent
    steps[1].status = 'running';
    let dependencyInfo;
    try {
      const ecosystemPrompt = `Please analyze the GitHub PR for ecosystem detection and dependency upgrade information: ${prUrl}
      
      Use the provided tools to:
      1. Parse the GitHub PR details
      2. Analyze the git diff to identify changed files
      3. Detect the programming language ecosystem
      4. Extract dependency upgrade information
      
      Return comprehensive ecosystem and dependency analysis in JSON format.`;

      const ecosystemResult = await githubPREcosystemDetectorAgent.generate(ecosystemPrompt);

      // Extract JSON from the response
      let ecosystemData;
      try {
        const jsonMatch = ecosystemResult.text.match(/```json\s*([\s\S]*?)\s*```/);
        if (jsonMatch) {
          ecosystemData = JSON.parse(jsonMatch[1]);
        } else {
          // Try to parse the entire response as JSON
          ecosystemData = JSON.parse(ecosystemResult.text);
        }
      } catch (parseError) {
        throw new Error('Failed to parse ecosystem data from agent response');
      }

      // Convert to DependencyInfo format for compatibility
      dependencyInfo = {
        isDependencyUpgrade: ecosystemData.isDependencyUpgrade || false,
        ecosystem: ecosystemData.ecosystem || 'unknown',
        dependencyName: ecosystemData.dependencyInfo?.name,
        oldVersion: ecosystemData.dependencyInfo?.oldVersion,
        newVersion: ecosystemData.dependencyInfo?.newVersion,
        changeType: ecosystemData.dependencyInfo?.changeType,
        confidence: ecosystemData.confidence,
        detectedFiles: ecosystemData.detectedFiles,
        ecosystemDetails: ecosystemData.ecosystemDetails,
      };

      steps[1].status = 'completed';
      steps[1].result = dependencyInfo;
    } catch (error) {
      steps[1].status = 'error';
      steps[1].error = error instanceof Error ? error.message : 'Unknown error';

      // Set fallback dependency info
      dependencyInfo = {
        isDependencyUpgrade: false,
        ecosystem: 'unknown',
      };

      return new Response(JSON.stringify({ error: steps[1].error, steps }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
        },
      });
    }

    if (!dependencyInfo.isDependencyUpgrade) {
      return new Response(
        JSON.stringify({
          error: 'This PR does not appear to be a dependency upgrade',
          steps,
          dependencyInfo,
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      );
    }

    await Sentry.startSpan({ name: 'parallel-analysis', forceTransaction: true }, async () => {
      // Steps 3-6: Run parallel analysis
      const analysisPromises: Promise<void>[] = [];

      // Step 3: Git diff summary
      analysisPromises.push(
        (async () => {
          steps[2].status = 'running';
          try {
            const prompt = `Analyze the git diff for PR #${prData.prNumber}: "${prData.title}"
        
        Repository: ${prData.repository.fullName}
        Base branch: ${prData.gitDiffInputs.base}
        Compare branch: ${prData.gitDiffInputs.compare}
        
        Please provide a comprehensive analysis of the changes focusing on dependency upgrades and their impact.`;

            const gitDiffResult = await gitDiffSummaryAgent.generate(prompt);
            steps[2].status = 'completed';
            steps[2].result = gitDiffResult.text;
          } catch (error) {
            steps[2].status = 'error';
            steps[2].error = error instanceof Error ? error.message : 'Unknown error';
          }
        })(),
      );

      // Step 4: Changelog summary
      analysisPromises.push(
        (async () => {
          if (!dependencyInfo.dependencyName) {
            steps[3].status = 'error';
            steps[3].error = 'Cannot fetch changelog without dependency name';
            return;
          }

          steps[3].status = 'running';
          try {
            const prompt = `Analyze the changelog for ${dependencyInfo.dependencyName} from version ${dependencyInfo.oldVersion || 'unknown'} to ${dependencyInfo.newVersion || 'latest'}.
        
        Ecosystem: ${dependencyInfo.ecosystem || 'unknown'}
        
        Please provide a comprehensive summary of the changes, focusing on:
        - Breaking changes
        - New features  
        - Bug fixes
        - Security updates
        - Performance improvements
        
        Include all relevant version information and migration notes.`;

            const changelogResult = await changelogSummaryAgent.generate(prompt);
            steps[3].status = 'completed';
            steps[3].result = changelogResult.text;
          } catch (error) {
            steps[3].status = 'error';
            steps[3].error = error instanceof Error ? error.message : 'Unknown error';
          }
        })(),
      );

      // Step 5: Dependency diff analysis (using git diff again but focused on dependency)
      analysisPromises.push(
        (async () => {
          steps[4].status = 'running';
          try {
            const prompt = `Analyze the git diff specifically for dependency changes in PR #${prData.prNumber}: "${prData.title}"
        
        Repository: ${prData.repository.fullName}
        Focus on: ${dependencyInfo.dependencyName} upgrade from ${dependencyInfo.oldVersion} to ${dependencyInfo.newVersion}
        
        Please analyze the specific dependency-related file changes and their impact on the codebase.`;

            const dependencyDiffResult = await gitDiffSummaryAgent.generate(prompt);
            steps[4].status = 'completed';
            steps[4].result = dependencyDiffResult.text;
          } catch (error) {
            steps[4].status = 'error';
            steps[4].error = error instanceof Error ? error.message : 'Unknown error';
          }
        })(),
      );

      // Step 6: Ecosystem-specific analysis
      analysisPromises.push(
        (async () => {
          const ecosystemAgent = getDependencyAnalysisAgent(dependencyInfo.ecosystem || 'unknown');
          if (!ecosystemAgent) {
            steps[5].status = 'error';
            steps[5].error = `No analysis agent available for ecosystem: ${dependencyInfo.ecosystem}`;
            return;
          }

          steps[5].status = 'running';
          try {
            const prompt = `Perform ${dependencyInfo.ecosystem} ecosystem-specific analysis for the dependency upgrade in PR #${prData.prNumber}: "${prData.title}"
        
        Repository: ${prData.repository.fullName}
        Dependency: ${dependencyInfo.dependencyName}
        Version change: ${dependencyInfo.oldVersion} → ${dependencyInfo.newVersion}
        
        Please analyze ecosystem-specific concerns like:
        - Package compatibility
        - Breaking changes specific to ${dependencyInfo.ecosystem}
        - Security implications
        - Performance impact
        - Migration requirements`;

            const ecosystemResult = await ecosystemAgent.generate(prompt);
            steps[5].status = 'completed';
            steps[5].result = ecosystemResult.text;
          } catch (error) {
            steps[5].status = 'error';
            steps[5].error = error instanceof Error ? error.message : 'Unknown error';
          }
        })(),
      );

      // Wait for all parallel analyses to complete
      await Promise.all(analysisPromises);
    });

    // Step 7: Generate recommendation
    steps[6].status = 'running';
    try {
      const prompt = `Based on the comprehensive analysis below, provide a dependency upgrade recommendation for PR #${prData.prNumber}: "${prData.title}"

**Dependency Information:**
- Name: ${dependencyInfo.dependencyName}
- Ecosystem: ${dependencyInfo.ecosystem}
- Version change: ${dependencyInfo.oldVersion} → ${dependencyInfo.newVersion}

**Git Diff Analysis:**
${steps[2].result || 'Not available'}

**Changelog Summary:**
${steps[3].result || 'Not available'}

**Dependency-specific Changes:**
${steps[4].result || 'Not available'}

**Ecosystem Analysis:**
${steps[5].result || 'Not available'}

**PR Statistics:**
- Files changed: ${prData.stats.changedFiles}
- Lines added: ${prData.stats.additions}
- Lines deleted: ${prData.stats.deletions}
- Commits: ${prData.stats.commits}

Please provide a comprehensive recommendation covering:
1. Overall assessment (approve/review/reject)
2. Risk level (low/medium/high)
3. Key benefits of the upgrade
4. Potential risks and concerns
5. Required testing recommendations
6. Migration steps if needed
7. Security implications
8. Performance impact`;

      const recommendation = await dependencyUpgradeRecommendationAgent.generate(prompt);
      steps[6].status = 'completed';
      steps[6].result = recommendation.text;
    } catch (error) {
      steps[6].status = 'error';
      steps[6].error = error instanceof Error ? error.message : 'Unknown error';
    }

    return new Response(
      JSON.stringify({
        success: true,
        steps,
        dependencyInfo,
        recommendation: steps[6].result,
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      },
    );
  } catch (error) {
    console.error('Error in analyze-pr', error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
        },
      },
    );
  }
};
