import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { packageManagerDetectorTool, type PackageManagerResult } from './package-manager-detector-tool';

const execAsync = promisify(exec);

// Schema for import/dependency usage information
const importUsageSchema = z.object({
  type: z
    .enum([
      'static-import',
      'dynamic-import',
      'require',
      'require-resolve',
      'import-meta',
      'import-type',
      'export-from',
      'side-effect-import',
    ])
    .describe('Type of import/dependency usage'),
  source: z.string().describe('The imported module/package name'),
  specifier: z.string().describe('The full import specifier (e.g., "lodash/get")'),
  importedBindings: z.array(z.string()).describe('Named imports, default import, or namespace'),
  isTypeOnly: z.boolean().describe('Whether this is a type-only import'),
  line: z.number().describe('Line number where the import occurs'),
  column: z.number().describe('Column number where the import occurs'),
  rawStatement: z.string().describe('The raw import/require statement'),
});

const dependencyInfoSchema = z.object({
  name: z.string().describe('Package name'),
  version: z.string().nullable().describe('Installed version'),
  isDirect: z.boolean().describe('Whether this is a direct dependency'),
  isDevDependency: z.boolean().describe('Whether this is a dev dependency'),
  isPeerDependency: z.boolean().describe('Whether this is a peer dependency'),
  dependencyPath: z.array(z.string()).describe('Dependency chain (for transitive deps)'),
  usageCount: z.number().describe('Number of times this dependency is used'),
  usagePatterns: z.array(importUsageSchema).describe('All usage patterns found'),
  criticality: z.enum(['HIGH', 'MEDIUM', 'LOW']).describe('Assessed criticality of the dependency'),
  criticalityReasons: z.array(z.string()).describe('Reasons for the criticality assessment'),
});

const fileAnalysisSchema = z.object({
  filePath: z.string().describe('Path to the analyzed file'),
  isTypeScript: z.boolean().describe('Whether the file is TypeScript'),
  totalImports: z.number().describe('Total number of import statements'),
  externalDependencies: z.array(z.string()).describe('External package dependencies found'),
  internalDependencies: z.array(z.string()).describe('Internal/relative imports found'),
  imports: z.array(importUsageSchema).describe('All import statements found'),
  hasCircularDependencies: z.boolean().describe('Whether circular dependencies were detected'),
});

const dependencyAnalysisSchema = z.object({
  projectPath: z.string().describe('Path to the analyzed project'),
  packageManager: z
    .object({
      type: z.enum(['npm', 'yarn', 'pnpm']).nullable(),
      version: z.string().nullable(),
      confidence: z.enum(['low', 'medium', 'high']),
    })
    .describe('Detected package manager information'),
  analysisResults: z.object({
    totalFiles: z.number().describe('Total number of files analyzed'),
    totalDependencies: z.number().describe('Total unique dependencies found'),
    directDependencies: z.number().describe('Number of direct dependencies'),
    devDependencies: z.number().describe('Number of dev dependencies'),
    transitiveDependencies: z.number().describe('Number of transitive dependencies'),
    highCriticalityDeps: z.number().describe('Number of high criticality dependencies'),
    mediumCriticalityDeps: z.number().describe('Number of medium criticality dependencies'),
    lowCriticalityDeps: z.number().describe('Number of low criticality dependencies'),
  }),
  dependencies: z.array(dependencyInfoSchema).describe('Detailed dependency analysis'),
  files: z.array(fileAnalysisSchema).describe('Per-file analysis results'),
  recommendations: z.array(z.string()).describe('Recommendations for dependency management'),
});

export type ImportUsage = z.infer<typeof importUsageSchema>;
export type DependencyInfo = z.infer<typeof dependencyInfoSchema>;
export type FileAnalysis = z.infer<typeof fileAnalysisSchema>;
export type DependencyAnalysis = z.infer<typeof dependencyAnalysisSchema>;

/**
 * Comprehensive tool for analyzing JavaScript/TypeScript dependency usage
 */
