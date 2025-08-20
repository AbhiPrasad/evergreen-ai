import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

// Schema for SBT dependency information
const sbtDependencySchema = z.object({
  organization: z.string().describe('SBT organization (same as Maven groupId)'),
  name: z.string().describe('SBT name (artifact name)'),
  revision: z.string().nullable().describe('Dependency version/revision'),
  configuration: z.string().describe('SBT configuration (Compile, Test, Runtime, Provided, etc.)'),
  crossVersion: z.enum(['disabled', 'binary', 'full']).describe('Scala cross-version strategy'),
  isScalaLibrary: z.boolean().describe('Whether this is a Scala library (uses %% syntax)'),
  isTransitive: z.boolean().describe('Whether this is a transitive dependency'),
  exclusions: z.array(z.object({
    organization: z.string(),
    name: z.string(),
  })).describe('Excluded transitive dependencies'),
  usageCount: z.number().describe('Number of times this dependency appears'),
  criticality: z.enum(['HIGH', 'MEDIUM', 'LOW']).describe('Assessed criticality'),
  criticalityReasons: z.array(z.string()).describe('Reasons for criticality assessment'),
  coordinates: z.string().describe('Full SBT dependency coordinates'),
  dependencyPath: z.array(z.string()).describe('Dependency resolution path'),
  isEvicted: z.boolean().describe('Whether this dependency was evicted'),
  evictedBy: z.string().optional().describe('Version that evicted this dependency'),
});

const sbtProjectSchema = z.object({
  name: z.string().describe('Project name'),
  organization: z.string().optional().describe('Project organization'),
  version: z.string().describe('Project version'),
  scalaVersion: z.string().optional().describe('Scala version'),
  sbtVersion: z.string().optional().describe('SBT version'),
  buildFilePath: z.string().describe('Path to build.sbt file'),
  isMultiProject: z.boolean().describe('Whether this is a multi-project build'),
  subProjects: z.array(z.object({
    name: z.string(),
    path: z.string(),
    dependencies: z.array(z.string()),
  })).describe('Sub-projects in multi-project build'),
  plugins: z.array(z.object({
    name: z.string(),
    version: z.string().optional(),
    isAutoPlugin: z.boolean(),
  })).describe('SBT plugins used'),
  resolvers: z.array(z.string()).describe('Custom resolvers/repositories'),
  compilerOptions: z.array(z.string()).describe('Scala compiler options'),
});

const sbtAnalysisSchema = z.object({
  projectPath: z.string().describe('Path to analyzed SBT project'),
  projectInfo: sbtProjectSchema.describe('SBT project information'),
  dependencies: z.array(sbtDependencySchema).describe('All dependencies found'),
  configurations: z.array(z.object({
    name: z.string(),
    extends: z.array(z.string()),
    dependencyCount: z.number(),
    description: z.string().optional(),
  })).describe('SBT configurations'),
  tasks: z.array(z.object({
    name: z.string(),
    description: z.string().optional(),
    inputTypes: z.array(z.string()),
    outputType: z.string().optional(),
  })).describe('Available SBT tasks'),
  analysisResults: z.object({
    totalDependencies: z.number(),
    directDependencies: z.number(),
    transitiveDependencies: z.number(),
    scalaDependencies: z.number(),
    javaDependencies: z.number(),
    testDependencies: z.number(),
    compileDependencies: z.number(),
    runtimeDependencies: z.number(),
    providedDependencies: z.number(),
    highCriticalityDeps: z.number(),
    mediumCriticalityDeps: z.number(),
    lowCriticalityDeps: z.number(),
    evictedDependencies: z.number(),
    snapshotDependencies: z.number(),
    crossVersionConflicts: z.number(),
  }),
  recommendations: z.array(z.string()).describe('Recommendations for SBT project'),
});

export type SbtDependency = z.infer<typeof sbtDependencySchema>;
export type SbtProject = z.infer<typeof sbtProjectSchema>;
export type SbtAnalysis = z.infer<typeof sbtAnalysisSchema>;

