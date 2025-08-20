import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';

const javaBuildToolSchema = z.object({
  detectedTools: z.array(z.enum(['maven', 'gradle', 'sbt', 'groovy'])).describe('All Java build tools detected in the project'),
  primaryTool: z.enum(['maven', 'gradle', 'sbt', 'groovy']).nullable().describe('Primary build tool based on project structure'),
  confidence: z.number().min(0).max(1).describe('Confidence level in the detection (0-1)'),
  indicators: z.object({
    maven: z.object({
      pomXml: z.boolean().describe('pom.xml file present'),
      mavenWrapper: z.boolean().describe('Maven wrapper (mvnw) present'),
      targetDir: z.boolean().describe('target/ directory present'),
      mvnDirectory: z.boolean().describe('.mvn/ directory present'),
    }),
    gradle: z.object({
      buildGradle: z.boolean().describe('build.gradle file present'),
      buildGradleKts: z.boolean().describe('build.gradle.kts file present'),
      settingsGradle: z.boolean().describe('settings.gradle file present'),
      settingsGradleKts: z.boolean().describe('settings.gradle.kts file present'),
      gradleWrapper: z.boolean().describe('Gradle wrapper (gradlew) present'),
      gradleDir: z.boolean().describe('gradle/ directory present'),
    }),
    sbt: z.object({
      buildSbt: z.boolean().describe('build.sbt file present'),
      projectDir: z.boolean().describe('project/ directory present'),
      buildProperties: z.boolean().describe('project/build.properties file present'),
      pluginsSbt: z.boolean().describe('project/plugins.sbt file present'),
      targetDir: z.boolean().describe('target/ directory present'),
      sbtWrapper: z.boolean().describe('SBT wrapper script present'),
    }),
    groovy: z.object({
      grapeConfig: z.boolean().describe('@Grab annotations or Grape usage detected'),
      groovyFiles: z.boolean().describe('.groovy files present'),
      gradleGroovy: z.boolean().describe('build.gradle with Groovy DSL present'),
    }),
  }).describe('Detailed indicators for each build tool'),
  projectStructure: z.object({
    hasJavaFiles: z.boolean().describe('Java source files present'),
    hasScalaFiles: z.boolean().describe('Scala source files present'),
    hasGroovyFiles: z.boolean().describe('Groovy source files present'),
    hasKotlinFiles: z.boolean().describe('Kotlin source files present'),
    sourceDirectories: z.array(z.string()).describe('Detected source directories'),
    testDirectories: z.array(z.string()).describe('Detected test directories'),
    resourceDirectories: z.array(z.string()).describe('Detected resource directories'),
  }).describe('Overall project structure analysis'),
  multiModuleProject: z.object({
    isMultiModule: z.boolean().describe('Whether this is a multi-module project'),
    modules: z.array(z.object({
      name: z.string().describe('Module name'),
      path: z.string().describe('Module path'),
      buildTool: z.enum(['maven', 'gradle', 'sbt', 'groovy']).nullable().describe('Build tool for this module'),
    })).describe('Detected modules'),
  }).describe('Multi-module project analysis'),
  recommendations: z.array(z.string()).describe('Recommendations based on detected project structure'),
});

export type JavaBuildToolResult = z.infer<typeof javaBuildToolSchema>;

/**
 * Tool for detecting Java build tools and project structure
 */