export const dependencyAnalyzerTool = createTool({
  id: 'dependency-analyzer',
  description:
    'Analyzes JavaScript/TypeScript code to identify how dependencies are used, their criticality, and provides recommendations',
  inputSchema: z.object({
    projectPath: z.string().describe('Path to the project directory to analyze').optional(),
    includePatterns: z
      .array(z.string())
      .describe('Glob patterns for files to include (default: **/*.{js,jsx,ts,tsx,mjs,cjs})')
      .optional(),
    excludePatterns: z
      .array(z.string())
      .describe('Glob patterns for files to exclude (default: node_modules, dist, build)')
      .optional(),
    maxDepth: z.number().describe('Maximum directory depth to search (default: 10)').optional(),
    analyzeTransitive: z.boolean().describe('Whether to analyze transitive dependencies (default: true)').optional(),
  }),
  outputSchema: dependencyAnalysisSchema,
  execute: async ({ context, runtimeContext }) => {
    const {
      projectPath = process.cwd(),
      includePatterns = ['**/*.{js,jsx,ts,tsx,mjs,cjs}'],
      excludePatterns = ['**/node_modules/**', '**/dist/**', '**/build/**', '**/*.min.js'],
      maxDepth = 10,
      analyzeTransitive = true,
    } = context;

    const resolvedPath = path.resolve(projectPath);

    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Project path does not exist: ${resolvedPath}`);
    }

    try {
      // 1. Detect package manager
      const packageManagerResult = await packageManagerDetectorTool.execute({
        context: { projectPath: resolvedPath },
        runtimeContext,
      });

      // 2. Find all relevant files
      const files = await findFilesToAnalyze(resolvedPath, includePatterns, excludePatterns, maxDepth);

      // 3. Analyze each file for imports
      const fileAnalyses: FileAnalysis[] = [];
      const allDependencies = new Map<string, DependencyInfo>();

      for (const filePath of files) {
        const fileAnalysis = await analyzeFile(filePath, resolvedPath);
        fileAnalyses.push(fileAnalysis);

        // Collect dependency usage
        for (const importUsage of fileAnalysis.imports) {
          if (isExternalDependency(importUsage.source)) {
            const packageName = extractPackageName(importUsage.source);
            if (!allDependencies.has(packageName)) {
              allDependencies.set(packageName, {
                name: packageName,
                version: null,
                isDirect: false,
                isDevDependency: false,
                isPeerDependency: false,
                dependencyPath: [],
                usageCount: 0,
                usagePatterns: [],
                criticality: 'LOW',
                criticalityReasons: [],
              });
            }

            const depInfo = allDependencies.get(packageName)!;
            depInfo.usageCount++;
            depInfo.usagePatterns.push(importUsage);
          }
        }
      }

      // 4. Get package.json information
      await enrichWithPackageJsonInfo(resolvedPath, allDependencies);

      // 5. Get dependency tree information if analyzeTransitive is true
      if (analyzeTransitive) {
        await enrichWithDependencyTree(resolvedPath, packageManagerResult, allDependencies);
      }

      // 6. Assess criticality for each dependency
      for (const [, depInfo] of allDependencies) {
        assessDependencyCriticality(depInfo);
      }

      // 7. Generate analysis results and recommendations
      const dependencies = Array.from(allDependencies.values());
      const analysisResults = generateAnalysisResults(dependencies, fileAnalyses);
      const recommendations = generateRecommendations(dependencies, fileAnalyses, packageManagerResult);

      return {
        projectPath: resolvedPath,
        packageManager: {
          type: packageManagerResult.packageManager,
          version: packageManagerResult.packageManagerVersion,
          confidence: packageManagerResult.confidence,
        },
        analysisResults,
        dependencies,
        files: fileAnalyses,
        recommendations,
      };
    } catch (error) {
      throw new Error(`Failed to analyze dependencies: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },
});

/**
 * Find files to analyze based on patterns
 */
