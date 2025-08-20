import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { pythonPackageManagerDetectorTool, type PythonPackageManagerResult } from './python-package-manager-detector-tool';

const execAsync = promisify(exec);

// Schema for import/dependency usage information
const importUsageSchema = z.object({
  type: z
    .enum([
      'import',
      'from-import',
      'dynamic-import',
      'conditional-import',
      'try-except-import',
      '__import__',
      'importlib-import',
    ])
    .describe('Type of import statement'),
  source: z.string().describe('The imported module/package name'),
  specifier: z.string().describe('The full import specifier (e.g., "numpy.array")'),
  importedBindings: z.array(z.string()).describe('Names imported from the module'),
  alias: z.string().nullable().describe('Alias used for the import (as keyword)'),
  isConditional: z.boolean().describe('Whether this import is conditional'),
  line: z.number().describe('Line number where the import occurs'),
  rawStatement: z.string().describe('The raw import statement'),
});

const dependencyInfoSchema = z.object({
  name: z.string().describe('Package name'),
  version: z.string().nullable().describe('Installed version'),
  specifiedVersion: z.string().nullable().describe('Version specified in dependency files'),
  isDirect: z.boolean().describe('Whether this is a direct dependency'),
  isDevDependency: z.boolean().describe('Whether this is a dev dependency'),
  isOptionalDependency: z.boolean().describe('Whether this is an optional dependency'),
  dependencyGroup: z.string().nullable().describe('Dependency group (dev, test, docs, etc.)'),
  dependencyPath: z.array(z.string()).describe('Dependency chain (for transitive deps)'),
  usageCount: z.number().describe('Number of times this dependency is used'),
  usagePatterns: z.array(importUsageSchema).describe('All usage patterns found'),
  criticality: z.enum(['HIGH', 'MEDIUM', 'LOW']).describe('Assessed criticality of the dependency'),
  criticalityReasons: z.array(z.string()).describe('Reasons for the criticality assessment'),
  isStandardLibrary: z.boolean().describe('Whether this is a Python standard library module'),
  isLocalModule: z.boolean().describe('Whether this is a local project module'),
});

const fileAnalysisSchema = z.object({
  filePath: z.string().describe('Path to the analyzed file'),
  isPythonFile: z.boolean().describe('Whether the file is a Python file'),
  totalImports: z.number().describe('Total number of import statements'),
  externalDependencies: z.array(z.string()).describe('External package dependencies found'),
  standardLibraryImports: z.array(z.string()).describe('Standard library imports found'),
  localImports: z.array(z.string()).describe('Local/relative imports found'),
  imports: z.array(importUsageSchema).describe('All import statements found'),
  hasConditionalImports: z.boolean().describe('Whether conditional imports were detected'),
});