export const javaBuildToolDetectorTool = createTool({
  id: 'java-build-tool-detector',
  description: 'Detects Java build tools (Maven, Gradle, SBT) and analyzes project structure',
  inputSchema: z.object({
    projectPath: z.string().describe('Path to the project directory to analyze').optional(),
    maxDepth: z.number().describe('Maximum directory depth to search (default: 5)').optional(),
    includeHidden: z.boolean().describe('Whether to include hidden directories (default: false)').optional(),
  }),
  outputSchema: javaBuildToolSchema,
  execute: async ({ context }) => {
    const {
      projectPath = process.cwd(),
      maxDepth = 5,
      includeHidden = false,
    } = context;

    const resolvedPath = path.resolve(projectPath);

    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Project path does not exist: ${resolvedPath}`);
    }

    try {
      // Detect build tool indicators
      const indicators = detectBuildToolIndicators(resolvedPath, maxDepth, includeHidden);
      
      // Analyze project structure
      const projectStructure = analyzeProjectStructure(resolvedPath, maxDepth, includeHidden);
      
      // Detect multi-module structure
      const multiModuleProject = analyzeMultiModuleStructure(resolvedPath, maxDepth, includeHidden);
      
      // Determine detected tools and primary tool
      const detectedTools = determineDetectedTools(indicators);
      const primaryTool = determinePrimaryTool(detectedTools, indicators, projectStructure);
      const confidence = calculateConfidence(indicators, projectStructure, primaryTool);
      
      // Generate recommendations
      const recommendations = generateRecommendations(detectedTools, indicators, projectStructure, multiModuleProject);

      return {
        detectedTools,
        primaryTool,
        confidence,
        indicators,
        projectStructure,
        multiModuleProject,
        recommendations,
      };
    } catch (error) {
      throw new Error(`Failed to detect Java build tools: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },
});

/**
 * Detect build tool indicators by scanning for specific files and directories
 */
function detectBuildToolIndicators(
  projectPath: string, 
  maxDepth: number, 
  includeHidden: boolean
): JavaBuildToolResult['indicators'] {
  const indicators: JavaBuildToolResult['indicators'] = {
    maven: {
      pomXml: false,
      mavenWrapper: false,
      targetDir: false,
      mvnDirectory: false,
    },
    gradle: {
      buildGradle: false,
      buildGradleKts: false,
      settingsGradle: false,
      settingsGradleKts: false,
      gradleWrapper: false,
      gradleDir: false,
    },
    sbt: {
      buildSbt: false,
      projectDir: false,
      buildProperties: false,
      pluginsSbt: false,
      targetDir: false,
      sbtWrapper: false,
    },
    groovy: {
      grapeConfig: false,
      groovyFiles: false,
      gradleGroovy: false,
    },
  };

  const allFiles = scanDirectory(projectPath, maxDepth, includeHidden);

  for (const filePath of allFiles) {
    const relativePath = path.relative(projectPath, filePath);
    const fileName = path.basename(filePath);
    const dirName = path.dirname(relativePath);

    // Maven indicators
    if (fileName === 'pom.xml') {
      indicators.maven.pomXml = true;
    }
    if (fileName === 'mvnw' || fileName === 'mvnw.cmd') {
      indicators.maven.mavenWrapper = true;
    }
    if (dirName === 'target' && fs.statSync(filePath).isDirectory()) {
      indicators.maven.targetDir = true;
    }
    if (dirName === '.mvn' && fs.statSync(filePath).isDirectory()) {
      indicators.maven.mvnDirectory = true;
    }

    // Gradle indicators
    if (fileName === 'build.gradle') {
      indicators.gradle.buildGradle = true;
      indicators.groovy.gradleGroovy = true; // Groovy DSL
    }
    if (fileName === 'build.gradle.kts') {
      indicators.gradle.buildGradleKts = true;
    }
    if (fileName === 'settings.gradle') {
      indicators.gradle.settingsGradle = true;
    }
    if (fileName === 'settings.gradle.kts') {
      indicators.gradle.settingsGradleKts = true;
    }
    if (fileName === 'gradlew' || fileName === 'gradlew.bat') {
      indicators.gradle.gradleWrapper = true;
    }
    if (dirName === 'gradle' && fs.statSync(filePath).isDirectory()) {
      indicators.gradle.gradleDir = true;
    }

    // SBT indicators
    if (fileName === 'build.sbt') {
      indicators.sbt.buildSbt = true;
    }
    if (dirName === 'project' && fs.statSync(filePath).isDirectory()) {
      indicators.sbt.projectDir = true;
    }
    if (relativePath === path.join('project', 'build.properties')) {
      indicators.sbt.buildProperties = true;
    }
    if (relativePath === path.join('project', 'plugins.sbt')) {
      indicators.sbt.pluginsSbt = true;
    }
    if (fileName === 'sbt' || fileName === 'sbt.bat') {
      indicators.sbt.sbtWrapper = true;
    }

    // Groovy indicators
    if (fileName.endsWith('.groovy')) {
      indicators.groovy.groovyFiles = true;
      
      // Check for Grape usage
      if (fs.statSync(filePath).isFile()) {
        try {
          const content = fs.readFileSync(filePath, 'utf8');
          if (content.includes('@Grab') || content.includes('@Grapes') || content.includes('grape.grab')) {
            indicators.groovy.grapeConfig = true;
          }
        } catch (error) {
          // Ignore file reading errors
        }
      }
    }
  }

  return indicators;
}

