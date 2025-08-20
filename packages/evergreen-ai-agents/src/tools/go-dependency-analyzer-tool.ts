import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { goPackageManagerDetectorTool, type GoPackageManagerResult } from './go-package-manager-detector-tool';

const execAsync = promisify(exec);

// Schema for import/dependency usage information
const goImportUsageSchema = z.object({
  type: z
    .enum([
      'standard-import',
      'named-import',
      'dot-import',
      'blank-import',
      'conditional-import',
    ])
    .describe('Type of import usage'),
  importPath: z.string().describe('The imported package path'),
  alias: z.string().optional().describe('Import alias if used (e.g., "json" in import json "encoding/json")'),
  line: z.number().describe('Line number where the import occurs'),
  column: z.number().describe('Column number where the import occurs'),
  buildTags: z.array(z.string()).describe('Build tags that affect this import'),
  conditional: z.boolean().describe('Whether this import is conditional (based on build tags)'),
  rawStatement: z.string().describe('The raw import statement'),
});

const goDependencyInfoSchema = z.object({
  path: z.string().describe('Module path'),
  version: z.string().nullable().describe('Module version'),
  isDirect: z.boolean().describe('Whether this is a direct dependency'),
  isIndirect: z.boolean().describe('Whether this is an indirect dependency'),
  isReplaced: z.boolean().describe('Whether this dependency has a replace directive'),
  replacementPath: z.string().optional().describe('Replacement path if replaced'),
  isStandardLibrary: z.boolean().describe('Whether this is part of Go standard library'),
  usageCount: z.number().describe('Number of times this dependency is imported'),
  usagePatterns: z.array(goImportUsageSchema).describe('All import patterns found'),
  criticality: z.enum(['HIGH', 'MEDIUM', 'LOW']).describe('Assessed criticality of the dependency'),
  criticalityReasons: z.array(z.string()).describe('Reasons for the criticality assessment'),
  dependencyPath: z.array(z.string()).describe('Dependency chain from root module'),
  buildConstraints: z.array(z.string()).describe('Build constraints that affect this dependency'),
  cgoRequired: z.boolean().describe('Whether this dependency requires CGO'),
});

const goFileAnalysisSchema = z.object({
  filePath: z.string().describe('Path to the analyzed Go file'),
  packageName: z.string().describe('Go package name declared in the file'),
  isTestFile: z.boolean().describe('Whether this is a test file (_test.go)'),
  totalImports: z.number().describe('Total number of import statements'),
  standardLibraryImports: z.array(z.string()).describe('Standard library imports'),
  externalDependencies: z.array(z.string()).describe('External module dependencies'),
  internalDependencies: z.array(z.string()).describe('Internal package imports within the module'),
  imports: z.array(goImportUsageSchema).describe('All import statements found'),
  buildTags: z.array(z.string()).describe('Build tags found in the file'),
  cgoUsage: z.boolean().describe('Whether the file uses CGO'),
});

const goDependencyAnalysisSchema = z.object({
  projectPath: z.string().describe('Path to the analyzed project'),
  moduleInfo: z
    .object({
      modulePath: z.string().nullable(),
      goVersion: z.string().nullable(),
      isWorkspace: z.boolean(),
      workspaceModules: z.array(z.string()),
    })
    .describe('Go module information'),
  analysisResults: z.object({
    totalFiles: z.number().describe('Total number of Go files analyzed'),
    totalPackages: z.number().describe('Total number of Go packages found'),
    totalDependencies: z.number().describe('Total unique dependencies found'),
    directDependencies: z.number().describe('Number of direct dependencies'),
    indirectDependencies: z.number().describe('Number of indirect dependencies'),
    standardLibraryUsage: z.number().describe('Number of standard library packages used'),
    highCriticalityDeps: z.number().describe('Number of high criticality dependencies'),
    mediumCriticalityDeps: z.number().describe('Number of medium criticality dependencies'),
    lowCriticalityDeps: z.number().describe('Number of low criticality dependencies'),
    cgoUsage: z.number().describe('Number of dependencies requiring CGO'),
    replacedDependencies: z.number().describe('Number of replaced dependencies'),
  }),
  dependencies: z.array(goDependencyInfoSchema).describe('Detailed dependency analysis'),
  files: z.array(goFileAnalysisSchema).describe('Per-file analysis results'),
  packages: z.array(z.object({
    name: z.string(),
    path: z.string(),
    fileCount: z.number(),
    isInternal: z.boolean(),
    dependencyCount: z.number(),
  })).describe('Package-level analysis'),
  buildInfo: z.object({
    supportedPlatforms: z.array(z.string()).describe('Supported GOOS/GOARCH combinations'),
    buildTags: z.array(z.string()).describe('All build tags found in the project'),
    cgoRequired: z.boolean().describe('Whether any dependency requires CGO'),
  }),
  recommendations: z.array(z.string()).describe('Recommendations for dependency management'),
});