const dependencyAnalysisSchema = z.object({
  projectPath: z.string().describe('Path to the analyzed project'),
  packageManager: z
    .object({
      type: z.enum(['pip', 'uv', 'poetry', 'conda', 'pipenv']).nullable(),
      secondaryManagers: z.array(z.enum(['pip', 'uv', 'poetry', 'conda', 'pipenv'])),
      virtualEnvironment: z.object({
        type: z.enum(['venv', 'virtualenv', 'conda', 'poetry-venv', 'pipenv-venv', 'uv-venv', 'none']),
        path: z.string().nullable(),
        pythonVersion: z.string().nullable(),
      }),
      confidence: z.enum(['low', 'medium', 'high']),
    })
    .describe('Detected package manager information'),
  pythonVersion: z.string().nullable().describe('Python version detected in project'),
  analysisResults: z.object({
    totalFiles: z.number().describe('Total number of files analyzed'),
    totalDependencies: z.number().describe('Total unique dependencies found'),
    directDependencies: z.number().describe('Number of direct dependencies'),
    devDependencies: z.number().describe('Number of dev dependencies'),
    optionalDependencies: z.number().describe('Number of optional dependencies'),
    transitiveDependencies: z.number().describe('Number of transitive dependencies'),
    standardLibraryImports: z.number().describe('Number of standard library imports'),
    localModules: z.number().describe('Number of local modules'),
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
export type PythonDependencyAnalysis = z.infer<typeof dependencyAnalysisSchema>;

/**
 * Comprehensive tool for analyzing Python dependency usage
 */
export const pythonDependencyAnalysisTool = createTool({
  id: 'python-dependency-analysis',
  description:
    'Analyzes Python code to identify how dependencies are used, their criticality, and provides recommendations',
  inputSchema: z.object({
    projectPath: z.string().describe('Path to the project directory to analyze').optional(),
    includePatterns: z
      .array(z.string())
      .describe('Glob patterns for files to include (default: **/*.py)')
      .optional(),
    excludePatterns: z
      .array(z.string())
      .describe('Glob patterns for files to exclude (default: venv, .venv, __pycache__, .git)')
      .optional(),
    maxDepth: z.number().describe('Maximum directory depth to search (default: 10)').optional(),
    analyzeTransitive: z.boolean().describe('Whether to analyze transitive dependencies (default: true)').optional(),
  }),
  outputSchema: dependencyAnalysisSchema,
  execute: async ({ context, runtimeContext }) => {
    const {
      projectPath = process.cwd(),
      includePatterns = ['**/*.py'],
      excludePatterns = ['**/venv/**', '**/.venv/**', '**/__pycache__/**', '**/.git/**', '**/site-packages/**'],
      maxDepth = 10,
      analyzeTransitive = true,
    } = context;

    const resolvedPath = path.resolve(projectPath);

    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Project path does not exist: ${resolvedPath}`);
    }

    try {
      // 1. Detect package manager
      const packageManagerResult = await pythonPackageManagerDetectorTool.execute({
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
          if (!importUsage.isConditional || importUsage.source) {
            const packageName = extractPackageName(importUsage.source);
            const isStdLib = isStandardLibrary(packageName);
            const isLocal = isLocalModule(importUsage.source, resolvedPath);

            if (!isStdLib && !isLocal) {
              if (!allDependencies.has(packageName)) {
                allDependencies.set(packageName, {
                  name: packageName,
                  version: null,
                  specifiedVersion: null,
                  isDirect: false,
                  isDevDependency: false,
                  isOptionalDependency: false,
                  dependencyGroup: null,
                  dependencyPath: [],
                  usageCount: 0,
                  usagePatterns: [],
                  criticality: 'LOW',
                  criticalityReasons: [],
                  isStandardLibrary: false,
                  isLocalModule: false,
                });
              }

              const depInfo = allDependencies.get(packageName)!;
              depInfo.usageCount++;
              depInfo.usagePatterns.push(importUsage);
            }
          }
        }
      }

      // 4. Get dependency information from package manager
      await enrichWithPackageManagerInfo(resolvedPath, packageManagerResult, allDependencies);

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
          secondaryManagers: packageManagerResult.secondaryManagers,
          virtualEnvironment: packageManagerResult.virtualEnvironment,
          confidence: packageManagerResult.confidence,
        },
        pythonVersion: packageManagerResult.pythonVersion,
        analysisResults,
        dependencies,
        files: fileAnalyses,
        recommendations,
      };
    } catch (error) {
      throw new Error(
        `Failed to analyze Python dependencies: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
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
  const normalizedPath = filePath.replace(/\\/g, '/');
  let normalizedPattern = pattern.replace(/\\/g, '/');

  // Handle brace expansion first (e.g., {py,pyw})
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
  const isPythonFile = /\.pyw?$/.test(filePath);
  const relativePath = path.relative(projectRoot, filePath);

  if (!isPythonFile) {
    return {
      filePath: relativePath,
      isPythonFile: false,
      totalImports: 0,
      externalDependencies: [],
      standardLibraryImports: [],
      localImports: [],
      imports: [],
      hasConditionalImports: false,
    };
  }

  const imports = parseImports(content);
  const externalDependencies: string[] = [];
  const standardLibraryImports: string[] = [];
  const localImports: string[] = [];
  let hasConditionalImports = false;

  for (const importUsage of imports) {
    if (importUsage.isConditional) {
      hasConditionalImports = true;
    }

    const packageName = extractPackageName(importUsage.source);

    if (isStandardLibrary(packageName)) {
      if (!standardLibraryImports.includes(packageName)) {
        standardLibraryImports.push(packageName);
      }
    } else if (isLocalModule(importUsage.source, projectRoot)) {
      if (!localImports.includes(importUsage.source)) {
        localImports.push(importUsage.source);
      }
    } else {
      if (!externalDependencies.includes(packageName)) {
        externalDependencies.push(packageName);
      }
    }
  }

  return {
    filePath: relativePath,
    isPythonFile,
    totalImports: imports.length,
    externalDependencies,
    standardLibraryImports,
    localImports,
    imports,
    hasConditionalImports,
  };
}

/**
 * Parse import statements from Python source code
 */
function parseImports(content: string): ImportUsage[] {
  const imports: ImportUsage[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const lineNumber = i + 1;

    if (!line || line.startsWith('#')) continue;

    // Check if this is a conditional import (inside if/try block)
    const isConditional = isConditionalImportContext(lines, i);

    // Simple import: import module
    const simpleImportRegex = /^import\s+([\w.]+)(?:\s+as\s+(\w+))?$/;
    const simpleMatch = line.match(simpleImportRegex);
    if (simpleMatch) {
      const [, source, alias] = simpleMatch;
      imports.push({
        type: 'import',
        source: source.trim(),
        specifier: source.trim(),
        importedBindings: [alias || source.split('.')[0]],
        alias: alias || null,
        isConditional,
        line: lineNumber,
        rawStatement: line,
      });
      continue;
    }

    // From import: from module import name1, name2
    const fromImportRegex = /^from\s+([\w.]+)\s+import\s+(.+)$/;
    const fromMatch = line.match(fromImportRegex);
    if (fromMatch) {
      const [, source, imports_str] = fromMatch;
      const bindings = parseImportBindings(imports_str);

      imports.push({
        type: 'from-import',
        source: source.trim(),
        specifier: `${source}.${imports_str}`,
        importedBindings: bindings,
        alias: null,
        isConditional,
        line: lineNumber,
        rawStatement: line,
      });
      continue;
    }

    // Multiple imports on one line: import a, b, c
    const multiImportRegex = /^import\s+(.+)$/;
    const multiMatch = line.match(multiImportRegex);
    if (multiMatch && multiMatch[1].includes(',')) {
      const modules = multiMatch[1].split(',');
      for (const module of modules) {
        const trimmed = module.trim();
        const asMatch = trimmed.match(/^([\w.]+)(?:\s+as\s+(\w+))?$/);
        if (asMatch) {
          const [, source, alias] = asMatch;
          imports.push({
            type: 'import',
            source: source.trim(),
            specifier: source.trim(),
            importedBindings: [alias || source.split('.')[0]],
            alias: alias || null,
            isConditional,
            line: lineNumber,
            rawStatement: line,
          });
        }
      }
      continue;
    }

    // Dynamic imports
    if (line.includes('__import__')) {
      const dynamicRegex = /__import__\s*\(\s*['"`]([^'"`]+)['"`]/;
      const dynamicMatch = line.match(dynamicRegex);
      if (dynamicMatch) {
        const source = dynamicMatch[1];
        imports.push({
          type: '__import__',
          source: source.trim(),
          specifier: source.trim(),
          importedBindings: [],
          alias: null,
          isConditional,
          line: lineNumber,
          rawStatement: line,
        });
      }
    }

    // importlib imports
    if (line.includes('importlib.import_module')) {
      const importlibRegex = /importlib\.import_module\s*\(\s*['"`]([^'"`]+)['"`]/;
      const importlibMatch = line.match(importlibRegex);
      if (importlibMatch) {
        const source = importlibMatch[1];
        imports.push({
          type: 'importlib-import',
          source: source.trim(),
          specifier: source.trim(),
          importedBindings: [],
          alias: null,
          isConditional,
          line: lineNumber,
          rawStatement: line,
        });
      }
    }
  }

  return imports;
}

/**
 * Check if an import is in a conditional context (try/except, if statement)
 */
function isConditionalImportContext(lines: string[], currentIndex: number): boolean {
  // Look backwards to find if we're inside a try/except or if block
  for (let i = currentIndex - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;

    // Check indentation - if current line is not indented relative to this line, we've gone too far
    const currentIndent = lines[currentIndex].length - lines[currentIndex].trimStart().length;
    const checkIndent = lines[i].length - lines[i].trimStart().length;

    if (currentIndent <= checkIndent) {
      if (line.startsWith('try:') || line.startsWith('if ') || line.startsWith('except')) {
        return true;
      }
      break;
    }
  }
  return false;
}

/**
 * Parse import bindings from from...import statements
 */
function parseImportBindings(imports_str: string): string[] {
  const bindings: string[] = [];
  
  // Handle parentheses for multi-line imports
  const cleaned = imports_str.replace(/[()]/g, '');
  
  if (cleaned.includes('*')) {
    return ['*'];
  }

  const parts = cleaned.split(',');
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed) {
      // Handle aliases: name as alias
      const aliasMatch = trimmed.match(/^(\w+)\s+as\s+(\w+)$/);
      if (aliasMatch) {
        bindings.push(aliasMatch[2]); // Use the alias name
      } else {
        bindings.push(trimmed);
      }
    }
  }

  return bindings;
}

/**
 * Extract package name from import specifier
 */
function extractPackageName(specifier: string): string {
  // Handle relative imports
  if (specifier.startsWith('.')) {
    return specifier;
  }

  // Get the top-level package name
  const parts = specifier.split('.');
  return parts[0];
}

/**
 * Check if a module is part of Python standard library
 */
function isStandardLibrary(moduleName: string): boolean {
  // Common Python standard library modules
  const stdLibModules = new Set([
    'os', 'sys', 'json', 're', 'datetime', 'time', 'math', 'random', 'urllib', 'http', 
    'pathlib', 'collections', 'itertools', 'functools', 'operator', 'string', 'io',
    'csv', 'xml', 'html', 'email', 'base64', 'hashlib', 'hmac', 'secrets', 'uuid',
    'logging', 'warnings', 'traceback', 'inspect', 'types', 'copy', 'pickle',
    'sqlite3', 'dbm', 'gzip', 'tarfile', 'zipfile', 'configparser', 'argparse',
    'threading', 'multiprocessing', 'subprocess', 'queue', 'socket', 'ssl',
    'asyncio', 'concurrent', 'unittest', 'doctest', 'pdb', 'profile', 'cProfile',
    'timeit', 'gc', 'weakref', 'contextlib', 'abc', 'numbers', 'decimal', 'fractions',
    'statistics', 'enum', 'dataclasses', 'typing', 'typing_extensions', 'importlib',
  ]);

  return stdLibModules.has(moduleName);
}

/**
 * Check if a module is a local module
 */
function isLocalModule(specifier: string, projectRoot: string): boolean {
  // Relative imports are always local
  if (specifier.startsWith('.')) {
    return true;
  }

  // Check if a corresponding .py file exists in the project
  const parts = specifier.split('.');
  let currentPath = projectRoot;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const possiblePaths = [
      path.join(currentPath, `${part}.py`),
      path.join(currentPath, part, '__init__.py'),
    ];

    let found = false;
    for (const possiblePath of possiblePaths) {
      if (fs.existsSync(possiblePath)) {
        found = true;
        if (i === parts.length - 1) {
          return true; // Found the final module
        }
        currentPath = path.join(currentPath, part);
        break;
      }
    }

    if (!found) {
      break;
    }
  }

  return false;
}

/**
 * Enrich dependency information with package manager data
 */
async function enrichWithPackageManagerInfo(
  projectPath: string,
  packageManagerResult: PythonPackageManagerResult,
  dependencies: Map<string, DependencyInfo>,
): Promise<void> {
  // Parse different dependency files based on detected package manager
  if (packageManagerResult.packageManager === 'poetry' || packageManagerResult.configFiles.includes('pyproject.toml')) {
    await parsePoetryDependencies(projectPath, dependencies);
  }

  if (packageManagerResult.dependencyFiles.some(f => f.includes('requirements'))) {
    await parseRequirementsTxt(projectPath, dependencies);
  }

  if (packageManagerResult.packageManager === 'pipenv' || packageManagerResult.dependencyFiles.includes('Pipfile')) {
    await parsePipfileDependencies(projectPath, dependencies);
  }
}

/**
 * Parse Poetry dependencies from pyproject.toml
 */
async function parsePoetryDependencies(projectPath: string, dependencies: Map<string, DependencyInfo>): Promise<void> {
  const pyprojectPath = path.join(projectPath, 'pyproject.toml');
  if (!fs.existsSync(pyprojectPath)) return;

  try {
    const content = fs.readFileSync(pyprojectPath, 'utf8');
    
    // Simple parsing - in production, you'd use a proper TOML parser
    const lines = content.split('\n');
    let inDependenciesSection = false;
    let inDevDependenciesSection = false;
    let currentGroup = 'main';

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed === '[tool.poetry.dependencies]') {
        inDependenciesSection = true;
        inDevDependenciesSection = false;
        currentGroup = 'main';
        continue;
      } else if (trimmed.startsWith('[tool.poetry.group.') && trimmed.includes('.dependencies]')) {
        inDependenciesSection = false;
        inDevDependenciesSection = true;
        const groupMatch = trimmed.match(/\[tool\.poetry\.group\.([^.]+)\.dependencies\]/);
        currentGroup = groupMatch ? groupMatch[1] : 'dev';
        continue;
      } else if (trimmed.startsWith('[') && !trimmed.includes('dependencies')) {
        inDependenciesSection = false;
        inDevDependenciesSection = false;
        continue;
      }

      if ((inDependenciesSection || inDevDependenciesSection) && trimmed.includes('=')) {
        const match = trimmed.match(/^([^=\s]+)\s*=\s*(.+)$/);
        if (match) {
          const [, packageName, versionSpec] = match;
          const cleanPackageName = packageName.trim();
          const cleanVersionSpec = versionSpec.trim().replace(/['"]/g, '');

          if (dependencies.has(cleanPackageName)) {
            const depInfo = dependencies.get(cleanPackageName)!;
            depInfo.isDirect = true;
            depInfo.specifiedVersion = cleanVersionSpec;
            depInfo.isDevDependency = inDevDependenciesSection;
            depInfo.dependencyGroup = currentGroup;
          }
        }
      }
    }
  } catch (error) {
    // Ignore parsing errors
  }
}

/**
 * Parse pip requirements from requirements.txt files
 */
async function parseRequirementsTxt(projectPath: string, dependencies: Map<string, DependencyInfo>): Promise<void> {
  const requirementFiles = ['requirements.txt', 'requirements.in', 'dev-requirements.txt'];

  for (const filename of requirementFiles) {
    const reqPath = path.join(projectPath, filename);
    if (!fs.existsSync(reqPath)) continue;

    try {
      const content = fs.readFileSync(reqPath, 'utf8');
      const lines = content.split('\n');

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('-')) continue;

        const match = trimmed.match(/^([a-zA-Z0-9_-]+)([>=<~!]=?[^#\s]*)?/);
        if (match) {
          const [, packageName, versionSpec] = match;
          
          if (dependencies.has(packageName)) {
            const depInfo = dependencies.get(packageName)!;
            depInfo.isDirect = true;
            depInfo.specifiedVersion = versionSpec || null;
            depInfo.isDevDependency = filename.includes('dev');
          }
        }
      }
    } catch (error) {
      // Ignore file read errors
    }
  }
}

/**
 * Parse Pipenv dependencies from Pipfile
 */
async function parsePipfileDependencies(projectPath: string, dependencies: Map<string, DependencyInfo>): Promise<void> {
  const pipfilePath = path.join(projectPath, 'Pipfile');
  if (!fs.existsSync(pipfilePath)) return;

  try {
    const content = fs.readFileSync(pipfilePath, 'utf8');
    const lines = content.split('\n');
    let inPackagesSection = false;
    let inDevPackagesSection = false;

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed === '[packages]') {
        inPackagesSection = true;
        inDevPackagesSection = false;
        continue;
      } else if (trimmed === '[dev-packages]') {
        inPackagesSection = false;
        inDevPackagesSection = true;
        continue;
      } else if (trimmed.startsWith('[') && trimmed !== '[packages]' && trimmed !== '[dev-packages]') {
        inPackagesSection = false;
        inDevPackagesSection = false;
        continue;
      }

      if ((inPackagesSection || inDevPackagesSection) && trimmed.includes('=')) {
        const match = trimmed.match(/^([^=\s]+)\s*=\s*(.+)$/);
        if (match) {
          const [, packageName, versionSpec] = match;
          const cleanPackageName = packageName.trim();
          const cleanVersionSpec = versionSpec.trim().replace(/['"]/g, '');

          if (dependencies.has(cleanPackageName)) {
            const depInfo = dependencies.get(cleanPackageName)!;
            depInfo.isDirect = true;
            depInfo.specifiedVersion = cleanVersionSpec;
            depInfo.isDevDependency = inDevPackagesSection;
          }
        }
      }
    }
  } catch (error) {
    // Ignore parsing errors
  }
}

/**
 * Enrich with dependency tree information using package manager commands
 */
async function enrichWithDependencyTree(
  projectPath: string,
  packageManagerResult: PythonPackageManagerResult,
  dependencies: Map<string, DependencyInfo>,
): Promise<void> {
  if (!packageManagerResult.packageManager) return;

  try {
    let command: string;
    
    switch (packageManagerResult.packageManager) {
      case 'pip':
        // Use pip list to get installed packages
        command = 'pip list --format=json';
        break;
      case 'poetry':
        command = 'poetry show --tree';
        break;
      case 'uv':
        command = 'uv tree';
        break;
      case 'pipenv':
        command = 'pipenv graph';
        break;
      default:
        return;
    }

    try {
      const { stdout } = await execAsync(command, {
        cwd: projectPath,
        timeout: 30000, // 30 second timeout
      });

      if (packageManagerResult.packageManager === 'pip') {
        // Parse JSON output from pip list
        try {
          const packages = JSON.parse(stdout);
          for (const pkg of packages) {
            if (dependencies.has(pkg.name)) {
              const depInfo = dependencies.get(pkg.name)!;
              depInfo.version = pkg.version;
            }
          }
        } catch (parseError) {
          // Ignore JSON parsing errors
        }
      } else {
        // Parse tree output for other package managers
        const dependencyTree = parseDependencyTreeOutput(stdout, packageManagerResult.packageManager);
        for (const [depName, depInfo] of dependencies) {
          if (dependencyTree.has(depName)) {
            const treeInfo = dependencyTree.get(depName)!;
            depInfo.version = treeInfo.version;
            depInfo.dependencyPath = treeInfo.path;
          }
        }
      }
    } catch (error) {
      // Ignore command execution errors
    }
  } catch (error) {
    // Ignore global failures
  }
}

/**
 * Parse dependency tree output from package managers
 */
function parseDependencyTreeOutput(
  output: string,
  packageManager: string,
): Map<string, { version: string; path: string[] }> {
  const result = new Map<string, { version: string; path: string[] }>();
  const lines = output.split('\n').filter(line => line.trim());

  // This is a simplified parser - in production you'd want more robust parsing
  for (const line of lines) {
    const trimmed = line.trim();
    if (packageManager === 'poetry' || packageManager === 'uv') {
      // Look for lines like "├── package v1.0.0" or "└── package v1.0.0"
      const match = trimmed.match(/[├└]── ([^\s]+)\s+v?([^\s]+)/);
      if (match) {
        const [, name, version] = match;
        result.set(name, { version, path: [] });
      }
    } else if (packageManager === 'pipenv') {
      // Look for lines like "  - package==1.0.0"
      const match = trimmed.match(/^[-*]\s+([^=]+)==([^\s]+)/);
      if (match) {
        const [, name, version] = match;
        result.set(name, { version, path: [] });
      }
    }
  }

  return result;
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
  const hasConditionalImports = depInfo.usagePatterns.some(pattern => pattern.isConditional);
  if (hasConditionalImports) {
    score -= 1;
    reasons.push('Used conditionally (may be optional)');
  }

  // Critical package patterns for Python
  const criticalPackagePatterns = [
    'django', 'flask', 'fastapi', 'numpy', 'pandas', 'requests', 'urllib3',
    'pytest', 'setuptools', 'wheel', 'pip', 'poetry', 'uv'
  ];

  if (criticalPackagePatterns.some(pattern => depInfo.name.includes(pattern))) {
    score += 2;
    reasons.push('Framework or essential library dependency');
  }

  // Core utility patterns
  const utilityPatterns = ['click', 'typer', 'rich', 'pydantic', 'sqlalchemy', 'celery'];
  if (utilityPatterns.some(pattern => depInfo.name.includes(pattern))) {
    score += 1;
    reasons.push('Core utility library');
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
): PythonDependencyAnalysis['analysisResults'] {
  const directDeps = dependencies.filter(d => d.isDirect).length;
  const devDeps = dependencies.filter(d => d.isDevDependency).length;
  const optionalDeps = dependencies.filter(d => d.isOptionalDependency).length;
  const transitiveDeps = dependencies.filter(d => !d.isDirect).length;

  const highCriticality = dependencies.filter(d => d.criticality === 'HIGH').length;
  const mediumCriticality = dependencies.filter(d => d.criticality === 'MEDIUM').length;
  const lowCriticality = dependencies.filter(d => d.criticality === 'LOW').length;

  const standardLibraryImports = files.reduce((sum, file) => sum + file.standardLibraryImports.length, 0);
  const localModules = files.reduce((sum, file) => sum + file.localImports.length, 0);

  return {
    totalFiles: files.length,
    totalDependencies: dependencies.length,
    directDependencies: directDeps,
    devDependencies: devDeps,
    optionalDependencies: optionalDeps,
    transitiveDependencies: transitiveDeps,
    standardLibraryImports,
    localModules,
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
  packageManagerResult: PythonPackageManagerResult,
): string[] {
  const recommendations: string[] = [];

  // Virtual environment recommendations
  if (packageManagerResult.virtualEnvironment.type === 'none') {
    recommendations.push('Consider using a virtual environment (venv, poetry, pipenv, or uv) for dependency isolation');
  }

  // Package manager recommendations
  if (packageManagerResult.confidence === 'low') {
    recommendations.push('Consider using a more explicit dependency management tool like Poetry or uv for better reproducibility');
  }

  // High criticality dependencies without direct declaration
  const criticalTransitive = dependencies.filter(d => d.criticality === 'HIGH' && !d.isDirect);
  if (criticalTransitive.length > 0) {
    recommendations.push(
      `Consider declaring ${criticalTransitive.length} high-criticality transitive dependencies as direct dependencies: ${criticalTransitive.map(d => d.name).join(', ')}`,
    );
  }

  // Dev dependencies in production
  const devInProd = dependencies.filter(d => d.isDevDependency && d.usageCount > 0);
  if (devInProd.length > 0) {
    recommendations.push(
      `${devInProd.length} dev dependencies are being used in production code: ${devInProd.map(d => d.name).join(', ')}`,
    );
  }

  // Heavy usage dependencies
  const heavyUsage = dependencies.filter(d => d.usageCount >= 10);
  if (heavyUsage.length > 0) {
    recommendations.push(
      `${heavyUsage.length} dependencies are heavily used (10+ imports) - ensure they are properly optimized: ${heavyUsage.map(d => d.name).join(', ')}`,
    );
  }

  // Conditional imports recommendations
  const filesWithConditional = files.filter(f => f.hasConditionalImports);
  if (filesWithConditional.length > 0) {
    recommendations.push(
      `${filesWithConditional.length} files have conditional imports - consider making these optional dependencies explicit`,
    );
  }

  // Python version recommendations
  if (!packageManagerResult.pythonVersion) {
    recommendations.push('Consider specifying Python version in .python-version, runtime.txt, or pyproject.toml for consistency');
  }

  return recommendations;
}