/**
 * Analyze overall project structure
 */
function analyzeProjectStructure(
  projectPath: string, 
  maxDepth: number, 
  includeHidden: boolean
): JavaBuildToolResult['projectStructure'] {
  const structure: JavaBuildToolResult['projectStructure'] = {
    hasJavaFiles: false,
    hasScalaFiles: false,
    hasGroovyFiles: false,
    hasKotlinFiles: false,
    sourceDirectories: [],
    testDirectories: [],
    resourceDirectories: [],
  };

  const allFiles = scanDirectory(projectPath, maxDepth, includeHidden);

  for (const filePath of allFiles) {
    const fileName = path.basename(filePath);
    const relativePath = path.relative(projectPath, filePath);
    const dirName = path.dirname(relativePath);

    if (!fs.statSync(filePath).isFile()) continue;

    // Detect file types
    if (fileName.endsWith('.java')) {
      structure.hasJavaFiles = true;
    } else if (fileName.endsWith('.scala')) {
      structure.hasScalaFiles = true;
    } else if (fileName.endsWith('.groovy')) {
      structure.hasGroovyFiles = true;
    } else if (fileName.endsWith('.kt') || fileName.endsWith('.kts')) {
      structure.hasKotlinFiles = true;
    }

    // Detect common directory patterns
    if (dirName.includes('src/main/java') || dirName.includes('src\\main\\java')) {
      addUniqueDir(structure.sourceDirectories, 'src/main/java');
    } else if (dirName.includes('src/main/scala') || dirName.includes('src\\main\\scala')) {
      addUniqueDir(structure.sourceDirectories, 'src/main/scala');
    } else if (dirName.includes('src/main/groovy') || dirName.includes('src\\main\\groovy')) {
      addUniqueDir(structure.sourceDirectories, 'src/main/groovy');
    } else if (dirName.includes('src/main/kotlin') || dirName.includes('src\\main\\kotlin')) {
      addUniqueDir(structure.sourceDirectories, 'src/main/kotlin');
    }

    if (dirName.includes('src/test/java') || dirName.includes('src\\test\\java')) {
      addUniqueDir(structure.testDirectories, 'src/test/java');
    } else if (dirName.includes('src/test/scala') || dirName.includes('src\\test\\scala')) {
      addUniqueDir(structure.testDirectories, 'src/test/scala');
    } else if (dirName.includes('src/test/groovy') || dirName.includes('src\\test\\groovy')) {
      addUniqueDir(structure.testDirectories, 'src/test/groovy');
    }

    if (dirName.includes('src/main/resources') || dirName.includes('src\\main\\resources')) {
      addUniqueDir(structure.resourceDirectories, 'src/main/resources');
    } else if (dirName.includes('src/test/resources') || dirName.includes('src\\test\\resources')) {
      addUniqueDir(structure.resourceDirectories, 'src/test/resources');
    }
  }

  return structure;
}

/**
 * Helper function to add unique directory to array
 */
function addUniqueDir(dirs: string[], dir: string): void {
  if (!dirs.includes(dir)) {
    dirs.push(dir);
  }
}