export type GoImportUsage = z.infer<typeof goImportUsageSchema>;
export type GoDependencyInfo = z.infer<typeof goDependencyInfoSchema>;
export type GoFileAnalysis = z.infer<typeof goFileAnalysisSchema>;
export type GoDependencyAnalysis = z.infer<typeof goDependencyAnalysisSchema>;

/**
 * Comprehensive tool for analyzing Go dependency usage
 */
export const goDependencyAnalyzerTool = createTool({
  id: 'go-dependency-analyzer',
  description:
    'Analyzes Go code to identify how dependencies are used, their criticality, build constraints, and provides recommendations',
  inputSchema: z.object({
    projectPath: z.string().describe('Path to the Go project directory to analyze').optional(),
    includeTests: z.boolean().describe('Whether to include test files in analysis (default: true)').optional(),
    includeBuildTags: z.array(z.string()).describe('Build tags to consider during analysis').optional(),
    maxDepth: z.number().describe('Maximum directory depth to search (default: 10)').optional(),
    analyzeIndirect: z.boolean().describe('Whether to analyze indirect dependencies (default: true)').optional(),
    timeout: z.number().describe('Timeout in milliseconds for Go commands (default: 30000)').optional(),
  }),
  outputSchema: goDependencyAnalysisSchema,
  execute: async ({ context, runtimeContext }) => {
    const {
      projectPath = process.cwd(),
      includeTests = true,
      includeBuildTags = [],
      maxDepth = 10,
      analyzeIndirect = true,
      timeout = 30000,
    } = context;

    const resolvedPath = path.resolve(projectPath);

    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Project path does not exist: ${resolvedPath}`);
    }

    try {
      // 1. Detect Go project structure
      const goPackageManagerResult = await goPackageManagerDetectorTool.execute({
        context: { projectPath: resolvedPath },
        runtimeContext,
      });

      if (!goPackageManagerResult.isGoProject) {
        throw new Error('Not a Go project - no Go files found');
      }

      // 2. Find all relevant Go files
      const goFiles = await findGoFilesToAnalyze(resolvedPath, includeTests, maxDepth);

      // 3. Analyze each Go file for imports and structure
      const fileAnalyses: GoFileAnalysis[] = [];
      const allDependencies = new Map<string, GoDependencyInfo>();
      const allPackages = new Map<string, { name: string; path: string; files: string[]; dependencies: Set<string> }>();

      for (const filePath of goFiles) {
        const fileAnalysis = await analyzeGoFile(filePath, resolvedPath, includeBuildTags);
        fileAnalyses.push(fileAnalysis);

        // Collect package information
        const packageKey = fileAnalysis.packageName;
        if (!allPackages.has(packageKey)) {
          allPackages.set(packageKey, {
            name: fileAnalysis.packageName,
            path: path.dirname(fileAnalysis.filePath),
            files: [],
            dependencies: new Set(),
          });
        }
        allPackages.get(packageKey)!.files.push(filePath);

        // Collect dependency usage
        for (const importUsage of fileAnalysis.imports) {
          const modulePath = extractGoModulePath(importUsage.importPath);
          
          if (!allDependencies.has(modulePath)) {
            allDependencies.set(modulePath, {
              path: modulePath,
              version: null,
              isDirect: false,
              isIndirect: false,
              isReplaced: false,
              isStandardLibrary: isGoStandardLibrary(modulePath),
              usageCount: 0,
              usagePatterns: [],
              criticality: 'LOW',
              criticalityReasons: [],
              dependencyPath: [],
              buildConstraints: [],
              cgoRequired: false,
            });
          }

          const depInfo = allDependencies.get(modulePath)!;
          depInfo.usageCount++;
          depInfo.usagePatterns.push(importUsage);
          
          // Collect build constraints
          if (importUsage.buildTags.length > 0) {
            depInfo.buildConstraints = [...new Set([...depInfo.buildConstraints, ...importUsage.buildTags])];
          }

          // Track package dependencies
          allPackages.get(packageKey)!.dependencies.add(modulePath);
        }
      }

      // 4. Get dependency information from go.mod and go list
      if (goPackageManagerResult.moduleMode) {
        await enrichWithGoModInfo(resolvedPath, allDependencies, analyzeIndirect, timeout);
      }

      // 5. Assess criticality for each dependency
      for (const [, depInfo] of allDependencies) {
        assessGoDependencyCriticality(depInfo, goPackageManagerResult);
      }

      // 6. Analyze build information
      const buildInfo = await analyzeBuildInfo(fileAnalyses, allDependencies);

      // 7. Generate analysis results and recommendations
      const dependencies = Array.from(allDependencies.values());
      const packages = Array.from(allPackages.values()).map(pkg => ({
        name: pkg.name,
        path: pkg.path,
        fileCount: pkg.files.length,
        isInternal: !pkg.dependencies.has(pkg.name), // Simple heuristic
        dependencyCount: pkg.dependencies.size,
      }));
      
      const analysisResults = generateGoAnalysisResults(dependencies, fileAnalyses, packages);
      const recommendations = generateGoRecommendations(dependencies, fileAnalyses, goPackageManagerResult, buildInfo);

      return {
        projectPath: resolvedPath,
        moduleInfo: {
          modulePath: goPackageManagerResult.modulePath,
          goVersion: goPackageManagerResult.goVersion,
          isWorkspace: goPackageManagerResult.isWorkspace,
          workspaceModules: goPackageManagerResult.workspaceModules,
        },
        analysisResults,
        dependencies,
        files: fileAnalyses,
        packages,
        buildInfo,
        recommendations,
      };
    } catch (error) {
      throw new Error(`Failed to analyze Go dependencies: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },
});

