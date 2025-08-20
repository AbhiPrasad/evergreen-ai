import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { parseStringPromise } from 'xml2js';

const execAsync = promisify(exec);

// Schema for Maven dependency information
const mavenDependencySchema = z.object({
  groupId: z.string().describe('Maven group ID (e.g., org.springframework)'),
  artifactId: z.string().describe('Maven artifact ID (e.g., spring-core)'),
  version: z.string().nullable().describe('Dependency version'),
  scope: z.string().nullable().describe('Maven scope (compile, test, runtime, provided, system, import)'),
  type: z.string().optional().describe('Dependency type (jar, pom, war, etc.)'),
  classifier: z.string().optional().describe('Dependency classifier'),
  optional: z.boolean().describe('Whether dependency is optional'),
  exclusions: z.array(z.object({
    groupId: z.string(),
    artifactId: z.string(),
  })).describe('Excluded transitive dependencies'),
  isTransitive: z.boolean().describe('Whether this is a transitive dependency'),
  usageCount: z.number().describe('Number of times this dependency appears in imports'),
  criticality: z.enum(['HIGH', 'MEDIUM', 'LOW']).describe('Assessed criticality'),
  criticalityReasons: z.array(z.string()).describe('Reasons for criticality assessment'),
  dependencyTrail: z.array(z.string()).describe('Dependency resolution path'),
  coordinates: z.string().describe('Full Maven coordinates (groupId:artifactId:version)'),
});

const mavenModuleSchema = z.object({
  groupId: z.string(),
  artifactId: z.string(),
  version: z.string(),
  packaging: z.string().describe('Module packaging type (jar, pom, war, etc.)'),
  name: z.string().optional(),
  description: z.string().optional(),
  pomPath: z.string().describe('Path to pom.xml file'),
  parentModule: z.object({
    groupId: z.string(),
    artifactId: z.string(),
    version: z.string(),
    relativePath: z.string().optional(),
  }).optional(),
  modules: z.array(z.string()).describe('Child modules in multi-module project'),
});

const mavenAnalysisSchema = z.object({
  projectPath: z.string().describe('Path to analyzed Maven project'),
  moduleInfo: mavenModuleSchema.describe('Maven module information'),
  dependencies: z.array(mavenDependencySchema).describe('All dependencies found'),
  managedDependencies: z.array(mavenDependencySchema).describe('Dependencies from dependencyManagement'),
  plugins: z.array(z.object({
    groupId: z.string(),
    artifactId: z.string(),
    version: z.string().nullable(),
    phase: z.string().optional(),
    goals: z.array(z.string()),
    configuration: z.record(z.any()).optional(),
  })).describe('Maven plugins used'),
  properties: z.record(z.string()).describe('Maven properties defined'),
  profiles: z.array(z.object({
    id: z.string(),
    activation: z.record(z.any()).optional(),
    dependencies: z.array(mavenDependencySchema),
    properties: z.record(z.string()),
  })).describe('Maven profiles defined'),
  repositories: z.array(z.object({
    id: z.string(),
    url: z.string(),
    releases: z.boolean(),
    snapshots: z.boolean(),
  })).describe('Maven repositories configured'),
  analysisResults: z.object({
    totalDependencies: z.number(),
    directDependencies: z.number(),
    transitiveDependencies: z.number(),
    testDependencies: z.number(),
    providedDependencies: z.number(),
    runtimeDependencies: z.number(),
    optionalDependencies: z.number(),
    highCriticalityDeps: z.number(),
    mediumCriticalityDeps: z.number(),
    lowCriticalityDeps: z.number(),
    duplicateDependencies: z.number(),
    conflictingVersions: z.number(),
    snapshotDependencies: z.number(),
  }),
  recommendations: z.array(z.string()).describe('Recommendations for Maven project'),
});

export type MavenDependency = z.infer<typeof mavenDependencySchema>;
export type MavenModule = z.infer<typeof mavenModuleSchema>;
export type MavenAnalysis = z.infer<typeof mavenAnalysisSchema>;

/**
 * Tool for analyzing Maven project dependencies
 */