/**
 * Analyze multi-module project structure
 */
function analyzeMultiModuleStructure(
  projectPath: string, 
  maxDepth: number, 
  includeHidden: boolean
): JavaBuildToolResult['multiModuleProject'] {
  const multiModuleProject: JavaBuildToolResult['multiModuleProject'] = {
    isMultiModule: false,
    modules: [],
  };

  const allFiles = scanDirectory(projectPath, 2, includeHidden); // Limited depth for module detection

  // Look for build files in subdirectories (indicating modules)
  const potentialModules = new Set<string>();

  for (const filePath of allFiles) {
    const relativePath = path.relative(projectPath, filePath);
    const fileName = path.basename(filePath);
    const dirName = path.dirname(relativePath);

    // Skip root-level build files
    if (dirName === '.') continue;

    // Detect module build files
    if ((fileName === 'pom.xml' || fileName === 'build.gradle' || fileName === 'build.gradle.kts' || fileName === 'build.sbt') &&
        !relativePath.includes(path.sep + 'target' + path.sep) &&
        !relativePath.includes(path.sep + 'build' + path.sep) &&
        !relativePath.includes(path.sep + '.gradle' + path.sep)) {
      
      const modulePath = dirName.split(path.sep)[0]; // Get top-level subdirectory
      potentialModules.add(modulePath);
    }
  }

  // Analyze each potential module
  for (const modulePath of potentialModules) {
    const fullModulePath = path.join(projectPath, modulePath);
    const moduleIndicators = detectBuildToolIndicators(fullModulePath, 2, includeHidden);
    
    let buildTool: 'maven' | 'gradle' | 'sbt' | 'groovy' | null = null;
    
    if (moduleIndicators.maven.pomXml) {
      buildTool = 'maven';
    } else if (moduleIndicators.gradle.buildGradle || moduleIndicators.gradle.buildGradleKts) {
      buildTool = 'gradle';
    } else if (moduleIndicators.sbt.buildSbt) {
      buildTool = 'sbt';
    } else if (moduleIndicators.groovy.grapeConfig) {
      buildTool = 'groovy';
    }

    if (buildTool) {
      multiModuleProject.modules.push({
        name: modulePath,
        path: modulePath,
        buildTool,
      });
    }
  }

  multiModuleProject.isMultiModule = multiModuleProject.modules.length > 0;

  return multiModuleProject;
}

/**
 * Scan directory recursively up to maxDepth
 */
function scanDirectory(dirPath: string, maxDepth: number, includeHidden: boolean): string[] {
  const files: string[] = [];

  function walkDirectory(currentPath: string, currentDepth: number): void {
    if (currentDepth > maxDepth) return;

    try {
      const entries = fs.readdirSync(currentPath, { withFileTypes: true });

      for (const entry of entries) {
        // Skip hidden files/directories if not requested
        if (!includeHidden && entry.name.startsWith('.')) {
          continue;
        }

        // Skip common directories that are unlikely to contain relevant build information
        if (entry.isDirectory() && [
          'node_modules', '.git', '.svn', '.hg',
          'target', 'build', 'out', 'bin',
          '.idea', '.vscode', '.eclipse',
          'classes', 'generated', 'generated-sources'
        ].includes(entry.name)) {
          continue;
        }

        const fullPath = path.join(currentPath, entry.name);
        files.push(fullPath);

        if (entry.isDirectory()) {
          walkDirectory(fullPath, currentDepth + 1);
        }
      }
    } catch (error) {
      // Skip directories we can't read
    }
  }

  walkDirectory(dirPath, 0);
  return files;
}

/**
 * Determine which build tools are detected
 */