async function findFilesToAnalyze(
  projectPath: string,
  includePatterns: string[],
  excludePatterns: string[],
  maxDepth: number,
): Promise<string[]> {
  const files: string[] = [];

  async function walkDirectory(dirPath: string, currentDepth: number): Promise<void> {
    if (currentDepth > maxDepth) return;

    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        const relativePath = path.relative(projectPath, fullPath);

        // Check exclude patterns
        if (excludePatterns.some(pattern => minimatch(relativePath, pattern))) {
          continue;
        }

        if (entry.isDirectory()) {
          await walkDirectory(fullPath, currentDepth + 1);
        } else if (entry.isFile()) {
          // Check include patterns
          if (includePatterns.some(pattern => minimatch(relativePath, pattern))) {
            files.push(fullPath);
          }
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
 * Simple minimatch implementation for glob patterns
 */
function minimatch(filePath: string, pattern: string): boolean {
  // Normalize path separators
  const normalizedPath = filePath.replace(/\\/g, '/');
  let normalizedPattern = pattern.replace(/\\/g, '/');

  // Handle brace expansion first (e.g., {js,jsx,ts,tsx})
  if (normalizedPattern.includes('{') && normalizedPattern.includes('}')) {
    const braceMatch = normalizedPattern.match(/\{([^}]+)\}/);
    if (braceMatch) {
      const options = braceMatch[1].split(',');
      const basePattern = normalizedPattern.replace(braceMatch[0], 'PLACEHOLDER');

      for (const option of options) {
        const expandedPattern = basePattern.replace('PLACEHOLDER', option.trim());
        if (minimatch(filePath, expandedPattern)) {
          return true;
        }
      }
      return false;
    }
  }

  // Convert glob pattern to regex
  const regexPattern = normalizedPattern
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '.*')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]');

  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(normalizedPath);
}

/**
 * Analyze a single file for imports and dependencies
 */
async function analyzeFile(filePath: string, projectRoot: string): Promise<FileAnalysis> {
  const content = fs.readFileSync(filePath, 'utf8');
  const isTypeScript = /\.tsx?$/.test(filePath);
  const relativePath = path.relative(projectRoot, filePath);

  const imports = parseImports(content);
  const externalDependencies: string[] = [];
  const internalDependencies: string[] = [];

  for (const importUsage of imports) {
    if (isExternalDependency(importUsage.source)) {
      const packageName = extractPackageName(importUsage.source);
      if (!externalDependencies.includes(packageName)) {
        externalDependencies.push(packageName);
      }
    } else {
      if (!internalDependencies.includes(importUsage.source)) {
        internalDependencies.push(importUsage.source);
      }
    }
  }

  return {
    filePath: relativePath,
    isTypeScript,
    totalImports: imports.length,
    externalDependencies,
    internalDependencies,
    imports,
    hasCircularDependencies: false, // TODO: Implement circular dependency detection
  };
}

/**
 * Parse import statements from source code
 */
function parseImports(content: string): ImportUsage[] {
  const imports: ImportUsage[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = i + 1;

    // Static imports: import ... from '...'
    const staticImportRegex =
      /^\s*import\s+(?:type\s+)?(?:(\*\s+as\s+\w+|\{[^}]*\}|[\w$]+)(?:\s*,\s*(\{[^}]*\}|\*\s+as\s+\w+))?\s+from\s+)?['"`]([^'"`]+)['"`]/;
    const staticMatch = line.match(staticImportRegex);
    if (staticMatch) {
      const [fullMatch, binding1, binding2, source] = staticMatch;
      const isTypeOnly = /^\s*import\s+type\s+/.test(line);
      const bindings = parseImportBindings(binding1, binding2);

      imports.push({
        type: isTypeOnly ? 'import-type' : bindings.length === 0 ? 'side-effect-import' : 'static-import',
        source: source.trim(),
        specifier: source.trim(),
        importedBindings: bindings,
        isTypeOnly,
        line: lineNumber,
        column: line.indexOf('import'),
        rawStatement: fullMatch.trim(),
      });
      continue;
    }

    // Dynamic imports: import('...')
    const dynamicImportRegex = /import\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
    let dynamicMatch;
    while ((dynamicMatch = dynamicImportRegex.exec(line)) !== null) {
      const source = dynamicMatch[1];
      imports.push({
        type: 'dynamic-import',
        source: source.trim(),
        specifier: source.trim(),
        importedBindings: [],
        isTypeOnly: false,
        line: lineNumber,
        column: dynamicMatch.index,
        rawStatement: dynamicMatch[0],
      });
    }

    // CommonJS require: require('...')
    const requireRegex = /require\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
    let requireMatch;
    while ((requireMatch = requireRegex.exec(line)) !== null) {
      const source = requireMatch[1];

      // Check if it's require.resolve
      const isResolve = /require\.resolve\s*\(/.test(line.substring(0, requireMatch.index));

      imports.push({
        type: isResolve ? 'require-resolve' : 'require',
        source: source.trim(),
        specifier: source.trim(),
        importedBindings: [],
        isTypeOnly: false,
        line: lineNumber,
        column: requireMatch.index,
        rawStatement: requireMatch[0],
      });
    }

    // Export from: export ... from '...'
    const exportFromRegex = /^\s*export\s+(?:\*|(?:type\s+)?\{[^}]*\}|\w+)\s+from\s+['"`]([^'"`]+)['"`]/;
    const exportMatch = line.match(exportFromRegex);
    if (exportMatch) {
      const source = exportMatch[1];
      imports.push({
        type: 'export-from',
        source: source.trim(),
        specifier: source.trim(),
        importedBindings: [],
        isTypeOnly: /export\s+type\s+/.test(line),
        line: lineNumber,
        column: line.indexOf('export'),
        rawStatement: exportMatch[0].trim(),
      });
    }
  }

  return imports;
}