export const mavenDependencyAnalyzerTool = createTool({
  id: 'maven-dependency-analyzer',
  description: 'Analyzes Maven pom.xml files to identify dependencies, their usage patterns, and provides optimization recommendations',
  inputSchema: z.object({
    projectPath: z.string().describe('Path to Maven project directory').optional(),
    includeDependencyTree: z.boolean().describe('Whether to analyze dependency tree (requires mvn command)').optional(),
    includePlugins: z.boolean().describe('Whether to analyze Maven plugins').optional(),
    analyzeProfiles: z.boolean().describe('Whether to analyze Maven profiles').optional(),
    timeout: z.number().describe('Timeout in milliseconds for Maven commands').optional(),
  }),
  outputSchema: mavenAnalysisSchema,
  execute: async ({ context }) => {
    const {
      projectPath = process.cwd(),
      includeDependencyTree = false,
      includePlugins = true,
      analyzeProfiles = true,
      timeout = 30000,
    } = context;

    const resolvedPath = path.resolve(projectPath);
    const pomPath = path.join(resolvedPath, 'pom.xml');

    if (!fs.existsSync(pomPath)) {
      throw new Error(`No pom.xml found at: ${pomPath}`);
    }

    try {
      // Parse pom.xml
      const pomContent = fs.readFileSync(pomPath, 'utf8');
      const pomData = await parseStringPromise(pomContent);
      const project = pomData.project || pomData;

      // Extract module information
      const moduleInfo = extractModuleInfo(project, pomPath);

      // Extract dependencies
      const directDependencies = extractDependencies(project.dependencies?.[0]?.dependency || [], false);
      const managedDependencies = extractDependencies(
        project.dependencyManagement?.[0]?.dependencies?.[0]?.dependency || [], 
        false
      );

      // Get transitive dependencies if requested
      let transitiveDependencies: MavenDependency[] = [];
      if (includeDependencyTree) {
        try {
          transitiveDependencies = await getTransitiveDependencies(resolvedPath, timeout);
        } catch (error) {
          // Continue without transitive analysis if maven command fails
        }
      }

      // Combine all dependencies
      const allDependencies = [...directDependencies, ...transitiveDependencies];

      // Extract plugins
      let plugins: any[] = [];
      if (includePlugins) {
        plugins = extractPlugins(project.build?.[0]?.plugins?.[0]?.plugin || []);
      }

      // Extract properties
      const properties = extractProperties(project.properties?.[0] || {});

      // Extract profiles
      let profiles: any[] = [];
      if (analyzeProfiles) {
        profiles = extractProfiles(project.profiles?.[0]?.profile || []);
      }

      // Extract repositories
      const repositories = extractRepositories(project.repositories?.[0]?.repository || []);

      // Assess dependency criticality
      for (const dep of allDependencies) {
        assessMavenDependencyCriticality(dep, allDependencies, moduleInfo);
      }

      // Generate analysis results
      const analysisResults = generateMavenAnalysisResults(allDependencies, moduleInfo);
      const recommendations = generateMavenRecommendations(allDependencies, moduleInfo, properties, profiles);

      return {
        projectPath: resolvedPath,
        moduleInfo,
        dependencies: allDependencies,
        managedDependencies,
        plugins,
        properties,
        profiles,
        repositories,
        analysisResults,
        recommendations,
      };
    } catch (error) {
      throw new Error(`Failed to analyze Maven project: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },
});

/**
 * Extract module information from POM
 */
function extractModuleInfo(project: any, pomPath: string): MavenModule {
  const groupId = project.groupId?.[0] || project.parent?.[0]?.groupId?.[0] || '';
  const artifactId = project.artifactId?.[0] || '';
  const version = project.version?.[0] || project.parent?.[0]?.version?.[0] || '';
  const packaging = project.packaging?.[0] || 'jar';
  const name = project.name?.[0];
  const description = project.description?.[0];

  let parentModule;
  if (project.parent?.[0]) {
    parentModule = {
      groupId: project.parent[0].groupId?.[0] || '',
      artifactId: project.parent[0].artifactId?.[0] || '',
      version: project.parent[0].version?.[0] || '',
      relativePath: project.parent[0].relativePath?.[0],
    };
  }

  const modules = project.modules?.[0]?.module || [];

  return {
    groupId,
    artifactId,
    version,
    packaging,
    name,
    description,
    pomPath,
    parentModule,
    modules,
  };
}

/**
 * Extract dependencies from POM
 */
function extractDependencies(dependenciesArray: any[], isTransitive: boolean): MavenDependency[] {
  const dependencies: MavenDependency[] = [];

  for (const dep of dependenciesArray) {
    const groupId = dep.groupId?.[0] || '';
    const artifactId = dep.artifactId?.[0] || '';
    const version = dep.version?.[0] || null;
    const scope = dep.scope?.[0] || null;
    const type = dep.type?.[0];
    const classifier = dep.classifier?.[0];
    const optional = dep.optional?.[0] === 'true';

    const exclusions = (dep.exclusions?.[0]?.exclusion || []).map((exc: any) => ({
      groupId: exc.groupId?.[0] || '',
      artifactId: exc.artifactId?.[0] || '',
    }));

    const coordinates = version 
      ? `${groupId}:${artifactId}:${version}`
      : `${groupId}:${artifactId}`;

    dependencies.push({
      groupId,
      artifactId,
      version,
      scope,
      type,
      classifier,
      optional,
      exclusions,
      isTransitive,
      usageCount: 0, // Will be calculated later based on source code analysis
      criticality: 'LOW',
      criticalityReasons: [],
      dependencyTrail: [],
      coordinates,
    });
  }

  return dependencies;
}

/**
 * Get transitive dependencies using Maven dependency tree
 */
async function getTransitiveDependencies(projectPath: string, timeout: number): Promise<MavenDependency[]> {
  const { stdout } = await execAsync('mvn dependency:tree -DoutputType=text', {
    cwd: projectPath,
    timeout,
  });

  return parseMavenDependencyTree(stdout);
}

/**
 * Parse Maven dependency tree output
 */
function parseMavenDependencyTree(treeOutput: string): MavenDependency[] {
  const dependencies: MavenDependency[] = [];
  const lines = treeOutput.split('\n');
  
  for (const line of lines) {
    // Match dependency lines like: [INFO] +- org.springframework:spring-core:jar:5.3.21:compile
    const match = line.match(/\[INFO\]\s*[+\\|-]\s*([^:]+):([^:]+):([^:]*):([^:]*):([^:]*)/);
    if (match) {
      const [, groupId, artifactId, type, version, scope] = match;
      
      const coordinates = `${groupId}:${artifactId}:${version}`;
      
      dependencies.push({
        groupId,
        artifactId,
        version,
        scope: scope || null,
        type,
        optional: false,
        exclusions: [],
        isTransitive: true,
        usageCount: 0,
        criticality: 'LOW',
        criticalityReasons: [],
        dependencyTrail: [], // Could be enhanced to track full path
        coordinates,
      });
    }
  }

  return dependencies;
}

/**
 * Extract Maven plugins
 */
function extractPlugins(pluginsArray: any[]): any[] {
  return pluginsArray.map((plugin: any) => ({
    groupId: plugin.groupId?.[0] || 'org.apache.maven.plugins',
    artifactId: plugin.artifactId?.[0] || '',
    version: plugin.version?.[0] || null,
    phase: plugin.phase?.[0],
    goals: plugin.goals?.[0]?.goal || [],
    configuration: plugin.configuration?.[0] || {},
  }));
}

/**
 * Extract Maven properties
 */
function extractProperties(propertiesObj: any): Record<string, string> {
  const properties: Record<string, string> = {};
  
  for (const [key, value] of Object.entries(propertiesObj)) {
    if (Array.isArray(value) && value.length > 0) {
      properties[key] = value[0] as string;
    }
  }

  return properties;
}

/**
 * Extract Maven profiles
 */
function extractProfiles(profilesArray: any[]): any[] {
  return profilesArray.map((profile: any) => ({
    id: profile.id?.[0] || '',
    activation: profile.activation?.[0] || {},
    dependencies: extractDependencies(profile.dependencies?.[0]?.dependency || [], false),
    properties: extractProperties(profile.properties?.[0] || {}),
  }));
}

/**
 * Extract Maven repositories
 */
function extractRepositories(repositoriesArray: any[]): any[] {
  return repositoriesArray.map((repo: any) => ({
    id: repo.id?.[0] || '',
    url: repo.url?.[0] || '',
    releases: repo.releases?.[0]?.enabled?.[0] !== 'false',
    snapshots: repo.snapshots?.[0]?.enabled?.[0] === 'true',
  }));
}

/**
 * Assess dependency criticality for Maven projects
 */
function assessMavenDependencyCriticality(
  dependency: MavenDependency, 
  allDependencies: MavenDependency[], 
  moduleInfo: MavenModule
): void {
  const reasons: string[] = [];
  let score = 0;

  // Direct dependency scoring
  if (!dependency.isTransitive) {
    score += 2;
    reasons.push('Direct dependency');
  } else {
    score += 1;
    reasons.push('Transitive dependency');
  }

  // Scope-based scoring
  switch (dependency.scope) {
    case 'compile':
    case null: // Default scope is compile
      score += 2;
      reasons.push('Compile scope (runtime required)');
      break;
    case 'test':
      score += 1;
      reasons.push('Test scope dependency');
      break;
    case 'provided':
      score += 1;
      reasons.push('Provided scope (container supplied)');
      break;
    case 'runtime':
      score += 2;
      reasons.push('Runtime scope dependency');
      break;
    case 'system':
      score += 3;
      reasons.push('System scope (high coupling)');
      break;
  }

  // Critical Maven dependencies
  const criticalDependencies = [
    'org.springframework:spring-core',
    'org.springframework.boot:spring-boot-starter',
    'junit:junit',
    'org.junit.jupiter:junit-jupiter',
    'org.apache.logging.log4j:log4j-core',
    'ch.qos.logback:logback-classic',
    'com.fasterxml.jackson.core:jackson-databind',
    'org.hibernate:hibernate-core',
    'org.apache.commons:commons-lang3',
    'com.google.guava:guava',
  ];

  const depKey = `${dependency.groupId}:${dependency.artifactId}`;
  if (criticalDependencies.includes(depKey)) {
    score += 2;
    reasons.push('Critical framework or utility library');
  }

  // Version analysis
  if (dependency.version?.includes('SNAPSHOT')) {
    score += 2;
    reasons.push('Snapshot version (unstable)');
  }

  if (dependency.version?.includes('-beta') || dependency.version?.includes('-alpha')) {
    score += 1;
    reasons.push('Pre-release version');
  }

  // Optional dependencies
  if (dependency.optional) {
    score -= 1;
    reasons.push('Optional dependency');
  }

  // Exclusions indicate potential conflicts
  if (dependency.exclusions.length > 0) {
    score += 1;
    reasons.push(`Has ${dependency.exclusions.length} exclusions (potential conflicts)`);
  }

  // Common security-sensitive dependencies
  const securitySensitive = [
    'org.apache.struts',
    'commons-collections',
    'org.apache.commons:commons-collections4',
    'com.fasterxml.jackson',
    'org.springframework.security',
  ];

  if (securitySensitive.some(pattern => depKey.includes(pattern))) {
    score += 2;
    reasons.push('Security-sensitive dependency');
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
function generateMavenAnalysisResults(
  dependencies: MavenDependency[], 
  moduleInfo: MavenModule
): MavenAnalysis['analysisResults'] {
  const directDeps = dependencies.filter(d => !d.isTransitive).length;
  const transitiveDeps = dependencies.filter(d => d.isTransitive).length;
  
  const testDeps = dependencies.filter(d => d.scope === 'test').length;
  const providedDeps = dependencies.filter(d => d.scope === 'provided').length;
  const runtimeDeps = dependencies.filter(d => d.scope === 'runtime').length;
  const optionalDeps = dependencies.filter(d => d.optional).length;

  const highCriticality = dependencies.filter(d => d.criticality === 'HIGH').length;
  const mediumCriticality = dependencies.filter(d => d.criticality === 'MEDIUM').length;
  const lowCriticality = dependencies.filter(d => d.criticality === 'LOW').length;

  const snapshotDeps = dependencies.filter(d => d.version?.includes('SNAPSHOT')).length;

  // Detect duplicate dependencies (same groupId:artifactId, different versions)
  const depMap = new Map<string, string[]>();
  for (const dep of dependencies) {
    const key = `${dep.groupId}:${dep.artifactId}`;
    if (!depMap.has(key)) {
      depMap.set(key, []);
    }
    if (dep.version) {
      depMap.get(key)!.push(dep.version);
    }
  }
  
  const duplicateDeps = Array.from(depMap.values()).filter(versions => 
    new Set(versions).size > 1
  ).length;

  const conflictingVersions = duplicateDeps; // Same for Maven

  return {
    totalDependencies: dependencies.length,
    directDependencies: directDeps,
    transitiveDependencies: transitiveDeps,
    testDependencies: testDeps,
    providedDependencies: providedDeps,
    runtimeDependencies: runtimeDeps,
    optionalDependencies: optionalDeps,
    highCriticalityDeps: highCriticality,
    mediumCriticalityDeps: mediumCriticality,
    lowCriticalityDeps: lowCriticality,
    duplicateDependencies: duplicateDeps,
    conflictingVersions,
    snapshotDependencies: snapshotDeps,
  };
}

/**
 * Generate Maven-specific recommendations
 */
function generateMavenRecommendations(
  dependencies: MavenDependency[],
  moduleInfo: MavenModule,
  properties: Record<string, string>,
  profiles: any[]
): string[] {
  const recommendations: string[] = [];

  // High criticality dependencies
  const criticalDeps = dependencies.filter(d => d.criticality === 'HIGH');
  if (criticalDeps.length > 0) {
    recommendations.push(
      `Monitor ${criticalDeps.length} high-criticality dependencies: ${criticalDeps.slice(0, 3).map(d => d.coordinates).join(', ')}`
    );
  }

  // Snapshot dependencies
  const snapshotDeps = dependencies.filter(d => d.version?.includes('SNAPSHOT'));
  if (snapshotDeps.length > 0) {
    recommendations.push(
      `Replace ${snapshotDeps.length} SNAPSHOT dependencies with stable versions: ${snapshotDeps.map(d => d.coordinates).join(', ')}`
    );
  }

  // Version management
  const depsWithoutVersion = dependencies.filter(d => !d.version && !d.isTransitive);
  if (depsWithoutVersion.length > 0) {
    recommendations.push('Pin versions for all direct dependencies to ensure reproducible builds');
  }

  // Dependency management
  const directDeps = dependencies.filter(d => !d.isTransitive);
  if (directDeps.length > 10 && !moduleInfo.parentModule) {
    recommendations.push('Consider using dependencyManagement section for version management');
  }

  // Property usage
  const versionProperties = Object.keys(properties).filter(key => key.includes('version'));
  if (versionProperties.length < directDeps.length / 3) {
    recommendations.push('Use properties for version management to improve maintainability');
  }

  // Scope optimization
  const compileScopeDeps = dependencies.filter(d => !d.scope || d.scope === 'compile');
  if (compileScopeDeps.length > directDeps.length * 0.8) {
    recommendations.push('Review dependency scopes - consider using provided, runtime, or test scopes where appropriate');
  }

  // Security recommendations
  const securitySensitiveDeps = dependencies.filter(d =>
    d.coordinates.includes('jackson') ||
    d.coordinates.includes('commons-collections') ||
    d.coordinates.includes('struts')
  );
  if (securitySensitiveDeps.length > 0) {
    recommendations.push('Regularly update security-sensitive dependencies and monitor for CVEs');
  }

  // Build optimization
  recommendations.push('Run `mvn dependency:analyze` to identify unused and undeclared dependencies');
  recommendations.push('Use `mvn versions:display-dependency-updates` to check for dependency updates');

  // Multi-module projects
  if (moduleInfo.modules.length > 0) {
    recommendations.push('Use parent POM for shared dependency versions across modules');
    recommendations.push('Consider using BOM (Bill of Materials) for related dependency groups');
  }

  return recommendations;
}