/**
 * Find Go files to analyze
 */
async function findGoFilesToAnalyze(
  projectPath: string,
  includeTests: boolean,
  maxDepth: number,
): Promise<string[]> {
  const files: string[] = [];

  async function walkDirectory(dirPath: string, currentDepth: number): Promise<void> {
    if (currentDepth > maxDepth) return;

    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        // Skip common directories that shouldn't contain relevant Go files
        if (entry.isDirectory() && ['vendor', '.git', 'node_modules', 'build', 'dist', '.vscode', '.idea'].includes(entry.name)) {
          continue;
        }

        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
          await walkDirectory(fullPath, currentDepth + 1);
        } else if (entry.isFile() && entry.name.endsWith('.go')) {
          // Include test files based on flag
          if (!includeTests && entry.name.endsWith('_test.go')) {
            continue;
          }
          
          files.push(fullPath);
        }
      }
    } catch (error) {
      // Skip directories we can't read
    }
  }

  await walkDirectory(projectPath, 0);
  return files;
}

/**
 * Analyze a single Go file for imports and structure
 */
async function analyzeGoFile(filePath: string, projectRoot: string, includeBuildTags: string[]): Promise<GoFileAnalysis> {
  const content = fs.readFileSync(filePath, 'utf8');
  const relativePath = path.relative(projectRoot, filePath);
  const isTestFile = filePath.endsWith('_test.go');

  const { imports, packageName, buildTags, cgoUsage } = parseGoFile(content);
  
  // Filter imports based on build tags if specified
  const filteredImports = includeBuildTags.length > 0 
    ? imports.filter(imp => imp.buildTags.length === 0 || imp.buildTags.some(tag => includeBuildTags.includes(tag)))
    : imports;

  const standardLibraryImports: string[] = [];
  const externalDependencies: string[] = [];
  const internalDependencies: string[] = [];

  for (const importUsage of filteredImports) {
    const modulePath = extractGoModulePath(importUsage.importPath);
    
    if (isGoStandardLibrary(importUsage.importPath)) {
      if (!standardLibraryImports.includes(importUsage.importPath)) {
        standardLibraryImports.push(importUsage.importPath);
      }
    } else if (importUsage.importPath.startsWith('.') || !importUsage.importPath.includes('.')) {
      // Internal/relative imports
      if (!internalDependencies.includes(importUsage.importPath)) {
        internalDependencies.push(importUsage.importPath);
      }
    } else {
      // External dependencies
      if (!externalDependencies.includes(modulePath)) {
        externalDependencies.push(modulePath);
      }
    }
  }

  return {
    filePath: relativePath,
    packageName: packageName || 'main',
    isTestFile,
    totalImports: filteredImports.length,
    standardLibraryImports,
    externalDependencies,
    internalDependencies,
    imports: filteredImports,
    buildTags,
    cgoUsage,
  };
}