function determineDetectedTools(indicators: JavaBuildToolResult['indicators']): Array<'maven' | 'gradle' | 'sbt' | 'groovy'> {
  const detectedTools: Array<'maven' | 'gradle' | 'sbt' | 'groovy'> = [];

  // Maven detection
  if (indicators.maven.pomXml || indicators.maven.mavenWrapper) {
    detectedTools.push('maven');
  }

  // Gradle detection
  if (indicators.gradle.buildGradle || indicators.gradle.buildGradleKts || 
      indicators.gradle.settingsGradle || indicators.gradle.settingsGradleKts || 
      indicators.gradle.gradleWrapper) {
    detectedTools.push('gradle');
  }

  // SBT detection
  if (indicators.sbt.buildSbt || indicators.sbt.buildProperties || indicators.sbt.pluginsSbt) {
    detectedTools.push('sbt');
  }

  // Groovy detection (as standalone tool)
  if (indicators.groovy.grapeConfig && !detectedTools.includes('gradle')) {
    detectedTools.push('groovy');
  }

  return detectedTools;
}

/**
 * Determine the primary build tool
 */
function determinePrimaryTool(
  detectedTools: Array<'maven' | 'gradle' | 'sbt' | 'groovy'>,
  indicators: JavaBuildToolResult['indicators'],
  projectStructure: JavaBuildToolResult['projectStructure']
): 'maven' | 'gradle' | 'sbt' | 'groovy' | null {
  if (detectedTools.length === 0) {
    return null;
  }

  if (detectedTools.length === 1) {
    return detectedTools[0];
  }

  // Prioritization logic when multiple tools are detected
  let scores = new Map<string, number>();

  // Score Maven
  if (detectedTools.includes('maven')) {
    let score = 0;
    if (indicators.maven.pomXml) score += 10;
    if (indicators.maven.mavenWrapper) score += 5;
    if (indicators.maven.targetDir) score += 3;
    if (indicators.maven.mvnDirectory) score += 2;
    scores.set('maven', score);
  }

  // Score Gradle
  if (detectedTools.includes('gradle')) {
    let score = 0;
    if (indicators.gradle.buildGradle) score += 8;
    if (indicators.gradle.buildGradleKts) score += 10; // Kotlin DSL is more explicit
    if (indicators.gradle.settingsGradle || indicators.gradle.settingsGradleKts) score += 5;
    if (indicators.gradle.gradleWrapper) score += 5;
    if (indicators.gradle.gradleDir) score += 2;
    scores.set('gradle', score);
  }

  // Score SBT
  if (detectedTools.includes('sbt')) {
    let score = 0;
    if (indicators.sbt.buildSbt) score += 10;
    if (indicators.sbt.buildProperties) score += 5;
    if (indicators.sbt.pluginsSbt) score += 3;
    if (indicators.sbt.projectDir) score += 3;
    if (projectStructure.hasScalaFiles) score += 5; // SBT is primary for Scala
    scores.set('sbt', score);
  }

  // Score Groovy
  if (detectedTools.includes('groovy')) {
    let score = 0;
    if (indicators.groovy.grapeConfig) score += 8;
    if (indicators.groovy.groovyFiles) score += 5;
    scores.set('groovy', score);
  }

  // Return the tool with the highest score
  let maxScore = 0;
  let primaryTool: 'maven' | 'gradle' | 'sbt' | 'groovy' | null = null;

  for (const [tool, score] of scores) {
    if (score > maxScore) {
      maxScore = score;
      primaryTool = tool as 'maven' | 'gradle' | 'sbt' | 'groovy';
    }
  }

  return primaryTool;
}

/**
 * Calculate confidence level in the detection
 */