/**
 * Tool for analyzing SBT project dependencies
 */
export const sbtDependencyAnalyzerTool = createTool({
  id: 'sbt-dependency-analyzer',
  description: 'Analyzes SBT build files to identify Scala/Java dependencies, cross-version issues, and provides optimization recommendations',
  inputSchema: z.object({
    projectPath: z.string().describe('Path to SBT project directory').optional(),
    includeDependencyTree: z.boolean().describe('Whether to analyze dependency tree using SBT commands').optional(),
    includeTasks: z.boolean().describe('Whether to analyze available SBT tasks').optional(),
    analyzeEvictions: z.boolean().describe('Whether to analyze dependency evictions').optional(),
    timeout: z.number().describe('Timeout in milliseconds for SBT commands').optional(),
  }),
  outputSchema: sbtAnalysisSchema,
  execute: async ({ context }) => {
    const {
      projectPath = process.cwd(),
      includeDependencyTree = false,
      includeTasks = true,
      analyzeEvictions = true,
      timeout = 60000, // SBT can be slower than Maven/Gradle
    } = context;

    const resolvedPath = path.resolve(projectPath);
    const buildSbt = path.join(resolvedPath, 'build.sbt');
    const projectDir = path.join(resolvedPath, 'project');
    
    if (!fs.existsSync(buildSbt)) {
      throw new Error(`No build.sbt found at: ${buildSbt}`);
    }

    try {
      // Parse build.sbt
      const buildContent = fs.readFileSync(buildSbt, 'utf8');
      
      // Extract project information
      const projectInfo = await extractSbtProjectInfo(buildContent, resolvedPath, timeout);
      
      // Get dependencies using SBT commands if available
      let dependencies: SbtDependency[] = [];
      let configurations: any[] = [];
      
      try {
        const depResult = await getSbtDependencies(resolvedPath, timeout);
        dependencies = depResult.dependencies;
        configurations = depResult.configurations;
      } catch (error) {
        // Fallback to build file parsing if SBT command fails
        dependencies = parseDependenciesFromBuildSbt(buildContent);
        configurations = getDefaultSbtConfigurations();
      }

      // Analyze dependency evictions if requested
      if (analyzeEvictions) {
        try {
          await analyzeSbtEvictions(resolvedPath, dependencies, timeout);
        } catch (error) {
          // Continue without eviction analysis if it fails
        }
      }

      // Get tasks if requested
      let tasks: any[] = [];
      if (includeTasks) {
        try {
          tasks = await getSbtTasks(resolvedPath, timeout);
        } catch (error) {
          // Continue without task analysis if it fails
        }
      }

      // Assess dependency criticality
      for (const dep of dependencies) {
        assessSbtDependencyCriticality(dep, dependencies, projectInfo);
      }

      // Generate analysis results
      const analysisResults = generateSbtAnalysisResults(dependencies, projectInfo);
      const recommendations = generateSbtRecommendations(dependencies, projectInfo, configurations);

      return {
        projectPath: resolvedPath,
        projectInfo,
        dependencies,
        configurations,
        tasks,
        analysisResults,
        recommendations,
      };
    } catch (error) {
      throw new Error(`Failed to analyze SBT project: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },
});

/**
 * Extract SBT project information
 */
async function extractSbtProjectInfo(buildContent: string, projectPath: string, timeout: number): Promise<SbtProject> {
  // Parse basic project information from build.sbt
  const name = extractSbtSetting(buildContent, 'name') || path.basename(projectPath);
  const organization = extractSbtSetting(buildContent, 'organization');
  const version = extractSbtSetting(buildContent, 'version') || '1.0.0';
  const scalaVersion = extractSbtSetting(buildContent, 'scalaVersion');
  
  // Get SBT version from project/build.properties
  let sbtVersion: string | undefined;
  const buildPropertiesPath = path.join(projectPath, 'project', 'build.properties');
  if (fs.existsSync(buildPropertiesPath)) {
    const buildProperties = fs.readFileSync(buildPropertiesPath, 'utf8');
    const sbtVersionMatch = buildProperties.match(/sbt\.version\s*=\s*(.+)/);
    if (sbtVersionMatch) {
      sbtVersion = sbtVersionMatch[1].trim();
    }
  }

  // Extract plugins from project/plugins.sbt
  const plugins = extractSbtPlugins(projectPath);
  
  // Extract resolvers
  const resolvers = extractSbtResolvers(buildContent);
  
  // Extract compiler options
  const compilerOptions = extractScalacOptions(buildContent);
  
  // Check for multi-project build
  const { isMultiProject, subProjects } = analyzeMultiProjectStructure(buildContent, projectPath);

  return {
    name,
    organization,
    version,
    scalaVersion,
    sbtVersion,
    buildFilePath: path.join(projectPath, 'build.sbt'),
    isMultiProject,
    subProjects,
    plugins,
    resolvers,
    compilerOptions,
  };
}

/**
 * Extract SBT setting value
 */
function extractSbtSetting(content: string, settingName: string): string | null {
  const patterns = [
    new RegExp(`${settingName}\\s*:=\\s*"([^"]+)"`, 'g'),
    new RegExp(`${settingName}\\s*:=\\s*'([^']+)'`, 'g'),
    new RegExp(`ThisBuild\\s*\\/\\s*${settingName}\\s*:=\\s*"([^"]+)"`, 'g'),
  ];
  
  for (const pattern of patterns) {
    const match = pattern.exec(content);
    if (match) {
      return match[1];
    }
  }
  
  return null;
}

/**
 * Extract SBT plugins
 */
function extractSbtPlugins(projectPath: string): any[] {
  const plugins: any[] = [];
  const pluginsPath = path.join(projectPath, 'project', 'plugins.sbt');
  
  if (!fs.existsSync(pluginsPath)) {
    return plugins;
  }
  
  const pluginsContent = fs.readFileSync(pluginsPath, 'utf8');
  
  // Match addSbtPlugin statements
  const pluginPattern = /addSbtPlugin\s*\(\s*"([^"]+)"\s*%\s*"([^"]+)"\s*%\s*"([^"]+)"\s*\)/g;
  
  let match;
  while ((match = pluginPattern.exec(pluginsContent)) !== null) {
    plugins.push({
      name: `${match[1]}.${match[2]}`,
      version: match[3],
      isAutoPlugin: true, // Most modern SBT plugins are AutoPlugins
    });
  }
  
  return plugins;
}

