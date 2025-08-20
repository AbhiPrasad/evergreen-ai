import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';

// Schema for Go package manager detection result
const goPackageManagerResultSchema = z.object({
  isGoProject: z.boolean().describe('Whether this is a Go project'),
  moduleMode: z.boolean().describe('Whether the project uses Go modules'),
  goVersion: z.string().nullable().describe('Go version specified in go.mod'),
  toolchainVersion: z.string().nullable().describe('Go toolchain version if specified'),
  modulePath: z.string().nullable().describe('Module path from go.mod'),
  isWorkspace: z.boolean().describe('Whether this is a Go workspace (go.work)'),
  workspaceModules: z.array(z.string()).describe('Module paths in workspace'),
  hasVendor: z.boolean().describe('Whether vendor directory exists'),
  confidence: z.enum(['low', 'medium', 'high']).describe('Confidence level of detection'),
  indicators: z.object({
    goMod: z.boolean().describe('go.mod file found'),
    goSum: z.boolean().describe('go.sum file found'),
    goWork: z.boolean().describe('go.work file found'),
    goFiles: z.array(z.string()).describe('Go source files found'),
    vendorDir: z.boolean().describe('vendor directory found'),
    goPathMode: z.boolean().describe('Legacy GOPATH mode detected'),
  }).describe('Evidence used for detection'),
  goModInfo: z.object({
    moduleName: z.string().nullable(),
    goVersion: z.string().nullable(),
    toolchain: z.string().nullable(),
    requires: z.array(z.object({
      path: z.string(),
      version: z.string(),
      indirect: z.boolean(),
    })),
    replaces: z.array(z.object({
      old: z.string(),
      new: z.string(),
    })),
    excludes: z.array(z.string()),
  }).describe('Parsed go.mod information').optional(),
  goWorkInfo: z.object({
    goVersion: z.string().nullable(),
    toolchain: z.string().nullable(),
    use: z.array(z.string()),
    replace: z.array(z.object({
      old: z.string(),
      new: z.string(),
    })),
  }).describe('Parsed go.work information').optional(),
});

export type GoPackageManagerResult = z.infer<typeof goPackageManagerResultSchema>;

/**
 * Tool for detecting Go modules and workspace configurations
 */
export const goPackageManagerDetectorTool = createTool({
  id: 'go-package-manager-detector',
  description: 'Detects Go modules, workspaces, and project structure in a Go codebase',
  inputSchema: z.object({
    projectPath: z.string().describe('Path to the project directory to analyze (default: current directory)').optional(),
  }),
  outputSchema: goPackageManagerResultSchema,
  execute: async ({ context }) => {
    const { projectPath = process.cwd() } = context;
    const resolvedPath = path.resolve(projectPath);

    // Validate that the path exists
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Project path does not exist: ${resolvedPath}`);
    }

    const result: GoPackageManagerResult = {
      isGoProject: false,
      moduleMode: false,
      goVersion: null,
      toolchainVersion: null,
      modulePath: null,
      isWorkspace: false,
      workspaceModules: [],
      hasVendor: false,
      confidence: 'low',
      indicators: {
        goMod: false,
        goSum: false,
        goWork: false,
        goFiles: [],
        vendorDir: false,
        goPathMode: false,
      },
    };

    try {
      // 1. Check for Go files
      const goFiles = await findGoFiles(resolvedPath);
      result.indicators.goFiles = goFiles;
      result.isGoProject = goFiles.length > 0;

      if (!result.isGoProject) {
        return result;
      }

      // 2. Check for go.work (workspace)
      const goWorkPath = path.join(resolvedPath, 'go.work');
      if (fs.existsSync(goWorkPath)) {
        result.indicators.goWork = true;
        result.isWorkspace = true;
        result.goWorkInfo = await parseGoWork(goWorkPath);
        result.workspaceModules = result.goWorkInfo.use;
        result.goVersion = result.goWorkInfo.goVersion;
        result.toolchainVersion = result.goWorkInfo.toolchain;
      }

      // 3. Check for go.mod (modules)
      const goModPath = path.join(resolvedPath, 'go.mod');
      if (fs.existsSync(goModPath)) {
        result.indicators.goMod = true;
        result.moduleMode = true;
        result.goModInfo = await parseGoMod(goModPath);
        result.modulePath = result.goModInfo.moduleName;
        
        // Use go.mod version info if not already set from go.work
        if (!result.goVersion) {
          result.goVersion = result.goModInfo.goVersion;
        }
        if (!result.toolchainVersion) {
          result.toolchainVersion = result.goModInfo.toolchain;
        }
      }

      // 4. Check for go.sum
      const goSumPath = path.join(resolvedPath, 'go.sum');
      if (fs.existsSync(goSumPath)) {
        result.indicators.goSum = true;
      }

      // 5. Check for vendor directory
      const vendorPath = path.join(resolvedPath, 'vendor');
      if (fs.existsSync(vendorPath) && fs.statSync(vendorPath).isDirectory()) {
        result.indicators.vendorDir = true;
        result.hasVendor = true;
      }

      // 6. Determine if this is GOPATH mode (legacy)
      if (result.isGoProject && !result.moduleMode && !result.isWorkspace) {
        result.indicators.goPathMode = true;
      }

      // 7. Calculate confidence
      calculateConfidence(result);

      return result;
    } catch (error) {
      throw new Error(`Failed to detect Go package manager: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },
});