/**
 * Parse import bindings from import statements
 */
function parseImportBindings(binding1?: string, binding2?: string): string[] {
  const bindings: string[] = [];

  if (binding1) {
    if (binding1.includes('*')) {
      // namespace import: * as foo
      const namespaceMatch = binding1.match(/\*\s+as\s+(\w+)/);
      if (namespaceMatch) {
        bindings.push(namespaceMatch[1]);
      }
    } else if (binding1.includes('{')) {
      // named imports: { a, b, c }
      const namedImports = binding1.replace(/[{}]/g, '').split(',');
      for (const namedImport of namedImports) {
        const cleaned = namedImport.trim();
        if (cleaned) {
          // Handle aliases: { foo as bar }
          const aliasMatch = cleaned.match(/(\w+)\s+as\s+(\w+)/);
          if (aliasMatch) {
            bindings.push(aliasMatch[2]); // Use the alias name
          } else {
            bindings.push(cleaned);
          }
        }
      }
    } else {
      // default import
      bindings.push(binding1.trim());
    }
  }

  if (binding2) {
    // Handle mixed imports: default, { named }
    if (binding2.includes('{')) {
      const namedImports = binding2.replace(/[{}]/g, '').split(',');
      for (const namedImport of namedImports) {
        const cleaned = namedImport.trim();
        if (cleaned) {
          const aliasMatch = cleaned.match(/(\w+)\s+as\s+(\w+)/);
          if (aliasMatch) {
            bindings.push(aliasMatch[2]);
          } else {
            bindings.push(cleaned);
          }
        }
      }
    }
  }

  return bindings;
}

/**
 * Check if a module is an external dependency (not relative)
 */
function isExternalDependency(source: string): boolean {
  return !source.startsWith('.') && !source.startsWith('/') && !source.startsWith('node:');
}

/**
 * Extract package name from import specifier
 */
function extractPackageName(specifier: string): string {
  // Handle scoped packages
  if (specifier.startsWith('@')) {
    const parts = specifier.split('/');
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : specifier;
  }

  // Handle regular packages
  const parts = specifier.split('/');
  return parts[0];
}

/**
 * Enrich dependency information with package.json data
 */
async function enrichWithPackageJsonInfo(
  projectPath: string,
  dependencies: Map<string, DependencyInfo>,
): Promise<void> {
  const packageJsonPath = path.join(projectPath, 'package.json');

  if (!fs.existsSync(packageJsonPath)) {
    return;
  }

  try {
    const packageJsonContent = fs.readFileSync(packageJsonPath, 'utf8');
    const packageJson = JSON.parse(packageJsonContent);

    const allDeps = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
      ...packageJson.peerDependencies,
    };

    for (const [depName, depInfo] of dependencies) {
      if (packageJson.dependencies?.[depName]) {
        depInfo.isDirect = true;
        depInfo.version = packageJson.dependencies[depName];
      }

      if (packageJson.devDependencies?.[depName]) {
        depInfo.isDirect = true;
        depInfo.isDevDependency = true;
        depInfo.version = packageJson.devDependencies[depName];
      }

      if (packageJson.peerDependencies?.[depName]) {
        depInfo.isPeerDependency = true;
        depInfo.version = packageJson.peerDependencies[depName];
      }
    }
  } catch (error) {
    // Ignore JSON parsing errors
  }
}