/**
 * Parse Go file content for imports, package name, build tags, etc.
 */
function parseGoFile(content: string): {
  imports: GoImportUsage[];
  packageName: string | null;
  buildTags: string[];
  cgoUsage: boolean;
} {
  const imports: GoImportUsage[] = [];
  const lines = content.split('\n');
  let packageName: string | null = null;
  let buildTags: string[] = [];
  let cgoUsage = false;
  let inImportBlock = false;
  let currentBuildTags: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();
    const lineNumber = i + 1;

    // Parse build tags from comments
    if (trimmedLine.startsWith('//go:build') || trimmedLine.startsWith('// +build')) {
      const tags = parseBuildTags(trimmedLine);
      buildTags = [...buildTags, ...tags];
      currentBuildTags = [...currentBuildTags, ...tags];
      continue;
    }

    // Package declaration
    if (trimmedLine.startsWith('package ') && !packageName) {
      packageName = trimmedLine.substring(8).trim();
      continue;
    }

    // CGO detection
    if (trimmedLine.includes('import "C"') || trimmedLine.includes('import"C"')) {
      cgoUsage = true;
    }

    // Import block start
    if (trimmedLine === 'import (') {
      inImportBlock = true;
      continue;
    }

    // Import block end
    if (inImportBlock && trimmedLine === ')') {
      inImportBlock = false;
      currentBuildTags = []; // Reset build tags after import block
      continue;
    }

    // Single import or import in block
    let importMatch: RegExpMatchArray | null = null;
    
    if (inImportBlock) {
      // Import within block
      importMatch = trimmedLine.match(/^(?:(\w+|\.|_)\s+)?"([^"]+)"(?:\s*\/\/.*)?$/);
    } else {
      // Single import statement
      importMatch = trimmedLine.match(/^import\s+(?:(\w+|\.|_)\s+)?"([^"]+)"(?:\s*\/\/.*)?$/);
    }

    if (importMatch) {
      const [, alias, importPath] = importMatch;
      const importType = determineGoImportType(alias);

      imports.push({
        type: importType,
        importPath: importPath,
        alias: alias && alias !== '.' && alias !== '_' ? alias : undefined,
        line: lineNumber,
        column: line.indexOf(importPath) - 1, // Approximate column
        buildTags: [...currentBuildTags],
        conditional: currentBuildTags.length > 0,
        rawStatement: trimmedLine,
      });
    }

    // Reset build tags after non-comment, non-import lines
    if (!trimmedLine.startsWith('//') && !trimmedLine.startsWith('import') && !inImportBlock && trimmedLine !== '') {
      currentBuildTags = [];
    }
  }

  return {
    imports,
    packageName,
    buildTags: [...new Set(buildTags)],
    cgoUsage,
  };
}

/**
 * Parse build tags from comment lines
 */
function parseBuildTags(commentLine: string): string[] {
  const tags: string[] = [];
  
  if (commentLine.startsWith('//go:build')) {
    // Modern go:build syntax
    const buildExpr = commentLine.substring(10).trim();
    // Simplified parsing - extract individual tags
    const tagMatches = buildExpr.match(/\b\w+\b/g);
    if (tagMatches) {
      tags.push(...tagMatches.filter(tag => !['&&', '||', '!'].includes(tag)));
    }
  } else if (commentLine.startsWith('// +build')) {
    // Legacy +build syntax
    const buildTags = commentLine.substring(9).trim();
    const tagGroups = buildTags.split(/\s+/);
    for (const group of tagGroups) {
      const cleanTags = group.split(',').map(tag => tag.replace(/^!/, ''));
      tags.push(...cleanTags);
    }
  }
  
  return tags;
}

