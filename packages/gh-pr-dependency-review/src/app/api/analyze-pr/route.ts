import { NextRequest, NextResponse } from 'next/server';
import {
  githubPRAnalyzerAgent,
  gitDiffSummaryAgent,
  changelogSummaryAgent,
  dependencyUpgradeRecommendationAgent,
  javascriptTypeScriptDependencyAnalysisAgent,
  javaDependencyAnalysisAgent,
  goDependencyAnalysisAgent,
  pythonDependencyAnalysisAgent,
  rubyDependencyAnalysisAgent,
} from '@sentry/evergreen-ai-agents';

interface PRLabel {
  name: string;
  color: string;
  description?: string;
}

interface PRAnalysis {
  prNumber: number;
  title: string;
  state: string;
  repository: {
    owner: string;
    name: string;
    fullName: string;
  };
  author: {
    login: string;
    type: string;
  };
  stats: {
    commits: number;
    additions: number;
    deletions: number;
    changedFiles: number;
  };
  labels: PRLabel[];
  gitDiffInputs: {
    base: string;
    compare: string;
    baseSha: string;
    headSha: string;
  };
}

interface AnalysisResult {
  isDependencyUpgrade: boolean;
  ecosystem?: string;
  prAnalysis?: PRAnalysis;
  gitDiffSummary?: string;
  changelogSummary?: string;
  dependencyAnalysis?: string;
  recommendation?: string;
  error?: string;
}

// Map ecosystems to their respective dependency analysis agents
const ecosystemAgents = {
  javascript: javascriptTypeScriptDependencyAnalysisAgent,
  typescript: javascriptTypeScriptDependencyAnalysisAgent,
  java: javaDependencyAnalysisAgent,
  go: goDependencyAnalysisAgent,
  python: pythonDependencyAnalysisAgent,
  ruby: rubyDependencyAnalysisAgent,
};