/**
 * Extract SBT resolvers
 */
function extractSbtResolvers(content: string): string[] {
  const resolvers: string[] = [];
  
  // Standard resolvers
  if (content.includes('Resolver.sonatypeRepo')) {
    resolvers.push('Sonatype Repository');
  }
  if (content.includes('Resolver.typesafeRepo')) {
    resolvers.push('Typesafe Repository');
  }
  
  // Custom resolvers
  const resolverPattern = /"([^"]+)"\s*at\s*"([^"]+)"/g;
  let match;
  while ((match = resolverPattern.exec(content)) !== null) {
    resolvers.push(`${match[1]} at ${match[2]}`);
  }
  
  return resolvers;
}

/**
 * Extract Scala compiler options
 */
function extractScalacOptions(content: string): string[] {
  const options: string[] = [];
  
  const scalacOptionsMatch = content.match(/scalacOptions\s*\+\+=\s*Seq\s*\(([\s\S]*?)\)/);
  if (scalacOptionsMatch) {
    const optionsStr = scalacOptionsMatch[1];
    const optionPattern = /"([^"]+)"/g;
    
    let match;
    while ((match = optionPattern.exec(optionsStr)) !== null) {
      options.push(match[1]);
    }
  }
  
  return options;
}

/**
 * Analyze multi-project structure
 */
