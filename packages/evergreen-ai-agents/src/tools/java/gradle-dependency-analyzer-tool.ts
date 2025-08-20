import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

// Schema for Gradle dependency information
const gradleDependencySchema = z.object({
  group: z.string().describe('Gradle group (same as Maven groupId)'),
  name: z.string().describe('Gradle name (same as Maven artifactId)'),
  version: z.string().nullable().describe('Dependency version'),
  configuration: z.string().describe('Gradle configuration (implementation, api, testImplementation, etc.)'),
  classifier: z.string().optional().describe('Dependency classifier'),
  extension: z.string().optional().describe('Dependency extension/type'),
  isTransitive: z.boolean().describe('Whether this is a transitive dependency'),
  requestedVersion: z.string().optional().describe('Originally requested version'),
  selectedVersion: z.string().optional().describe('Version selected by Gradle resolution'),
  reason: z.string().optional().describe('Reason for version selection'),
  usageCount: z.number().describe('Number of times this dependency appears'),
  criticality: z.enum(['HIGH', 'MEDIUM', 'LOW']).describe('Assessed criticality'),
  criticalityReasons: z.array(z.string()).describe('Reasons for criticality assessment'),
  dependencyPath: z.array(z.string()).describe('Dependency resolution path'),
  coordinates: z.string().describe('Full dependency coordinates'),
  isVersionCatalog: z.boolean().describe('Whether this dependency comes from version catalog'),
  catalogReference: z.string().optional().describe('Version catalog reference if applicable'),
});

const gradleProjectSchema = z.object({
  name: z.string().describe('Project name'),
  group: z.string().optional().describe('Project group'),
  version: z.string().describe('Project version'),
  description: z.string().optional().describe('Project description'),
  buildFilePath: z.string().describe('Path to build.gradle or build.gradle.kts'),
  isKotlinDsl: z.boolean().describe('Whether project uses Kotlin DSL'),
  isMultiProject: z.boolean().describe('Whether this is a multi-project build'),
  subprojects: z.array(z.string()).describe('Subproject names'),
  plugins: z.array(z.object({
    id: z.string(),
    version: z.string().optional(),
    apply: z.boolean().describe('Whether plugin is applied'),
  })).describe('Applied Gradle plugins'),
  repositories: z.array(z.string()).describe('Configured repositories'),
  javaVersion: z.string().optional().describe('Target Java version'),
});

const gradleAnalysisSchema = z.object({
  projectPath: z.string().describe('Path to analyzed Gradle project'),
  projectInfo: gradleProjectSchema.describe('Gradle project information'),
  dependencies: z.array(gradleDependencySchema).describe('All dependencies found'),
  configurations: z.array(z.object({
    name: z.string(),
    description: z.string().optional(),
    canBeResolved: z.boolean(),
    canBeConsumed: z.boolean(),
    dependencyCount: z.number(),
  })).describe('Gradle configurations'),
  tasks: z.array(z.object({
    name: z.string(),
    type: z.string(),
    group: z.string().optional(),
    description: z.string().optional(),
  })).describe('Available Gradle tasks'),
  versionCatalog: z.object({
    hasVersionCatalog: z.boolean(),
    catalogPath: z.string().optional(),
    libraries: z.record(z.string()),
    versions: z.record(z.string()),
    bundles: z.record(z.array(z.string())),
    plugins: z.record(z.string()),
  }).describe('Version catalog information'),
  analysisResults: z.object({
    totalDependencies: z.number(),
    directDependencies: z.number(),
    transitiveDependencies: z.number(),
    implementationDependencies: z.number(),
    apiDependencies: z.number(),
    testDependencies: z.number(),
    compileOnlyDependencies: z.number(),
    runtimeOnlyDependencies: z.number(),
    annotationProcessorDependencies: z.number(),
    highCriticalityDeps: z.number(),
    mediumCriticalityDeps: z.number(),
    lowCriticalityDeps: z.number(),
    versionConflicts: z.number(),
    snapshotDependencies: z.number(),
    catalogUsagePercent: z.number(),
  }),
  recommendations: z.array(z.string()).describe('Recommendations for Gradle project'),
});