/**
 * Enrich with dependency tree information using package manager commands
 */
async function enrichWithDependencyTree(
  projectPath: string,
  packageManagerResult: PackageManagerResult,
  dependencies: Map<string, DependencyInfo>,
): Promise<void> {
  if (!packageManagerResult.packageManager) {
    return;
  }

  try {
    for (const [depName, depInfo] of dependencies) {
      let command: string;

      switch (packageManagerResult.packageManager) {
        case 'yarn':
          command = `yarn why ${depName}`;
          break;
        case 'pnpm':
          command = `pnpm why ${depName}`;
          break;
        case 'npm':
          command = `npm ls ${depName} --depth=0`;
          break;
        default:
          continue;
      }

      try {
        const { stdout } = await execAsync(command, {
          cwd: projectPath,
          timeout: 10000, // 10 second timeout
        });

        // Parse the output to get dependency path information
        const dependencyPath = parseDependencyTreeOutput(stdout, packageManagerResult.packageManager);
        if (dependencyPath.length > 0) {
          depInfo.dependencyPath = dependencyPath;
        }
      } catch (error) {
        // Ignore individual command failures
      }
    }
  } catch (error) {
    // Ignore global failures
  }
}

/**
 * Parse dependency tree output from package managers
 */
function parseDependencyTreeOutput(output: string, packageManager: string): string[] {
  const lines = output
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
  const dependencyPath: string[] = [];

  if (packageManager === 'yarn') {
    // Yarn output format: info "package@version" dependencies: ["dep1@version", "dep2@version"]
    for (const line of lines) {
      if (line.includes('└─') || line.includes('├─')) {
        const match = line.match(/[└├]─\s*(.+?)@/);
        if (match) {
          dependencyPath.push(match[1]);
        }
      }
    }
  } else if (packageManager === 'pnpm') {
    // PNPM output format similar to npm but with different symbols
    for (const line of lines) {
      if (line.includes('└─') || line.includes('├─')) {
        const match = line.match(/[└├]─\s*(.+?)@/);
        if (match) {
          dependencyPath.push(match[1]);
        }
      }
    }
  } else if (packageManager === 'npm') {
    // NPM ls output format
    for (const line of lines) {
      if (line.includes('└─') || line.includes('├─')) {
        const match = line.match(/[└├]─\s*(.+?)@/);
        if (match) {
          dependencyPath.push(match[1]);
        }
      }
    }
  }

  return dependencyPath;
}

/**
 * Assess dependency criticality based on usage patterns and characteristics
 */
function assessDependencyCriticality(depInfo: DependencyInfo): void {
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
  if (depInfo.isDirect && !depInfo.isDevDependency) {
    score += 2;
    reasons.push('Direct production dependency');
  }

  // Dev dependency scoring
  if (depInfo.isDevDependency) {
    score -= 1;
    reasons.push('Development-only dependency');
  }

  // Import type analysis
  const hasRuntimeImports = depInfo.usagePatterns.some(
    pattern => !pattern.isTypeOnly && pattern.type !== 'import-type',
  );

  if (hasRuntimeImports) {
    score += 2;
    reasons.push('Used at runtime');
  } else {
    score -= 1;
    reasons.push('Type-only or development usage');
  }

  // Critical package patterns
  const criticalPackagePatterns = [
    'react',
    'vue',
    'angular',
    'express',
    'fastify',
    'next',
    'webpack',
    'vite',
    'rollup',
    'typescript',
    'babel',
  ];

  if (criticalPackagePatterns.some(pattern => depInfo.name.includes(pattern))) {
    score += 2;
    reasons.push('Framework or build tool dependency');
  }

  // Core utility patterns
  const utilityPatterns = ['lodash', 'ramda', 'date-fns', 'axios', 'fetch'];
  if (utilityPatterns.some(pattern => depInfo.name.includes(pattern))) {
    score += 1;
    reasons.push('Core utility library');
  }

  // Side effect imports (may indicate critical setup)
  const hasSideEffectImports = depInfo.usagePatterns.some(pattern => pattern.type === 'side-effect-import');

  if (hasSideEffectImports) {
    score += 1;
    reasons.push('Side-effect imports detected (may indicate critical setup)');
  }

  // Dynamic imports (may indicate optional/lazy loading)
  const hasDynamicImports = depInfo.usagePatterns.some(pattern => pattern.type === 'dynamic-import');

  if (hasDynamicImports && depInfo.usagePatterns.length === 1) {
    score -= 1;
    reasons.push('Only used in dynamic imports (may be optional)');
  }

  // Determine final criticality
  if (score >= 4) {
    depInfo.criticality = 'HIGH';
  } else if (score >= 2) {
    depInfo.criticality = 'MEDIUM';
  } else {
    depInfo.criticality = 'LOW';
  }

  depInfo.criticalityReasons = reasons;
}