function analyzeMultiProjectStructure(content: string, projectPath: string): {
  isMultiProject: boolean;
  subProjects: any[];
} {
  const subProjects: any[] = [];
  
  // Look for lazy val project definitions
  const projectPattern = /lazy\s+val\s+(\w+)\s*=\s*\(project\s+in\s+file\s*\(\s*"([^"]+)"\s*\)\s*\)/g;
  
  let match;
  while ((match = projectPattern.exec(content)) !== null) {
    subProjects.push({
      name: match[1],
      path: match[2],
      dependencies: [], // Would need more complex parsing to extract
    });
  }
  
  return {
    isMultiProject: subProjects.length > 0,
    subProjects,
  };
}

/**
 * Get dependencies using SBT commands
 */
async function getSbtDependencies(projectPath: string, timeout: number): Promise<{
  dependencies: SbtDependency[];
  configurations: any[];
}> {
  const sbtCmd = fs.existsSync(path.join(projectPath, 'sbt')) ? './sbt' : 'sbt';
  
  // Get dependency tree
  const { stdout } = await execAsync(`${sbtCmd} dependencyTree`, {
    cwd: projectPath,
    timeout,
  });

  const dependencies = parseSbtDependencyOutput(stdout);
  const configurations = getDefaultSbtConfigurations();

  return { dependencies, configurations };
}

/**
 * Parse SBT dependency output
 */