/**
 * Determine the type of Go import
 */
function determineGoImportType(alias?: string): GoImportUsage['type'] {
  if (alias === '.') {
    return 'dot-import';
  }
  if (alias === '_') {
    return 'blank-import';
  }
  if (alias && alias !== '.') {
    return 'named-import';
  }
  return 'standard-import';
}

/**
 * Extract Go module path from import path
 */
function extractGoModulePath(importPath: string): string {
  // For standard library, return as-is
  if (isGoStandardLibrary(importPath)) {
    return importPath;
  }

  // For module paths like github.com/owner/repo/subpackage, return the module root
  const parts = importPath.split('/');
  
  if (parts[0].includes('.')) {
    // Domain-based module (github.com, golang.org, etc.)
    if (parts.length >= 3) {
      return parts.slice(0, 3).join('/');
    }
    return importPath;
  }

  // Simple module name or standard library
  return importPath;
}

/**
 * Check if import is Go standard library
 */
function isGoStandardLibrary(importPath: string): boolean {
  // Standard library packages don't contain dots (except some special cases)
  if (!importPath.includes('.')) {
    return true;
  }

  // Special cases for extended standard library
  const stdExtended = [
    'golang.org/x/crypto',
    'golang.org/x/net',
    'golang.org/x/text',
    'golang.org/x/sys',
    'golang.org/x/time',
    'golang.org/x/sync',
  ];

  return stdExtended.some(prefix => importPath.startsWith(prefix));
}

/**
 * Enrich dependency information with go.mod and go list data
 */
async function enrichWithGoModInfo(
  projectPath: string,
  dependencies: Map<string, GoDependencyInfo>,
  analyzeIndirect: boolean,
  timeout: number,
): Promise<void> {
  try {
    // Get all module information
    const { stdout } = await execAsync('go list -m -json all', {
      cwd: projectPath,
      timeout,
    });

    const modules = stdout.trim().split('\n').filter(Boolean).map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    }).filter(Boolean);

    for (const module of modules) {
      if (!module.Path) continue;

      const depInfo = dependencies.get(module.Path);
      if (depInfo) {
        depInfo.version = module.Version || null;
        depInfo.isDirect = !module.Indirect;
        depInfo.isIndirect = !!module.Indirect;
        depInfo.isReplaced = !!module.Replace;
        depInfo.replacementPath = module.Replace?.Path;
      }
    }

    // Get dependency graph if analyzing indirect dependencies
    if (analyzeIndirect) {
      try {
        const { stdout: graphOutput } = await execAsync('go mod graph', {
          cwd: projectPath,
          timeout,
        });

        const dependencyGraph = parseGoModGraph(graphOutput);
        
        for (const [modulePath, depInfo] of dependencies) {
          if (dependencyGraph.has(modulePath)) {
            depInfo.dependencyPath = dependencyGraph.get(modulePath) || [];
          }
        }
      } catch (error) {
        // Ignore graph parsing errors
      }
    }
  } catch (error) {
    // Ignore go list errors - might not be in a module
  }
}

/**
 * Parse go mod graph output
 */
function parseGoModGraph(graphOutput: string): Map<string, string[]> {
  const dependencyGraph = new Map<string, string[]>();
  const lines = graphOutput.split('\n').filter(Boolean);

  for (const line of lines) {
    const [from, to] = line.split(' ');
    if (from && to) {
      if (!dependencyGraph.has(to)) {
        dependencyGraph.set(to, []);
      }
      dependencyGraph.get(to)!.push(from);
    }
  }

  return dependencyGraph;
}

/**
 * Assess dependency criticality based on usage patterns and Go-specific factors
 */