function calculateConfidence(
  indicators: JavaBuildToolResult['indicators'],
  projectStructure: JavaBuildToolResult['projectStructure'],
  primaryTool: 'maven' | 'gradle' | 'sbt' | 'groovy' | null
): number {
  if (!primaryTool) {
    return 0.1; // Very low confidence if no tool detected
  }

  let confidence = 0.5; // Base confidence

  switch (primaryTool) {
    case 'maven':
      if (indicators.maven.pomXml) confidence += 0.3;
      if (indicators.maven.mavenWrapper) confidence += 0.1;
      if (projectStructure.sourceDirectories.includes('src/main/java')) confidence += 0.1;
      break;

    case 'gradle':
      if (indicators.gradle.buildGradle || indicators.gradle.buildGradleKts) confidence += 0.3;
      if (indicators.gradle.settingsGradle || indicators.gradle.settingsGradleKts) confidence += 0.1;
      if (indicators.gradle.gradleWrapper) confidence += 0.1;
      break;

    case 'sbt':
      if (indicators.sbt.buildSbt) confidence += 0.3;
      if (indicators.sbt.buildProperties) confidence += 0.1;
      if (projectStructure.hasScalaFiles) confidence += 0.1;
      break;

    case 'groovy':
      if (indicators.groovy.grapeConfig) confidence += 0.3;
      if (indicators.groovy.groovyFiles) confidence += 0.1;
      break;
  }

  return Math.min(confidence, 1.0);
}

/**
 * Generate recommendations based on analysis
 */
function generateRecommendations(
  detectedTools: Array<'maven' | 'gradle' | 'sbt' | 'groovy'>,
  indicators: JavaBuildToolResult['indicators'],
  projectStructure: JavaBuildToolResult['projectStructure'],
  multiModuleProject: JavaBuildToolResult['multiModuleProject']
): string[] {
  const recommendations: string[] = [];

  if (detectedTools.length === 0) {
    if (projectStructure.hasJavaFiles) {
      recommendations.push('No build tool detected. Consider adding Maven (pom.xml) or Gradle (build.gradle) for Java projects');
    }
    if (projectStructure.hasScalaFiles) {
      recommendations.push('Scala files detected. Consider using SBT (build.sbt) for Scala projects');
    }
    if (projectStructure.hasGroovyFiles) {
      recommendations.push('Groovy files detected. Consider using Gradle or adding @Grab annotations for dependencies');
    }
    return recommendations;
  }

  if (detectedTools.length > 1) {
    recommendations.push(`Multiple build tools detected: ${detectedTools.join(', ')}. Consider consolidating to one primary tool`);
  }

  // Tool-specific recommendations
  if (detectedTools.includes('maven')) {
    if (!indicators.maven.mavenWrapper) {
      recommendations.push('Consider adding Maven wrapper (mvnw) for consistent builds across environments');
    }
  }

  if (detectedTools.includes('gradle')) {
    if (!indicators.gradle.gradleWrapper) {
      recommendations.push('Consider adding Gradle wrapper (gradlew) for consistent builds across environments');
    }
    if (indicators.gradle.buildGradle && !indicators.gradle.buildGradleKts && projectStructure.hasKotlinFiles) {
      recommendations.push('Consider migrating to Kotlin DSL (build.gradle.kts) for better Kotlin integration');
    }
  }

  if (detectedTools.includes('sbt')) {
    if (!indicators.sbt.buildProperties) {
      recommendations.push('Consider adding project/build.properties to pin SBT version');
    }
    if (projectStructure.hasJavaFiles && !projectStructure.hasScalaFiles) {
      recommendations.push('Pure Java project detected with SBT. Consider Maven or Gradle for Java-only projects');
    }
  }

  // Multi-module recommendations
  if (multiModuleProject.isMultiModule) {
    const uniqueTools = new Set(multiModuleProject.modules.map(m => m.buildTool).filter(Boolean));
    if (uniqueTools.size > 1) {
      recommendations.push('Inconsistent build tools across modules. Consider standardizing on one build tool');
    }
    
    if (multiModuleProject.modules.length > 5) {
      recommendations.push('Large multi-module project detected. Consider using Gradle composite builds or Maven BOM for dependency management');
    }
  }

  // Project structure recommendations
  if (!projectStructure.sourceDirectories.length && (projectStructure.hasJavaFiles || projectStructure.hasScalaFiles)) {
    recommendations.push('Source files found but no standard source directory structure. Consider organizing code under src/main/java or src/main/scala');
  }

  return recommendations;
}