function parseSbtDependencyOutput(output: string): SbtDependency[] {
  const dependencies: SbtDependency[] = [];
  const lines = output.split('\n');
  
  for (const line of lines) {
    // Match lines like: +-org.scala-lang:scala-library:2.13.8
    const match = line.match(/[+\\|-]\s*([^:]+):([^:]+):([^\s\[\(]+)/);
    if (match) {
      const [, organization, name, revision] = match;
      
      // Determine if it's transitive based on tree structure
      const isTransitive = !line.trim().startsWith('+-') && line.includes('-');
      
      // Determine if it's a Scala library (simplified heuristic)
      const isScalaLibrary = organization.includes('scala') || 
                            name.includes('scala') || 
                            line.includes('_2.13') || 
                            line.includes('_2.12');
      
      dependencies.push({
        organization,
        name,
        revision,
        configuration: 'Compile', // Would need more context to determine
        crossVersion: isScalaLibrary ? 'binary' : 'disabled',
        isScalaLibrary,
        isTransitive,
        exclusions: [],
        usageCount: 0,
        criticality: 'LOW',
        criticalityReasons: [],
        coordinates: `${organization}:${name}:${revision}`,
        dependencyPath: [],
        isEvicted: false,
      });
    }
  }
  
  return dependencies;
}

/**
 * Get default SBT configurations
 */
function getDefaultSbtConfigurations(): any[] {
  return [
    { name: 'Compile', extends: [], dependencyCount: 0, description: 'Compile-time dependencies' },
    { name: 'Runtime', extends: ['Compile'], dependencyCount: 0, description: 'Runtime dependencies' },
    { name: 'Test', extends: ['Runtime'], dependencyCount: 0, description: 'Test dependencies' },
    { name: 'Provided', extends: [], dependencyCount: 0, description: 'Provided dependencies' },
    { name: 'Optional', extends: [], dependencyCount: 0, description: 'Optional dependencies' },
  ];
}

/**
 * Parse dependencies from build.sbt content (fallback method)
 */
function parseDependenciesFromBuildSbt(content: string): SbtDependency[] {
  const dependencies: SbtDependency[] = [];
  
  // Pattern for libraryDependencies
  const libDepPattern = /libraryDependencies\s*\+\+=?\s*(?:Seq\s*\()?([\s\S]*?)(?:\))?$/gm;
  
  let match;
  while ((match = libDepPattern.exec(content)) !== null) {
    const depsStr = match[1];
    
    // Parse individual dependencies
    const depPattern = /"([^"]+)"\s*%\s*%?\s*"([^"]+)"\s*%\s*"([^"]+)"(?:\s*%\s*"([^"]+)")?/g;
    
    let depMatch;
    while ((depMatch = depPattern.exec(depsStr)) !== null) {
      const [fullMatch, organization, name, revision, config] = depMatch;
      
      // Determine cross-version strategy
      const isScalaLibrary = fullMatch.includes('%%');
      const crossVersion = isScalaLibrary ? 'binary' : 'disabled';
      
      dependencies.push({
        organization,
        name,
        revision,
        configuration: config || 'Compile',
        crossVersion,
        isScalaLibrary,
        isTransitive: false,
        exclusions: [],
        usageCount: 0,
        criticality: 'LOW',
        criticalityReasons: [],
        coordinates: `${organization}:${name}:${revision}`,
        dependencyPath: [],
        isEvicted: false,
      });
    }
  }
  
  return dependencies;
}

/**
 * Analyze SBT dependency evictions
 */
async function analyzeSbtEvictions(
  projectPath: string, 
  dependencies: SbtDependency[], 
  timeout: number
): Promise<void> {
  try {
    const sbtCmd = fs.existsSync(path.join(projectPath, 'sbt')) ? './sbt' : 'sbt';
    
    const { stdout } = await execAsync(`${sbtCmd} evicted`, {
      cwd: projectPath,
      timeout,
    });

    // Parse eviction information
    const evictionLines = stdout.split('\n').filter(line => line.includes('evicted'));
    
    for (const line of evictionLines) {
      const match = line.match(/([^:]+):([^:]+):\s*([^\s]+)\s*.*evicted by\s*([^\s]+)/);
      if (match) {
        const [, org, name, evictedVersion, evictedBy] = match;
        
        // Find and update the corresponding dependency
        const dep = dependencies.find(d => 
          d.organization === org && d.name === name && d.revision === evictedVersion
        );
        
        if (dep) {
          dep.isEvicted = true;
          dep.evictedBy = evictedBy;
        }
      }
    }
  } catch (error) {
    // Ignore eviction analysis errors
  }
}

/**
 * Get SBT tasks
 */
async function getSbtTasks(projectPath: string, timeout: number): Promise<any[]> {
  const sbtCmd = fs.existsSync(path.join(projectPath, 'sbt')) ? './sbt' : 'sbt';
  
  const { stdout } = await execAsync(`${sbtCmd} tasks`, {
    cwd: projectPath,
    timeout,
  });

  return parseSbtTasks(stdout);
}

/**
 * Parse SBT tasks output
 */
function parseSbtTasks(output: string): any[] {
  const tasks: any[] = [];
  const lines = output.split('\n');
  
  for (const line of lines) {
    // Match task lines
    const match = line.match(/^\s*(\w+)\s*:\s*(.*)$/);
    if (match) {
      tasks.push({
        name: match[1],
        description: match[2].trim() || undefined,
        inputTypes: [], // Would need more detailed parsing
        outputType: undefined,
      });
    }
  }
  
  return tasks;
}

/**
 * Assess dependency criticality for SBT projects
 */
function assessSbtDependencyCriticality(
  dependency: SbtDependency,
  allDependencies: SbtDependency[],
  projectInfo: SbtProject
): void {
  const reasons: string[] = [];
  let score = 0;

  // Configuration-based scoring
  switch (dependency.configuration) {
    case 'Compile':
      score += 2;
      reasons.push('Compile configuration (runtime required)');
      break;
    case 'Test':
      score += 1;
      reasons.push('Test configuration');
      break;
    case 'Runtime':
      score += 2;
      reasons.push('Runtime configuration');
      break;
    case 'Provided':
      score += 1;
      reasons.push('Provided configuration');
      break;
  }

  // Direct vs transitive
  if (!dependency.isTransitive) {
    score += 1;
    reasons.push('Direct dependency');
  }

  // Critical Scala/Java dependencies
  const criticalDependencies = [
    'org.scala-lang:scala-library',
    'org.typelevel:cats-core',
    'com.typesafe.akka:akka-actor',
    'com.typesafe.akka:akka-stream',
    'org.apache.spark:spark-core',
    'org.apache.spark:spark-sql',
    'com.fasterxml.jackson.core:jackson-databind',
    'ch.qos.logback:logback-classic',
    'org.scalatest:scalatest',
    'org.specs2:specs2-core',
  ];

  const depKey = `${dependency.organization}:${dependency.name}`;
  if (criticalDependencies.includes(depKey)) {
    score += 2;
    reasons.push('Critical Scala/Java framework or library');
  }

  // Scala library cross-version concerns
  if (dependency.isScalaLibrary && dependency.crossVersion === 'binary') {
    score += 1;
    reasons.push('Scala binary cross-version dependency');
  } else if (dependency.isScalaLibrary && dependency.crossVersion === 'full') {
    score += 2;
    reasons.push('Scala full cross-version dependency (version-sensitive)');
  }

  // Version analysis
  if (dependency.revision?.includes('SNAPSHOT')) {
    score += 2;
    reasons.push('Snapshot version (unstable)');
  }

  if (dependency.revision?.match(/(alpha|beta|rc|milestone|m\d+)/i)) {
    score += 1;
    reasons.push('Pre-release version');
  }

  // Eviction concerns
  if (dependency.isEvicted) {
    score += 2;
    reasons.push(`Evicted by ${dependency.evictedBy} (version conflict)`);
  }

  // Cross-version conflicts
  const sameArtifacts = allDependencies.filter(d => 
    d.organization === dependency.organization && 
    d.name === dependency.name && 
    d.revision !== dependency.revision
  );
  if (sameArtifacts.length > 0) {
    score += 1;
    reasons.push('Version conflict with other dependencies');
  }

  // Scala version compatibility
  if (dependency.isScalaLibrary && projectInfo.scalaVersion) {
    const scalaMinor = projectInfo.scalaVersion.substring(0, 4); // e.g., "2.13"
    if (!dependency.name.includes(`_${scalaMinor}`)) {
      score += 1;
      reasons.push('Potential Scala version incompatibility');
    }
  }

  // Determine final criticality
  if (score >= 5) {
    dependency.criticality = 'HIGH';
  } else if (score >= 3) {
    dependency.criticality = 'MEDIUM';
  } else {
    dependency.criticality = 'LOW';
  }

  dependency.criticalityReasons = reasons;
}

/**
 * Generate analysis results summary
 */
function generateSbtAnalysisResults(
  dependencies: SbtDependency[],
  projectInfo: SbtProject
): SbtAnalysis['analysisResults'] {
  const directDeps = dependencies.filter(d => !d.isTransitive).length;
  const transitiveDeps = dependencies.filter(d => d.isTransitive).length;
  
  const scalaDeps = dependencies.filter(d => d.isScalaLibrary).length;
  const javaDeps = dependencies.filter(d => !d.isScalaLibrary).length;
  
  const testDeps = dependencies.filter(d => d.configuration === 'Test').length;
  const compileDeps = dependencies.filter(d => d.configuration === 'Compile').length;
  const runtimeDeps = dependencies.filter(d => d.configuration === 'Runtime').length;
  const providedDeps = dependencies.filter(d => d.configuration === 'Provided').length;

  const highCriticality = dependencies.filter(d => d.criticality === 'HIGH').length;
  const mediumCriticality = dependencies.filter(d => d.criticality === 'MEDIUM').length;
  const lowCriticality = dependencies.filter(d => d.criticality === 'LOW').length;

  const evictedDeps = dependencies.filter(d => d.isEvicted).length;
  const snapshotDeps = dependencies.filter(d => d.revision?.includes('SNAPSHOT')).length;

  // Calculate cross-version conflicts (simplified)
  const crossVersionConflicts = dependencies.filter(d => 
    d.isScalaLibrary && d.criticalityReasons.some(r => r.includes('cross-version'))
  ).length;

  return {
    totalDependencies: dependencies.length,
    directDependencies: directDeps,
    transitiveDependencies: transitiveDeps,
    scalaDependencies: scalaDeps,
    javaDependencies: javaDeps,
    testDependencies: testDeps,
    compileDependencies: compileDeps,
    runtimeDependencies: runtimeDeps,
    providedDependencies: providedDeps,
    highCriticalityDeps: highCriticality,
    mediumCriticalityDeps: mediumCriticality,
    lowCriticalityDeps: lowCriticality,
    evictedDependencies: evictedDeps,
    snapshotDependencies: snapshotDeps,
    crossVersionConflicts,
  };
}

/**
 * Generate SBT-specific recommendations
 */
function generateSbtRecommendations(
  dependencies: SbtDependency[],
  projectInfo: SbtProject,
  configurations: any[]
): string[] {
  const recommendations: string[] = [];

  // High criticality dependencies
  const criticalDeps = dependencies.filter(d => d.criticality === 'HIGH');
  if (criticalDeps.length > 0) {
    recommendations.push(
      `Monitor ${criticalDeps.length} high-criticality dependencies: ${criticalDeps.slice(0, 3).map(d => d.coordinates).join(', ')}`
    );
  }

  // Evicted dependencies
  const evictedDeps = dependencies.filter(d => d.isEvicted);
  if (evictedDeps.length > 0) {
    recommendations.push(
      `Review ${evictedDeps.length} evicted dependencies - consider explicit version management: ${evictedDeps.map(d => d.coordinates).join(', ')}`
    );
  }

  // Snapshot dependencies
  const snapshotDeps = dependencies.filter(d => d.revision?.includes('SNAPSHOT'));
  if (snapshotDeps.length > 0) {
    recommendations.push(
      `Replace ${snapshotDeps.length} SNAPSHOT dependencies with stable versions: ${snapshotDeps.map(d => d.coordinates).join(', ')}`
    );
  }

  // Scala cross-version recommendations
  const scalaDeps = dependencies.filter(d => d.isScalaLibrary);
  if (scalaDeps.length > 0) {
    const fullCrossVersionDeps = scalaDeps.filter(d => d.crossVersion === 'full');
    if (fullCrossVersionDeps.length > 0) {
      recommendations.push('Consider using binary cross-version (%%) instead of full cross-version for better compatibility');
    }
  }

  // Version management
  if (projectInfo.scalaVersion) {
    recommendations.push('Pin Scala version consistently across all dependencies');
    recommendations.push('Regularly check for Scala version compatibility when updating dependencies');
  }

  // Multi-project recommendations
  if (projectInfo.isMultiProject) {
    recommendations.push('Use ThisBuild settings for consistent versions across subprojects');
    recommendations.push('Consider using dependsOn for inter-project dependencies instead of publishing');
  }

  // Performance and build optimization
  recommendations.push('Use `sbt dependencyTree` to visualize dependency structure');
  recommendations.push('Run `sbt evicted` to identify version conflicts');
  
  if (dependencies.length > 20) {
    recommendations.push('Consider using dependency exclusions to reduce transitive dependency bloat');
  }

  // Plugin recommendations
  const hasUpdatesPlugin = projectInfo.plugins.some(p => p.name.includes('updates'));
  if (!hasUpdatesPlugin) {
    recommendations.push('Consider adding sbt-updates plugin to check for dependency updates');
  }

  // Security
  recommendations.push('Use sbt-dependency-check plugin for security vulnerability scanning');
  recommendations.push('Regularly update SBT version and Scala version for security patches');

  // Configuration optimization
  const testOnlyDeps = dependencies.filter(d => d.configuration === 'Test' && !d.isTransitive);
  if (testOnlyDeps.length === 0) {
    recommendations.push('Consider separating test dependencies with % Test scope');
  }

  return recommendations;
}