function assessGoDependencyCriticality(depInfo: GoDependencyInfo, goInfo: GoPackageManagerResult): void {
  const reasons: string[] = [];
  let score = 0;

  // Usage frequency scoring
  if (depInfo.usageCount >= 10) {
    score += 3;
    reasons.push('High usage frequency (10+ imports)');
  } else if (depInfo.usageCount >= 5) {
    score += 2;
    reasons.push('Medium usage frequency (5-9 imports)');
  } else if (depInfo.usageCount >= 2) {
    score += 1;
    reasons.push('Low usage frequency (2-4 imports)');
  }

  // Direct dependency scoring
  if (depInfo.isDirect) {
    score += 2;
    reasons.push('Direct dependency');
  }

  // Standard library bonus (generally lower risk)
  if (depInfo.isStandardLibrary) {
    score -= 1;
    reasons.push('Go standard library (lower risk)');
  } else {
    score += 1;
    reasons.push('External dependency');
  }

  // Critical Go packages
  const criticalPackages = [
    'github.com/gin-gonic/gin',
    'github.com/gorilla/mux',
    'github.com/labstack/echo',
    'github.com/gofiber/fiber',
    'gorm.io/gorm',
    'go.uber.org/zap',
    'github.com/stretchr/testify',
    'google.golang.org/grpc',
  ];

  if (criticalPackages.some(pattern => depInfo.path.includes(pattern))) {
    score += 2;
    reasons.push('Critical framework or library');
  }

  // CGO requirement increases criticality
  if (depInfo.cgoRequired) {
    score += 2;
    reasons.push('Requires CGO (cross-compilation complexity)');
  }

  // Replaced dependencies
  if (depInfo.isReplaced) {
    score += 1;
    reasons.push('Has replace directive (custom/forked dependency)');
  }

  // Build constraints increase complexity
  if (depInfo.buildConstraints.length > 0) {
    score += 1;
    reasons.push(`Platform-specific (${depInfo.buildConstraints.join(', ')})`);
  }

  // Import patterns analysis
  const hasBlankImports = depInfo.usagePatterns.some(pattern => pattern.type === 'blank-import');
  if (hasBlankImports) {
    score += 1;
    reasons.push('Side-effect imports detected (initialization dependency)');
  }

  const hasDotImports = depInfo.usagePatterns.some(pattern => pattern.type === 'dot-import');
  if (hasDotImports) {
    score += 1;
    reasons.push('Dot imports detected (namespace pollution risk)');
  }

  // Determine final criticality
  if (score >= 5) {
    depInfo.criticality = 'HIGH';
  } else if (score >= 3) {
    depInfo.criticality = 'MEDIUM';
  } else {
    depInfo.criticality = 'LOW';
  }

  depInfo.criticalityReasons = reasons;
}

/**
 * Analyze build information
 */
async function analyzeBuildInfo(
  fileAnalyses: GoFileAnalysis[],
  dependencies: Map<string, GoDependencyInfo>,
): Promise<GoDependencyAnalysis['buildInfo']> {
  const allBuildTags = new Set<string>();
  let cgoRequired = false;

  // Collect build tags and CGO usage from files
  for (const file of fileAnalyses) {
    file.buildTags.forEach(tag => allBuildTags.add(tag));
    if (file.cgoUsage) {
      cgoRequired = true;
    }
  }

  // Check dependencies for CGO requirements
  for (const [, depInfo] of dependencies) {
    if (depInfo.cgoRequired) {
      cgoRequired = true;
    }
  }

  // Determine supported platforms based on build tags
  const supportedPlatforms: string[] = [];
  const platformTags = ['linux', 'darwin', 'windows', 'freebsd', 'openbsd', 'netbsd', 'dragonfly'];
  const archTags = ['amd64', 'arm64', '386', 'arm'];

  if (allBuildTags.size === 0) {
    // No specific build tags, supports all common platforms
    supportedPlatforms.push('linux/amd64', 'darwin/amd64', 'windows/amd64');
  } else {
    // Determine platforms based on build tags
    const platforms = [...allBuildTags].filter(tag => platformTags.includes(tag));
    const archs = [...allBuildTags].filter(tag => archTags.includes(tag));
    
    if (platforms.length === 0) platforms.push('linux', 'darwin', 'windows');
    if (archs.length === 0) archs.push('amd64');
    
    for (const platform of platforms) {
      for (const arch of archs) {
        supportedPlatforms.push(`${platform}/${arch}`);
      }
    }
  }

  return {
    supportedPlatforms: [...new Set(supportedPlatforms)],
    buildTags: [...allBuildTags],
    cgoRequired,
  };
}

/**
 * Generate analysis results summary
 */
