import { Request, Response } from 'express';
import {
  githubPRAnalyzerAgent,
  gitDiffSummaryAgent,
  changelogSummaryAgent,
  dependencyUpgradeRecommendationAgent,
} from '@sentry/evergreen-ai-agents';
import { AnalysisStep, DependencyInfo } from '../types.js';
import { detectDependencyUpgrade } from '../services/dependency-detector.js';
import { getDependencyAnalysisAgent } from '../services/agent-selector.js';

export async function analyzePR(req: Request, res: Response) {
  try {
    const prUrl = req.query.prUrl as string;

    if (!prUrl) {
      return res.status(400).json({ error: 'PR URL is required' });
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
      return res.status(400).json({ error: steps[0].error, steps });
    }

    const prData = steps[0].result;

    // Step 2: Detect if this is a dependency upgrade
    steps[1].status = 'running';
    const dependencyInfo = detectDependencyUpgrade(prData);
    steps[1].status = 'completed';
    steps[1].result = dependencyInfo;

    if (!dependencyInfo.isDependencyUpgrade) {
      return res.status(200).json({
        error: 'This PR does not appear to be a dependency upgrade',
        steps,
        dependencyInfo,
      });
    }

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

    return res.status(200).json({
      success: true,
      steps,
      dependencyInfo,
      recommendation: steps[6].result,
    });
  } catch (error) {
    console.error('Error in analyze-pr', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