export type GradleDependency = z.infer<typeof gradleDependencySchema>;
export type GradleProject = z.infer<typeof gradleProjectSchema>;
export type GradleAnalysis = z.infer<typeof gradleAnalysisSchema>;

/**
 * Tool for analyzing Gradle project dependencies
 */
export const gradleDependencyAnalyzerTool = createTool({
  id: 'gradle-dependency-analyzer',
  description: 'Analyzes Gradle build files to identify dependencies, configurations, and provides optimization recommendations',
  inputSchema: z.object({
    projectPath: z.string().describe('Path to Gradle project directory').optional(),
    includeDependencyInsight: z.boolean().describe('Whether to use gradle dependencyInsight for detailed analysis').optional(),
    includeTasks: z.boolean().describe('Whether to analyze available Gradle tasks').optional(),
    analyzeVersionCatalog: z.boolean().describe('Whether to analyze Gradle version catalog').optional(),
    timeout: z.number().describe('Timeout in milliseconds for Gradle commands').optional(),
  }),
  outputSchema: gradleAnalysisSchema,
  execute: async ({ context }) => {
    const {
      projectPath = process.cwd(),
      includeDependencyInsight = false,
      includeTasks = true,
      analyzeVersionCatalog = true,
      timeout = 45000, // Gradle can be slower than Maven
    } = context;

    const resolvedPath = path.resolve(projectPath);
    
    // Check for build files
    const buildGradleKts = path.join(resolvedPath, 'build.gradle.kts');
    const buildGradle = path.join(resolvedPath, 'build.gradle');
    const settingsGradle = path.join(resolvedPath, 'settings.gradle');
    const settingsGradleKts = path.join(resolvedPath, 'settings.gradle.kts');
    
    let buildFilePath: string;
    let isKotlinDsl = false;
    
    if (fs.existsSync(buildGradleKts)) {
      buildFilePath = buildGradleKts;
      isKotlinDsl = true;
    } else if (fs.existsSync(buildGradle)) {
      buildFilePath = buildGradle;
    } else {
      throw new Error(`No build.gradle or build.gradle.kts found at: ${resolvedPath}`);
    }

    try {
      // Parse build file
      const buildContent = fs.readFileSync(buildFilePath, 'utf8');
      
      // Extract basic project information
      const projectInfo = await extractGradleProjectInfo(
        buildContent, 
        resolvedPath, 
        buildFilePath, 
        isKotlinDsl,
        timeout
      );

      // Get dependencies using Gradle commands if available
      let dependencies: GradleDependency[] = [];
      let configurations: any[] = [];
      
      try {
        const depResult = await getGradleDependencies(resolvedPath, timeout);
        dependencies = depResult.dependencies;
        configurations = depResult.configurations;
      } catch (error) {
        // Fallback to build file parsing if Gradle command fails
        dependencies = parseDependenciesFromBuildFile(buildContent, isKotlinDsl);
        configurations = [];
      }

      // Get additional dependency insights if requested
      if (includeDependencyInsight && dependencies.length > 0) {
        await enrichWithDependencyInsights(resolvedPath, dependencies, timeout);
      }

      // Get tasks if requested
      let tasks: any[] = [];
      if (includeTasks) {
        try {
          tasks = await getGradleTasks(resolvedPath, timeout);
        } catch (error) {
          // Continue without task analysis if it fails
        }
      }

      // Analyze version catalog
      let versionCatalog: any = {
        hasVersionCatalog: false,
        libraries: {},
        versions: {},
        bundles: {},
        plugins: {},
      };
      
      if (analyzeVersionCatalog) {
        versionCatalog = await analyzeGradleVersionCatalog(resolvedPath);
      }

      // Assess dependency criticality
      for (const dep of dependencies) {
        assessGradleDependencyCriticality(dep, dependencies, projectInfo);
      }

      // Generate analysis results
      const analysisResults = generateGradleAnalysisResults(dependencies, versionCatalog);
      const recommendations = generateGradleRecommendations(
        dependencies, 
        projectInfo, 
        versionCatalog,
        configurations
      );

      return {
        projectPath: resolvedPath,
        projectInfo,
        dependencies,
        configurations,
        tasks,
        versionCatalog,
        analysisResults,
        recommendations,
      };
    } catch (error) {
      throw new Error(`Failed to analyze Gradle project: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },
});

/**
 * Extract Gradle project information
 */
async function extractGradleProjectInfo(
  buildContent: string, 
  projectPath: string, 
  buildFilePath: string, 
  isKotlinDsl: boolean,
  timeout: number
): Promise<GradleProject> {
  // Parse basic info from build file
  const name = extractFromBuildFile(buildContent, 'name', isKotlinDsl) || path.basename(projectPath);
  const group = extractFromBuildFile(buildContent, 'group', isKotlinDsl);
  const version = extractFromBuildFile(buildContent, 'version', isKotlinDsl) || '1.0.0';
  const description = extractFromBuildFile(buildContent, 'description', isKotlinDsl);
  
  // Extract plugins
  const plugins = extractPlugins(buildContent, isKotlinDsl);
  
  // Extract repositories
  const repositories = extractRepositories(buildContent, isKotlinDsl);
  
  // Extract Java version
  const javaVersion = extractJavaVersion(buildContent, isKotlinDsl);
  
  // Check if multi-project build
  let isMultiProject = false;
  let subprojects: string[] = [];
  
  try {
    const settingsContent = await readSettingsFile(projectPath, isKotlinDsl);
    if (settingsContent) {
      const includeMatches = settingsContent.match(/include\s*\(?['"](.*?)['"\)]/g);
      if (includeMatches) {
        subprojects = includeMatches.map(match => {
          const projectMatch = match.match(/['"](.*?)['"]/)
          return projectMatch ? projectMatch[1] : '';
        }).filter(Boolean);
        isMultiProject = subprojects.length > 0;
      }
    }
  } catch (error) {
    // Continue without settings analysis
  }

  return {
    name,
    group,
    version,
    description,
    buildFilePath,
    isKotlinDsl,
    isMultiProject,
    subprojects,
    plugins,
    repositories,
    javaVersion,
  };
}

/**
 * Read settings.gradle or settings.gradle.kts
 */
async function readSettingsFile(projectPath: string, preferKotlinDsl: boolean): Promise<string | null> {
  const settingsKts = path.join(projectPath, 'settings.gradle.kts');
  const settingsGroovy = path.join(projectPath, 'settings.gradle');
  
  let settingsPath: string;
  if (preferKotlinDsl && fs.existsSync(settingsKts)) {
    settingsPath = settingsKts;
  } else if (fs.existsSync(settingsGroovy)) {
    settingsPath = settingsGroovy;
  } else {
    return null;
  }
  
  return fs.readFileSync(settingsPath, 'utf8');
}

/**
 * Extract value from build file using regex
 */
function extractFromBuildFile(content: string, property: string, isKotlinDsl: boolean): string | null {
  let pattern: RegExp;
  
  if (isKotlinDsl) {
    // Kotlin DSL: group = "com.example"
    pattern = new RegExp(`${property}\\s*=\\s*["\`](.*?)["\`]`);
  } else {
    // Groovy DSL: group 'com.example' or group = 'com.example'
    pattern = new RegExp(`${property}\\s*[=:]?\\s*['"\`](.*?)['"\`]`);
  }
  
  const match = content.match(pattern);
  return match ? match[1] : null;
}

/**
 * Extract plugins from build file
 */
function extractPlugins(content: string, isKotlinDsl: boolean): any[] {
  const plugins: any[] = [];
  
  let pluginPattern: RegExp;
  if (isKotlinDsl) {
    // Kotlin DSL: id("java") or id("com.example.plugin") version "1.0"
    pluginPattern = /id\s*\(\s*["\`](.*?)["\`]\s*\)(?:\s+version\s+["\`](.*?)["\`])?/g;
  } else {
    // Groovy DSL: id 'java' or id 'com.example.plugin' version '1.0'
    pluginPattern = /id\s+['"\`](.*?)['"\`](?:\s+version\s+['"\`](.*?)['"\`])?/g;
  }
  
  let match;
  while ((match = pluginPattern.exec(content)) !== null) {
    plugins.push({
      id: match[1],
      version: match[2] || undefined,
      apply: true, // Assume applied unless proven otherwise
    });
  }
  
  return plugins;
}

/**
 * Extract repositories from build file
 */
function extractRepositories(content: string, isKotlinDsl: boolean): string[] {
  const repositories: string[] = [];
  const repoNames = ['mavenCentral', 'gradlePluginPortal', 'mavenLocal', 'google', 'jcenter'];
  
  for (const repo of repoNames) {
    if (content.includes(`${repo}()`)) {
      repositories.push(repo);
    }
  }
  
  // Custom Maven repositories
  const mavenPattern = /maven\s*\{\s*url\s*[=:]?\s*["\`](.*?)["\`]/g;
  let match;
  while ((match = mavenPattern.exec(content)) !== null) {
    repositories.push(match[1]);
  }
  
  return repositories;
}

/**
 * Extract Java version from build file
 */
function extractJavaVersion(content: string, isKotlinDsl: boolean): string | null {
  const patterns = [
    /sourceCompatibility\s*=\s*["\`]?(\d+)["\`]?/,
    /targetCompatibility\s*=\s*["\`]?(\d+)["\`]?/,
    /JavaVersion\.VERSION_(\d+)/,
    /toolchain\s*\{[\s\S]*?languageVersion\s*=\s*JavaLanguageVersion\.of\s*\(\s*(\d+)\s*\)/,
  ];
  
  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match) {
      return match[1];
    }
  }
  
  return null;
}

/**
 * Get dependencies using Gradle commands
 */
async function getGradleDependencies(projectPath: string, timeout: number): Promise<{
  dependencies: GradleDependency[];
  configurations: any[];
}> {
  const gradleCmd = fs.existsSync(path.join(projectPath, 'gradlew')) ? './gradlew' : 'gradle';
  
  // Get dependency report
  const { stdout } = await execAsync(`${gradleCmd} dependencies --configuration compileClasspath`, {
    cwd: projectPath,
    timeout,
  });

  const dependencies = parseGradleDependencyOutput(stdout);
  
  // Get configurations
  let configurations: any[] = [];
  try {
    const { stdout: configOutput } = await execAsync(`${gradleCmd} dependencies`, {
      cwd: projectPath,
      timeout: timeout / 2,
    });
    configurations = parseGradleConfigurations(configOutput);
  } catch (error) {
    // Continue without configuration details
  }

  return { dependencies, configurations };
}

/**
 * Parse Gradle dependency output
 */
function parseGradleDependencyOutput(output: string): GradleDependency[] {
  const dependencies: GradleDependency[] = [];
  const lines = output.split('\n');
  
  for (const line of lines) {
    // Match lines like: +--- org.springframework:spring-core:5.3.21
    const match = line.match(/[+\\|-]\s*([^:]+):([^:]+):([^\s]+)/);
    if (match) {
      const [, group, name, version] = match;
      
      // Determine if transitive based on tree structure
      const isTransitive = !line.trim().startsWith('+---') && line.includes('---');
      
      dependencies.push({
        group,
        name,
        version,
        configuration: 'compileClasspath', // This would need to be detected from context
        isTransitive,
        usageCount: 0,
        criticality: 'LOW',
        criticalityReasons: [],
        dependencyPath: [],
        coordinates: `${group}:${name}:${version}`,
        isVersionCatalog: false,
      });
    }
  }
  
  return dependencies;
}

/**
 * Parse Gradle configurations from output
 */
function parseGradleConfigurations(output: string): any[] {
  const configurations: any[] = [];
  const configPattern = /^(\w+) - (.*)$/gm;
  
  let match;
  while ((match = configPattern.exec(output)) !== null) {
    configurations.push({
      name: match[1],
      description: match[2] || undefined,
      canBeResolved: true, // Would need more detailed parsing to determine
      canBeConsumed: false,
      dependencyCount: 0, // Would need to count dependencies in each config
    });
  }
  
  return configurations;
}

/**
 * Parse dependencies from build file (fallback method)
 */
function parseDependenciesFromBuildFile(content: string, isKotlinDsl: boolean): GradleDependency[] {
  const dependencies: GradleDependency[] = [];
  
  let depPattern: RegExp;
  if (isKotlinDsl) {
    // Kotlin DSL: implementation("group:name:version")
    depPattern = /(implementation|api|testImplementation|compileOnly|runtimeOnly|annotationProcessor)\s*\(\s*["\`](.*?)["\`]\s*\)/g;
  } else {
    // Groovy DSL: implementation 'group:name:version'
    depPattern = /(implementation|api|testImplementation|compileOnly|runtimeOnly|annotationProcessor)\s+['"\`](.*?)['"\`]/g;
  }
  
  let match;
  while ((match = depPattern.exec(content)) !== null) {
    const [, configuration, coordinates] = match;
    const parts = coordinates.split(':');
    
    if (parts.length >= 2) {
      const group = parts[0];
      const name = parts[1];
      const version = parts[2] || null;
      
      // Check if it's a version catalog reference
      const isVersionCatalog = coordinates.startsWith('libs.');
      
      dependencies.push({
        group,
        name,
        version,
        configuration,
        isTransitive: false,
        usageCount: 0,
        criticality: 'LOW',
        criticalityReasons: [],
        dependencyPath: [],
        coordinates,
        isVersionCatalog,
        catalogReference: isVersionCatalog ? coordinates : undefined,
      });
    }
  }
  
  return dependencies;
}

/**
 * Enrich dependencies with detailed insights
 */
async function enrichWithDependencyInsights(
  projectPath: string, 
  dependencies: GradleDependency[], 
  timeout: number
): Promise<void> {
  const gradleCmd = fs.existsSync(path.join(projectPath, 'gradlew')) ? './gradlew' : 'gradle';
  
  // Sample a few dependencies to avoid timeout
  const sampleDeps = dependencies.slice(0, 5);
  
  for (const dep of sampleDeps) {
    try {
      const { stdout } = await execAsync(
        `${gradleCmd} dependencyInsight --dependency ${dep.group}:${dep.name}`,
        { cwd: projectPath, timeout: timeout / 10 }
      );
      
      // Parse insight information
      const versionMatch = stdout.match(/\(requested: ([^,)]+)/);
      if (versionMatch) {
        dep.requestedVersion = versionMatch[1];
      }
      
      const reasonMatch = stdout.match(/Selection reasons:\s*\n\s*-\s*(.+)/);
      if (reasonMatch) {
        dep.reason = reasonMatch[1];
      }
    } catch (error) {
      // Continue if dependencyInsight fails for this dependency
    }
  }
}

/**
 * Get Gradle tasks
 */
async function getGradleTasks(projectPath: string, timeout: number): Promise<any[]> {
  const gradleCmd = fs.existsSync(path.join(projectPath, 'gradlew')) ? './gradlew' : 'gradle';
  
  const { stdout } = await execAsync(`${gradleCmd} tasks`, {
    cwd: projectPath,
    timeout,
  });

  return parseGradleTasks(stdout);
}

/**
 * Parse Gradle tasks output
 */
function parseGradleTasks(output: string): any[] {
  const tasks: any[] = [];
  const taskPattern = /^(\w+) - (.*)$/gm;
  
  let currentGroup = '';
  const lines = output.split('\n');
  
  for (const line of lines) {
    if (line.match(/^[A-Z].*tasks$/)) {
      currentGroup = line.trim();
      continue;
    }
    
    const match = line.match(taskPattern);
    if (match) {
      tasks.push({
        name: match[1],
        type: 'unknown', // Would need more detailed analysis
        group: currentGroup.replace(' tasks', '').toLowerCase(),
        description: match[2],
      });
    }
  }
  
  return tasks;
}

/**
 * Analyze Gradle version catalog
 */
async function analyzeGradleVersionCatalog(projectPath: string): Promise<any> {
  const catalogPath = path.join(projectPath, 'gradle', 'libs.versions.toml');
  
  if (!fs.existsSync(catalogPath)) {
    return {
      hasVersionCatalog: false,
      libraries: {},
      versions: {},
      bundles: {},
      plugins: {},
    };
  }
  
  const catalogContent = fs.readFileSync(catalogPath, 'utf8');
  
  // Parse TOML content (simplified parsing)
  const libraries: Record<string, string> = {};
  const versions: Record<string, string> = {};
  const bundles: Record<string, string[]> = {};
  const plugins: Record<string, string> = {};
  
  // Parse versions section
  const versionMatches = catalogContent.match(/\[versions\]([\s\S]*?)(?:\[|$)/);
  if (versionMatches) {
    const versionSection = versionMatches[1];
    const versionPattern = /(\w+)\s*=\s*["\`](.*?)["\`]/g;
    let match;
    while ((match = versionPattern.exec(versionSection)) !== null) {
      versions[match[1]] = match[2];
    }
  }
  
  // Parse libraries section  
  const libraryMatches = catalogContent.match(/\[libraries\]([\s\S]*?)(?:\[|$)/);
  if (libraryMatches) {
    const librarySection = libraryMatches[1];
    const libraryPattern = /(\w+)\s*=\s*["\`](.*?)["\`]/g;
    let match;
    while ((match = libraryPattern.exec(librarySection)) !== null) {
      libraries[match[1]] = match[2];
    }
  }
  
  return {
    hasVersionCatalog: true,
    catalogPath,
    libraries,
    versions,
    bundles,
    plugins,
  };
}

/**
 * Assess dependency criticality for Gradle projects
 */
function assessGradleDependencyCriticality(
  dependency: GradleDependency,
  allDependencies: GradleDependency[],
  projectInfo: GradleProject
): void {
  const reasons: string[] = [];
  let score = 0;

  // Configuration-based scoring
  switch (dependency.configuration) {
    case 'implementation':
    case 'api':
      score += 2;
      reasons.push(`${dependency.configuration} dependency (runtime required)`);
      break;
    case 'testImplementation':
    case 'testRuntimeOnly':
      score += 1;
      reasons.push('Test dependency');
      break;
    case 'compileOnly':
      score += 1;
      reasons.push('Compile-only dependency');
      break;
    case 'runtimeOnly':
      score += 2;
      reasons.push('Runtime dependency');
      break;
    case 'annotationProcessor':
      score += 1;
      reasons.push('Annotation processor');
      break;
  }

  // API vs implementation scoring
  if (dependency.configuration === 'api') {
    score += 1;
    reasons.push('API dependency (exposed to consumers)');
  }

  // Direct vs transitive
  if (!dependency.isTransitive) {
    score += 1;
    reasons.push('Direct dependency');
  }

  // Critical Gradle/Java dependencies
  const criticalDependencies = [
    'org.springframework:spring-core',
    'org.springframework.boot:spring-boot-starter',
    'junit:junit',
    'org.junit.jupiter:junit-jupiter',
    'ch.qos.logback:logback-classic',
    'com.fasterxml.jackson.core:jackson-databind',
    'org.hibernate:hibernate-core',
    'com.google.guava:guava',
    'org.apache.commons:commons-lang3',
  ];

  const depKey = `${dependency.group}:${dependency.name}`;
  if (criticalDependencies.includes(depKey)) {
    score += 2;
    reasons.push('Critical framework or utility library');
  }

  // Version catalog usage (positive indicator)
  if (dependency.isVersionCatalog) {
    score -= 1;
    reasons.push('Managed via version catalog');
  } else {
    score += 1;
    reasons.push('Not using version catalog');
  }

  // Snapshot versions
  if (dependency.version?.includes('SNAPSHOT')) {
    score += 2;
    reasons.push('Snapshot version (unstable)');
  }

  // Pre-release versions
  if (dependency.version?.match(/(alpha|beta|rc|milestone)/i)) {
    score += 1;
    reasons.push('Pre-release version');
  }

  // Version conflicts
  const sameArtifacts = allDependencies.filter(d => 
    d.group === dependency.group && d.name === dependency.name && d.version !== dependency.version
  );
  if (sameArtifacts.length > 0) {
    score += 2;
    reasons.push('Version conflict detected');
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
function generateGradleAnalysisResults(
  dependencies: GradleDependency[],
  versionCatalog: any
): GradleAnalysis['analysisResults'] {
  const directDeps = dependencies.filter(d => !d.isTransitive).length;
  const transitiveDeps = dependencies.filter(d => d.isTransitive).length;
  
  const implementationDeps = dependencies.filter(d => d.configuration === 'implementation').length;
  const apiDeps = dependencies.filter(d => d.configuration === 'api').length;
  const testDeps = dependencies.filter(d => d.configuration?.includes('test')).length;
  const compileOnlyDeps = dependencies.filter(d => d.configuration === 'compileOnly').length;
  const runtimeOnlyDeps = dependencies.filter(d => d.configuration === 'runtimeOnly').length;
  const annotationProcessorDeps = dependencies.filter(d => d.configuration === 'annotationProcessor').length;

  const highCriticality = dependencies.filter(d => d.criticality === 'HIGH').length;
  const mediumCriticality = dependencies.filter(d => d.criticality === 'MEDIUM').length;
  const lowCriticality = dependencies.filter(d => d.criticality === 'LOW').length;

  const snapshotDeps = dependencies.filter(d => d.version?.includes('SNAPSHOT')).length;

  // Detect version conflicts
  const depMap = new Map<string, string[]>();
  for (const dep of dependencies) {
    const key = `${dep.group}:${dep.name}`;
    if (!depMap.has(key)) {
      depMap.set(key, []);
    }
    if (dep.version) {
      depMap.get(key)!.push(dep.version);
    }
  }
  const versionConflicts = Array.from(depMap.values()).filter(versions => 
    new Set(versions).size > 1
  ).length;

  // Calculate version catalog usage
  const catalogDeps = dependencies.filter(d => d.isVersionCatalog).length;
  const catalogUsagePercent = dependencies.length > 0 
    ? Math.round((catalogDeps / dependencies.length) * 100)
    : 0;

  return {
    totalDependencies: dependencies.length,
    directDependencies: directDeps,
    transitiveDependencies: transitiveDeps,
    implementationDependencies: implementationDeps,
    apiDependencies: apiDeps,
    testDependencies: testDeps,
    compileOnlyDependencies: compileOnlyDeps,
    runtimeOnlyDependencies: runtimeOnlyDeps,
    annotationProcessorDependencies: annotationProcessorDeps,
    highCriticalityDeps: highCriticality,
    mediumCriticalityDeps: mediumCriticality,
    lowCriticalityDeps: lowCriticality,
    versionConflicts,
    snapshotDependencies: snapshotDeps,
    catalogUsagePercent,
  };
}

/**
 * Generate Gradle-specific recommendations
 */
function generateGradleRecommendations(
  dependencies: GradleDependency[],
  projectInfo: GradleProject,
  versionCatalog: any,
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

  // Version catalog usage
  if (!versionCatalog.hasVersionCatalog && dependencies.length > 10) {
    recommendations.push('Consider using Gradle Version Catalogs for better dependency management');
  } else if (versionCatalog.hasVersionCatalog && versionCatalog.catalogUsagePercent < 50) {
    recommendations.push('Increase version catalog usage - currently only used for ' + versionCatalog.catalogUsagePercent + '% of dependencies');
  }

  // API vs implementation
  const apiDeps = dependencies.filter(d => d.configuration === 'api');
  const implDeps = dependencies.filter(d => d.configuration === 'implementation');
  if (apiDeps.length > implDeps.length * 0.3) {
    recommendations.push('Review api vs implementation dependencies - prefer implementation when possible');
  }

  // Snapshot dependencies
  const snapshotDeps = dependencies.filter(d => d.version?.includes('SNAPSHOT'));
  if (snapshotDeps.length > 0) {
    recommendations.push(
      `Replace ${snapshotDeps.length} SNAPSHOT dependencies with stable versions: ${snapshotDeps.map(d => d.coordinates).join(', ')}`
    );
  }

  // Version conflicts
  const conflicts = dependencies.filter(d => d.criticalityReasons.includes('Version conflict detected'));
  if (conflicts.length > 0) {
    recommendations.push('Resolve version conflicts using dependency resolution strategies');
  }

  // Build optimization
  if (projectInfo.isMultiProject) {
    recommendations.push('Use composite builds or platform dependencies for version management across subprojects');
  }

  // Performance recommendations
  recommendations.push('Enable Gradle build cache and parallel execution for better performance');
  recommendations.push('Run `gradle dependencyInsight` to understand dependency resolution');

  // Configuration optimization
  const compileOnlyDeps = dependencies.filter(d => d.configuration === 'compileOnly');
  if (compileOnlyDeps.length === 0 && projectInfo.plugins.some(p => p.id === 'java-library')) {
    recommendations.push('Consider using compileOnly for dependencies that should not be transitive');
  }

  // Security
  recommendations.push('Use `gradle dependencyUpdates` plugin to check for dependency updates');
  recommendations.push('Consider using OWASP Dependency Check plugin for security scanning');

  return recommendations;
}