function generateGoAnalysisResults(
  dependencies: GoDependencyInfo[],
  files: GoFileAnalysis[],
  packages: { name: string; path: string; fileCount: number; isInternal: boolean; dependencyCount: number }[],
): GoDependencyAnalysis['analysisResults'] {
  const directDeps = dependencies.filter(d => d.isDirect).length;
  const indirectDeps = dependencies.filter(d => d.isIndirect).length;
  const stdLibUsage = dependencies.filter(d => d.isStandardLibrary).length;

  const highCriticality = dependencies.filter(d => d.criticality === 'HIGH').length;
  const mediumCriticality = dependencies.filter(d => d.criticality === 'MEDIUM').length;
  const lowCriticality = dependencies.filter(d => d.criticality === 'LOW').length;

  const cgoUsage = dependencies.filter(d => d.cgoRequired).length;
  const replacedDeps = dependencies.filter(d => d.isReplaced).length;

  return {
    totalFiles: files.length,
    totalPackages: packages.length,
    totalDependencies: dependencies.length,
    directDependencies: directDeps,
    indirectDependencies: indirectDeps,
    standardLibraryUsage: stdLibUsage,
    highCriticalityDeps: highCriticality,
    mediumCriticalityDeps: mediumCriticality,
    lowCriticalityDeps: lowCriticality,
    cgoUsage,
    replacedDependencies: replacedDeps,
  };
}

/**
 * Generate Go-specific recommendations based on analysis
 */
function generateGoRecommendations(
  dependencies: GoDependencyInfo[],
  files: GoFileAnalysis[],
  goInfo: GoPackageManagerResult,
  buildInfo: GoDependencyAnalysis['buildInfo'],
): string[] {
  const recommendations: string[] = [];

  // High criticality dependencies
  const criticalDeps = dependencies.filter(d => d.criticality === 'HIGH' && !d.isStandardLibrary);
  if (criticalDeps.length > 0) {
    recommendations.push(
      `Monitor ${criticalDeps.length} high-criticality dependencies closely: ${criticalDeps.slice(0, 3).map(d => d.path).join(', ')}`
    );
  }

  // Replaced dependencies
  const replacedDeps = dependencies.filter(d => d.isReplaced);
  if (replacedDeps.length > 0) {
    recommendations.push(
      `Review ${replacedDeps.length} replaced dependencies to ensure they're still necessary: ${replacedDeps.map(d => d.path).join(', ')}`
    );
  }

  // CGO usage
  if (buildInfo.cgoRequired) {
    recommendations.push('CGO is required - consider the impact on cross-compilation and deployment complexity');
    recommendations.push('Test builds on all target platforms when CGO is involved');
  }

  // Dot imports (anti-pattern)
  const dotImportDeps = dependencies.filter(d => 
    d.usagePatterns.some(p => p.type === 'dot-import')
  );
  if (dotImportDeps.length > 0) {
    recommendations.push(
      `Avoid dot imports - they pollute the namespace: ${dotImportDeps.map(d => d.path).join(', ')}`
    );
  }

  // Build tags complexity
  if (buildInfo.buildTags.length > 5) {
    recommendations.push(`Complex build constraints detected (${buildInfo.buildTags.length} tags) - ensure proper testing across platforms`);
  }

  // Module management
  if (goInfo.moduleMode) {
    recommendations.push('Run `go mod tidy` regularly to clean up unused dependencies');
    recommendations.push('Use `go mod verify` to ensure dependency integrity');
  }

  // Indirect dependencies that are heavily used
  const heavyIndirectDeps = dependencies.filter(d => d.isIndirect && d.usageCount >= 5);
  if (heavyIndirectDeps.length > 0) {
    recommendations.push(
      `Consider making heavily-used indirect dependencies direct: ${heavyIndirectDeps.map(d => d.path).join(', ')}`
    );
  }

  // Standard library optimization
  const stdLibCount = dependencies.filter(d => d.isStandardLibrary).length;
  if (stdLibCount < 5 && dependencies.length > 10) {
    recommendations.push('Consider using more Go standard library packages to reduce external dependencies');
  }

  // Version management
  if (!goInfo.indicators.goSum && goInfo.moduleMode) {
    recommendations.push('go.sum file missing - run `go mod download` to generate checksums for security');
  }

  return recommendations;
}