import { dependencyAnalysisAgent } from '@sentry/evergreen-ai-agents';

/**
 * Example usage of the Dependency Analysis Agent
 *
 * This example demonstrates how to use the agent to analyze a JavaScript/TypeScript project
 * for dependency usage patterns, security concerns, and optimization opportunities.
 */

async function analyzeDependencies() {
  try {
    console.log('🔍 Starting dependency analysis...');

    // Example 1: Analyze current project
    const currentProjectAnalysis = await dependencyAnalysisAgent.text({
      messages: [
        {
          role: 'user',
          content: `Please analyze the dependencies in the current project directory. 
          Focus on:
          1. Identifying critical dependencies and their usage patterns
          2. Finding potential security vulnerabilities 
          3. Spotting optimization opportunities
          4. Checking for best practice violations
          
          Provide detailed recommendations with specific actions I can take.`,
        },
      ],
    });

    console.log('\n📊 Current Project Analysis:');
    console.log(currentProjectAnalysis);

    // Example 2: Analyze a specific directory with custom patterns
    const customAnalysis = await dependencyAnalysisAgent.text({
      messages: [
        {
          role: 'user',
          content: `Analyze dependencies in a React TypeScript project located at './src' with these specific concerns:
          
          1. Are we using React hooks efficiently?
          2. Can any dependencies be moved to devDependencies?
          3. Are there any bundle size optimization opportunities?
          4. Check for duplicate functionality across dependencies
          5. Identify any outdated or vulnerable packages
          
          Include analysis of:
          - Static imports vs dynamic imports usage
          - Type-only imports vs runtime imports
          - Direct vs transitive dependency impact
          
          Focus on actionable recommendations for a production React app.`,
        },
      ],
    });

    console.log('\n⚛️ React Project Analysis:');
    console.log(customAnalysis);

    // Example 3: Security-focused analysis
    const securityAnalysis = await dependencyAnalysisAgent.text({
      messages: [
        {
          role: 'user',
          content: `Perform a security-focused dependency analysis with emphasis on:
          
          1. Identifying packages with known vulnerabilities
          2. Finding over-privileged dependencies (packages with more permissions than needed)
          3. Detecting potential supply chain risks
          4. Checking for outdated packages that should be updated
          5. Reviewing transitive dependencies for security issues
          
          Provide a security risk assessment with:
          - HIGH/MEDIUM/LOW risk categorization
          - Specific remediation steps
          - Priority order for addressing issues
          - Alternative package recommendations where applicable`,
        },
      ],
    });

    console.log('\n🔒 Security Analysis:');
    console.log(securityAnalysis);

    // Example 4: Bundle optimization analysis
    const bundleOptimizationAnalysis = await dependencyAnalysisAgent.text({
      messages: [
        {
          role: 'user',
          content: `Analyze the project for bundle size optimization opportunities:
          
          1. Identify the heaviest dependencies affecting bundle size
          2. Find packages that could be dynamically imported instead of statically imported
          3. Detect tree-shaking opportunities and dead code
          4. Recommend lighter alternatives to heavy packages
          5. Identify packages that should be externalized in bundling
          
          For each recommendation, provide:
          - Current impact on bundle size
          - Potential savings
          - Implementation difficulty (Easy/Medium/Hard)
          - Code examples showing the optimization
          
          Focus on webpack/Vite/Rollup optimization strategies.`,
        },
      ],
    });

    console.log('\n📦 Bundle Optimization Analysis:');
    console.log(bundleOptimizationAnalysis);
  } catch (error) {
    console.error('❌ Error during analysis:', error);
  }
}

/**
 * Example of using the agent for monorepo analysis
 */
async function analyzeMonorepo() {
  try {
    console.log('\n🏢 Analyzing monorepo dependencies...');

    const monorepoAnalysis = await dependencyAnalysisAgent.text({
      messages: [
        {
          role: 'user',
          content: `Analyze this monorepo for dependency management issues:
          
          1. Identify duplicate dependencies across packages
          2. Find dependencies that should be hoisted to the root
          3. Detect version mismatches between packages
          4. Check for proper peer dependency management
          5. Identify packages that could share common dependencies
          
          Monorepo-specific recommendations needed:
          - Workspace optimization strategies
          - Dependency hoisting opportunities  
          - Internal package dependency management
          - Build and deployment optimization
          
          Analyze both npm workspaces and pnpm workspace patterns.`,
        },
      ],
    });

    console.log(monorepoAnalysis);
  } catch (error) {
    console.error('❌ Error during monorepo analysis:', error);
  }
}

/**
 * Example of migration analysis
 */
async function analyzeMigration() {
  try {
    console.log('\n🔄 Analyzing for migration opportunities...');

    const migrationAnalysis = await dependencyAnalysisAgent.text({
      messages: [
        {
          role: 'user',
          content: `Analyze the codebase for potential migration opportunities:
          
          1. CommonJS to ES Modules migration readiness
          2. Legacy packages that have modern alternatives
          3. Packages that could be replaced with native browser APIs
          4. Dependencies that could be replaced with smaller alternatives
          5. TypeScript adoption opportunities (JS packages with @types)
          
          For each migration opportunity, provide:
          - Effort estimation (hours/days)
          - Risk assessment
          - Step-by-step migration plan
          - Breaking changes to consider
          - Rollback strategy
          
          Prioritize migrations by impact vs effort ratio.`,
        },
      ],
    });

    console.log(migrationAnalysis);
  } catch (error) {
    console.error('❌ Error during migration analysis:', error);
  }
}

// Run examples (uncomment to execute)
if (require.main === module) {
  console.log('🚀 Running Dependency Analysis Examples\n');

  (async () => {
    await analyzeDependencies();
    await analyzeMonorepo();
    await analyzeMigration();
  })();
}

export { analyzeDependencies, analyzeMonorepo, analyzeMigration };