/**
 * Find Go source files in the project
 */
async function findGoFiles(projectPath: string, maxDepth = 3): Promise<string[]> {
  const goFiles: string[] = [];

  async function walkDirectory(dirPath: string, currentDepth: number): Promise<void> {
    if (currentDepth > maxDepth) return;

    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        // Skip common directories that shouldn't contain Go source
        if (entry.isDirectory() && ['node_modules', '.git', 'vendor', 'build', 'dist'].includes(entry.name)) {
          continue;
        }

        const fullPath = path.join(dirPath, entry.name);
        const relativePath = path.relative(projectPath, fullPath);

        if (entry.isDirectory()) {
          await walkDirectory(fullPath, currentDepth + 1);
        } else if (entry.isFile() && entry.name.endsWith('.go')) {
          // Exclude test files from the main count but include them
          goFiles.push(relativePath);
        }
      }
    } catch (error) {
      // Skip directories we can't read
    }
  }

  await walkDirectory(projectPath, 0);
  return goFiles;
}

/**
 * Parse go.mod file
 */
async function parseGoMod(goModPath: string) {
  const content = fs.readFileSync(goModPath, 'utf8');
  const lines = content.split('\n');

  const goModInfo = {
    moduleName: null as string | null,
    goVersion: null as string | null,
    toolchain: null as string | null,
    requires: [] as Array<{ path: string; version: string; indirect: boolean }>,
    replaces: [] as Array<{ old: string; new: string }>,
    excludes: [] as string[],
  };

  let currentSection = '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;

    // Module declaration
    if (trimmed.startsWith('module ')) {
      goModInfo.moduleName = trimmed.substring(7).trim();
      continue;
    }

    // Go version
    if (trimmed.startsWith('go ')) {
      goModInfo.goVersion = trimmed.substring(3).trim();
      continue;
    }

    // Toolchain
    if (trimmed.startsWith('toolchain ')) {
      goModInfo.toolchain = trimmed.substring(10).trim();
      continue;
    }

    // Section headers
    if (trimmed === 'require (' || trimmed.startsWith('require (')) {
      currentSection = 'require';
      continue;
    }
    if (trimmed === 'replace (' || trimmed.startsWith('replace (')) {
      currentSection = 'replace';
      continue;
    }
    if (trimmed === 'exclude (' || trimmed.startsWith('exclude (')) {
      currentSection = 'exclude';
      continue;
    }

    // End of multi-line section
    if (trimmed === ')') {
      currentSection = '';
      continue;
    }

    // Single-line directives
    if (trimmed.startsWith('require ') && !trimmed.includes('(')) {
      const requireMatch = trimmed.match(/require\s+([^\s]+)\s+([^\s]+)(\s+\/\/\s*indirect)?/);
      if (requireMatch) {
        goModInfo.requires.push({
          path: requireMatch[1],
          version: requireMatch[2],
          indirect: !!requireMatch[3],
        });
      }
      continue;
    }

    if (trimmed.startsWith('replace ') && !trimmed.includes('(')) {
      const replaceMatch = trimmed.match(/replace\s+([^\s]+)\s*=>\s*(.+)/);
      if (replaceMatch) {
        goModInfo.replaces.push({
          old: replaceMatch[1],
          new: replaceMatch[2].trim(),
        });
      }
      continue;
    }

    if (trimmed.startsWith('exclude ') && !trimmed.includes('(')) {
      const excludeMatch = trimmed.match(/exclude\s+(.+)/);
      if (excludeMatch) {
        goModInfo.excludes.push(excludeMatch[1].trim());
      }
      continue;
    }

    // Multi-line section content
    if (currentSection === 'require') {
      const requireMatch = trimmed.match(/([^\s]+)\s+([^\s]+)(\s+\/\/\s*indirect)?/);
      if (requireMatch) {
        goModInfo.requires.push({
          path: requireMatch[1],
          version: requireMatch[2],
          indirect: !!requireMatch[3],
        });
      }
    } else if (currentSection === 'replace') {
      const replaceMatch = trimmed.match(/([^\s]+)\s*=>\s*(.+)/);
      if (replaceMatch) {
        goModInfo.replaces.push({
          old: replaceMatch[1],
          new: replaceMatch[2].trim(),
        });
      }
    } else if (currentSection === 'exclude') {
      goModInfo.excludes.push(trimmed);
    }
  }

  return goModInfo;
}