// Helper function to detect if PR is a dependency upgrade and determine ecosystem
function analyzePRForDependencies(prAnalysis: PRAnalysis): { isDependencyUpgrade: boolean; ecosystem?: string } {
  const title = prAnalysis.title?.toLowerCase() || '';
  const labels = prAnalysis.labels?.map((l: PRLabel) => l.name.toLowerCase()) || [];

  // Check for common dependency upgrade patterns in title
  const dependencyKeywords = [
    'bump',
    'update',
    'upgrade',
    'deps',
    'dependencies',
    'dependency',
    'chore(deps)',
    'build(deps)',
    'npm update',
    'yarn upgrade',
    'pip upgrade',
    'go mod',
    'composer update',
    'bundle update',
    'gem update',
  ];

  const isDependencyUpgrade =
    dependencyKeywords.some(keyword => title.includes(keyword)) ||
    labels.some((label: string) => ['dependencies', 'dependency-update', 'deps'].includes(label));

  if (!isDependencyUpgrade) {
    return { isDependencyUpgrade: false };
  }

  // Determine ecosystem based on patterns in title/labels
  let ecosystem: string | undefined;

  if (
    title.includes('package.json') ||
    title.includes('yarn.lock') ||
    title.includes('package-lock.json') ||
    title.includes('npm') ||
    title.includes('yarn') ||
    title.includes('pnpm') ||
    labels.some((l: string) => ['javascript', 'typescript', 'npm', 'yarn'].includes(l))
  ) {
    ecosystem = 'javascript';
  } else if (
    title.includes('pom.xml') ||
    title.includes('build.gradle') ||
    title.includes('maven') ||
    title.includes('gradle') ||
    title.includes('sbt') ||
    labels.some((l: string) => ['java', 'maven', 'gradle'].includes(l))
  ) {
    ecosystem = 'java';
  } else if (
    title.includes('go.mod') ||
    title.includes('go mod') ||
    labels.some((l: string) => ['go', 'golang'].includes(l))
  ) {
    ecosystem = 'go';
  } else if (
    title.includes('requirements.txt') ||
    title.includes('poetry.lock') ||
    title.includes('pipfile') ||
    title.includes('pip') ||
    title.includes('poetry') ||
    labels.some((l: string) => ['python', 'pip', 'poetry'].includes(l))
  ) {
    ecosystem = 'python';
  } else if (
    title.includes('gemfile') ||
    title.includes('bundle') ||
    labels.some((l: string) => ['ruby', 'gem', 'bundler'].includes(l))
  ) {
    ecosystem = 'ruby';
  }

  return { isDependencyUpgrade, ecosystem };
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const prUrl = searchParams.get('prUrl');

    if (!prUrl) {
      return NextResponse.json(
        { error: 'Missing required query parameter: prUrl' },
        {
          status: 400,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET',
            'Access-Control-Allow-Headers': 'Content-Type',
          },
        },
      );
    }

    // Validate that prUrl is a valid GitHub PR URL
    const githubPrPattern = /^https:\/\/github\.com\/[\w\-\.]+\/[\w\-\.]+\/pull\/\d+$/;
    if (!githubPrPattern.test(prUrl)) {
      return NextResponse.json(
        {
          error: 'Invalid prUrl format. Expected GitHub PR URL format: https://github.com/owner/repo/pull/number',
        },
        {
          status: 400,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET',
            'Access-Control-Allow-Headers': 'Content-Type',
          },
        },
      );
    }

    const result: AnalysisResult = {
      isDependencyUpgrade: false,
    };

    // Step 1: Parse and analyze the GitHub PR
    console.log('Step 1: Analyzing GitHub PR...');
    const prAnalysisResult = await githubPRAnalyzerAgent.generate(`Analyze this GitHub PR: ${prUrl}`);

    let prAnalysis: PRAnalysis;
    try {
      // Extract JSON from the agent response
      const jsonMatch = prAnalysisResult.text.match(/```json\n([\s\S]*?)\n```/);
      if (jsonMatch) {
        prAnalysis = JSON.parse(jsonMatch[1]);
      } else {
        throw new Error('Could not parse JSON response from PR analyzer');
      }
    } catch (error) {
      console.error('Error parsing PR analysis:', error);
      return NextResponse.json(
        { error: 'Failed to parse PR analysis response' },
        {
          status: 500,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET',
            'Access-Control-Allow-Headers': 'Content-Type',
          },
        },
      );
    }

    result.prAnalysis = prAnalysis;

    // Step 2: Determine if this is a dependency upgrade PR and identify ecosystem
    console.log('Step 2: Checking if PR is a dependency upgrade...');
    const { isDependencyUpgrade, ecosystem } = analyzePRForDependencies(prAnalysis);

    result.isDependencyUpgrade = isDependencyUpgrade;
    result.ecosystem = ecosystem;

    // Step 3: If not a dependency upgrade, stop analysis
    if (!isDependencyUpgrade) {
      console.log('PR is not a dependency upgrade, stopping analysis');
      return NextResponse.json(result, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    console.log(`Step 3: Detected dependency upgrade PR for ecosystem: ${ecosystem || 'unknown'}`);

    // Steps 4-7: Run parallel analysis (git diff, changelog, dependency analysis)
    console.log('Steps 4-7: Running parallel analysis...');
    const parallelPromises = [];

    // Step 4: Git diff summary
    const gitDiffPrompt = `Analyze the git diff for this dependency upgrade PR: ${prUrl}. 
    Focus on identifying:
    - Which dependencies are being upgraded
    - Version changes (from -> to)
    - Impact on the codebase
    - Files affected by the dependency changes
    
    Repository: ${prAnalysis.repository.fullName}
    Base: ${prAnalysis.gitDiffInputs.base}
    Compare: ${prAnalysis.gitDiffInputs.compare}
    Base SHA: ${prAnalysis.gitDiffInputs.baseSha}
    Head SHA: ${prAnalysis.gitDiffInputs.headSha}`;

    parallelPromises.push(
      gitDiffSummaryAgent
        .generate(gitDiffPrompt)
        .then(result => ({
          type: 'gitDiff',
          data: result.text,
        }))
        .catch(error => ({
          type: 'gitDiff',
          error: error.message,
        })),
    );

    // Step 5: Changelog summary (extract dependency info from git diff first)
    const changelogPrompt = `Analyze changelogs for dependencies being upgraded in this PR: ${prUrl}.
    
    Based on the PR analysis, find and summarize changelogs for the upgraded dependencies.
    Focus on:
    - New features added
    - Bug fixes
    - Breaking changes
    - Security updates
    - Performance improvements
    
    PR Title: ${prAnalysis.title}
    Repository: ${prAnalysis.repository.fullName}`;

    parallelPromises.push(
      changelogSummaryAgent
        .generate(changelogPrompt)
        .then(result => ({
          type: 'changelog',
          data: result.text,
        }))
        .catch(error => ({
          type: 'changelog',
          error: error.message,
        })),
    );

    // Step 7: Ecosystem-specific dependency analysis (if we have an agent for this ecosystem)
    if (ecosystem && ecosystemAgents[ecosystem as keyof typeof ecosystemAgents]) {
      const dependencyAgent = ecosystemAgents[ecosystem as keyof typeof ecosystemAgents];
      const dependencyPrompt = `Analyze the ${ecosystem} dependencies being upgraded in this PR: ${prUrl}.
      
      Focus on:
      - Dependency upgrade patterns specific to ${ecosystem}
      - Version compatibility issues
      - Breaking changes in the ${ecosystem} ecosystem
      - Security implications
      - Performance considerations
      
      PR Details:
      - Title: ${prAnalysis.title}
      - Repository: ${prAnalysis.repository.fullName}
      - Files changed: ${prAnalysis.stats.changedFiles}`;

      parallelPromises.push(
        dependencyAgent
          .generate(dependencyPrompt)
          .then(result => ({
            type: 'dependencyAnalysis',
            data: result.text,
          }))
          .catch(error => ({
            type: 'dependencyAnalysis',
            error: error.message,
          })),
      );
    }

    // Wait for all parallel analysis to complete
    const parallelResults = await Promise.all(parallelPromises);

    // Process results
    for (const analysisResult of parallelResults) {
      if (analysisResult.type === 'gitDiff') {
        result.gitDiffSummary = 'data' in analysisResult ? analysisResult.data : `Error: ${analysisResult.error}`;
      } else if (analysisResult.type === 'changelog') {
        result.changelogSummary = 'data' in analysisResult ? analysisResult.data : `Error: ${analysisResult.error}`;
      } else if (analysisResult.type === 'dependencyAnalysis') {
        result.dependencyAnalysis = 'data' in analysisResult ? analysisResult.data : `Error: ${analysisResult.error}`;
      }
    }

    // Step 9: Generate recommendation using all gathered information
    console.log('Step 9: Generating dependency upgrade recommendation...');
    const recommendationPrompt = `Based on the comprehensive analysis below, provide a recommendation for this dependency upgrade PR.

## PR Analysis:
${JSON.stringify(prAnalysis, null, 2)}

## Ecosystem: ${ecosystem || 'unknown'}

## Git Diff Summary:
${result.gitDiffSummary || 'Not available'}

## Changelog Summary:
${result.changelogSummary || 'Not available'}

## Dependency Analysis:
${result.dependencyAnalysis || 'Not available'}

## Instructions:
Provide a comprehensive recommendation that includes:
1. Whether to approve/merge this dependency upgrade
2. Risk assessment (LOW/MEDIUM/HIGH)
3. Testing recommendations
4. Any manual steps required
5. Timeline suggestions
6. Rollback considerations

Focus on practical, actionable advice for the development team.`;

    try {
      const recommendationResult = await dependencyUpgradeRecommendationAgent.generate(recommendationPrompt);
      result.recommendation = recommendationResult.text;
    } catch (error) {
      console.error('Error generating recommendation:', error);
      result.recommendation = `Error generating recommendation: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }

    console.log('Analysis complete');
    return NextResponse.json(result, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  } catch (error) {
    console.error('Error analyzing PR:', error);
    return NextResponse.json(
      {
        error: 'Failed to analyze PR',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      {
        status: 500,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      },
    );
  }
}

// Handle OPTIONS request for CORS preflight
export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