/**
 * Generate analysis results summary
 */
function generateAnalysisResults(
  dependencies: DependencyInfo[],
  files: FileAnalysis[],
): DependencyAnalysis['analysisResults'] {
  const directDeps = dependencies.filter(d => d.isDirect).length;
  const devDeps = dependencies.filter(d => d.isDevDependency).length;
  const transitiveDeps = dependencies.filter(d => !d.isDirect).length;

  const highCriticality = dependencies.filter(d => d.criticality === 'HIGH').length;
  const mediumCriticality = dependencies.filter(d => d.criticality === 'MEDIUM').length;
  const lowCriticality = dependencies.filter(d => d.criticality === 'LOW').length;

  return {
    totalFiles: files.length,
    totalDependencies: dependencies.length,
    directDependencies: directDeps,
    devDependencies: devDeps,
    transitiveDependencies: transitiveDeps,
    highCriticalityDeps: highCriticality,
    mediumCriticalityDeps: mediumCriticality,
    lowCriticalityDeps: lowCriticality,
  };
}

/**
 * Generate recommendations based on analysis
 */
function generateRecommendations(
  dependencies: DependencyInfo[],
  files: FileAnalysis[],
  packageManagerResult: PackageManagerResult,
): string[] {
  const recommendations: string[] = [];

  // High criticality dependencies without direct declaration
  const criticalTransitive = dependencies.filter(d => d.criticality === 'HIGH' && !d.isDirect);

  if (criticalTransitive.length > 0) {
    recommendations.push(
      `Consider adding ${criticalTransitive.length} high-criticality transitive dependencies as direct dependencies: ${criticalTransitive.map(d => d.name).join(', ')}`,
    );
  }

  // Unused dev dependencies
  const unusedDevDeps = dependencies.filter(d => d.isDevDependency && d.usageCount === 0);

  if (unusedDevDeps.length > 0) {
    recommendations.push(
      `${unusedDevDeps.length} dev dependencies appear unused and could be removed: ${unusedDevDeps.map(d => d.name).join(', ')}`,
    );
  }

  // Type-only imports that could be dev dependencies
  const typeOnlyProd = dependencies.filter(
    d => d.isDirect && !d.isDevDependency && d.usagePatterns.every(p => p.isTypeOnly || p.type === 'import-type'),
  );

  if (typeOnlyProd.length > 0) {
    recommendations.push(
      `${typeOnlyProd.length} production dependencies only used for types could be moved to devDependencies: ${typeOnlyProd.map(d => d.name).join(', ')}`,
    );
  }

  // Heavy usage dependencies
  const heavyUsage = dependencies.filter(d => d.usageCount >= 10);
  if (heavyUsage.length > 0) {
    recommendations.push(
      `${heavyUsage.length} dependencies are heavily used (10+ imports) - ensure they are properly optimized: ${heavyUsage.map(d => d.name).join(', ')}`,
    );
  }

  // Package manager specific recommendations
  if (packageManagerResult.packageManager === 'npm' && packageManagerResult.confidence === 'low') {
    recommendations.push('Consider using a lock file (package-lock.json) for consistent dependency resolution');
  }

  if (!packageManagerResult.isMonorepo && files.length > 50) {
    recommendations.push('Large codebase detected - consider using a monorepo setup for better dependency management');
  }

  return recommendations;
}