/**
 * Parse go.work file
 */
async function parseGoWork(goWorkPath: string) {
  const content = fs.readFileSync(goWorkPath, 'utf8');
  const lines = content.split('\n');

  const goWorkInfo = {
    goVersion: null as string | null,
    toolchain: null as string | null,
    use: [] as string[],
    replace: [] as Array<{ old: string; new: string }>,
  };

  let currentSection = '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;

    // Go version
    if (trimmed.startsWith('go ')) {
      goWorkInfo.goVersion = trimmed.substring(3).trim();
      continue;
    }

    // Toolchain
    if (trimmed.startsWith('toolchain ')) {
      goWorkInfo.toolchain = trimmed.substring(10).trim();
      continue;
    }

    // Section headers
    if (trimmed === 'use (' || trimmed.startsWith('use (')) {
      currentSection = 'use';
      continue;
    }
    if (trimmed === 'replace (' || trimmed.startsWith('replace (')) {
      currentSection = 'replace';
      continue;
    }

    // End of multi-line section
    if (trimmed === ')') {
      currentSection = '';
      continue;
    }

    // Single-line directives
    if (trimmed.startsWith('use ') && !trimmed.includes('(')) {
      const useMatch = trimmed.match(/use\s+(.+)/);
      if (useMatch) {
        goWorkInfo.use.push(useMatch[1].trim());
      }
      continue;
    }

    if (trimmed.startsWith('replace ') && !trimmed.includes('(')) {
      const replaceMatch = trimmed.match(/replace\s+([^\s]+)\s*=>\s*(.+)/);
      if (replaceMatch) {
        goWorkInfo.replace.push({
          old: replaceMatch[1],
          new: replaceMatch[2].trim(),
        });
      }
      continue;
    }

    // Multi-line section content
    if (currentSection === 'use') {
      // Remove quotes and clean up path
      const cleanPath = trimmed.replace(/^["']|["']$/g, '');
      goWorkInfo.use.push(cleanPath);
    } else if (currentSection === 'replace') {
      const replaceMatch = trimmed.match(/([^\s]+)\s*=>\s*(.+)/);
      if (replaceMatch) {
        goWorkInfo.replace.push({
          old: replaceMatch[1],
          new: replaceMatch[2].trim(),
        });
      }
    }
  }

  return goWorkInfo;
}

/**
 * Calculate confidence level based on available evidence
 */
function calculateConfidence(result: GoPackageManagerResult): void {
  let score = 0;

  // Strong indicators
  if (result.indicators.goMod) score += 3;
  if (result.indicators.goWork) score += 3;
  if (result.indicators.goSum) score += 2;

  // Medium indicators
  if (result.indicators.goFiles.length > 0) score += 2;
  if (result.indicators.vendorDir) score += 1;

  // Weak indicators
  if (result.indicators.goPathMode) score += 1;

  // Confidence levels
  if (score >= 5) {
    result.confidence = 'high';
  } else if (score >= 3) {
    result.confidence = 'medium';
  } else {
    result.confidence = 'low';
  }
}