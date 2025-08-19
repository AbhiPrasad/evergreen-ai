import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';

// Schema for package manager detection result
const packageManagerResultSchema = z.object({
  packageManager: z.enum(['npm', 'yarn', 'pnpm']).nullable().describe('Detected package manager'),
  lockFile: z.string().nullable().describe('Lock file found (if any)'),
  isMonorepo: z.boolean().describe('Whether the project is a monorepo'),
  workspaceType: z
    .enum(['npm-workspaces', 'pnpm-workspace', 'lerna', 'nx', 'rush'])
    .nullable()
    .describe('Type of workspace configuration'),
  workspacePaths: z.array(z.string()).describe('Array of workspace paths/patterns'),
  packageManagerVersion: z.string().nullable().describe('Package manager version from packageManager field'),
  confidence: z.enum(['low', 'medium', 'high']).describe('Confidence level of detection'),
  indicators: z.object({
    lockFiles: z.array(z.string()).describe('Lock files found'),
    configFiles: z.array(z.string()).describe('Package manager config files found'),
    packageManagerField: z.boolean().describe('Whether packageManager field is present in package.json'),
    workspaceIndicators: z.array(z.string()).describe('Workspace-related files found'),
  }).describe('Evidence used for detection'),
});

export type PackageManagerResult = z.infer<typeof packageManagerResultSchema>;

/**
 * Tool for detecting JavaScript package managers and workspace configurations
 */
export const packageManagerDetectorTool = createTool({
  id: 'package-manager-detector',
  description: 'Detects which JavaScript package manager (npm, yarn, pnpm) is used in a codebase and identifies monorepo/workspace configurations',
  inputSchema: z.object({
    projectPath: z.string().describe('Path to the project directory to analyze (default: current directory)').optional(),
  }),
  outputSchema: packageManagerResultSchema,
  execute: async ({ context }) => {
    const { projectPath = process.cwd() } = context;
    const resolvedPath = path.resolve(projectPath);

    // Validate that the path exists
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Project path does not exist: ${resolvedPath}`);
    }

    const result: PackageManagerResult = {
      packageManager: null,
      lockFile: null,
      isMonorepo: false,
      workspaceType: null,
      workspacePaths: [],
      packageManagerVersion: null,
      confidence: 'low',
      indicators: {
        lockFiles: [],
        configFiles: [],
        packageManagerField: false,
        workspaceIndicators: [],
      },
    };

    try {
      // 1. Detect from lock files (highest confidence)
      detectFromLockFiles(resolvedPath, result);

      // 2. Check package.json for packageManager field and workspaces
      await detectFromPackageJson(resolvedPath, result);

      // 3. Check for package manager config files
      detectConfigFiles(resolvedPath, result);

      // 4. Check for workspace/monorepo indicators
      detectWorkspaceIndicators(resolvedPath, result);

      // 5. Calculate final confidence
      calculateConfidence(result);

      return result;
    } catch (error) {
      throw new Error(`Failed to detect package manager: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },
});

/**
 * Detect package manager from lock files
 */
function detectFromLockFiles(projectPath: string, result: PackageManagerResult): void {
  const lockFiles = [
    { file: 'package-lock.json', manager: 'npm' as const },
    { file: 'yarn.lock', manager: 'yarn' as const },
    { file: 'pnpm-lock.yaml', manager: 'pnpm' as const },
    { file: 'shrinkwrap.yaml', manager: 'pnpm' as const }, // older pnpm versions
  ];

  for (const { file, manager } of lockFiles) {
    const lockPath = path.join(projectPath, file);
    if (fs.existsSync(lockPath)) {
      result.lockFile = file;
      result.packageManager = manager;
      result.indicators.lockFiles.push(file);
      result.confidence = 'high';
      break;
    }
  }
}

/**
 * Check package.json for packageManager field and workspace configuration
 */
async function detectFromPackageJson(projectPath: string, result: PackageManagerResult): Promise<void> {
  const packageJsonPath = path.join(projectPath, 'package.json');

  if (!fs.existsSync(packageJsonPath)) {
    return;
  }

  try {
    const packageJsonContent = fs.readFileSync(packageJsonPath, 'utf8');
    const packageJson = JSON.parse(packageJsonContent);

    // Check for packageManager field (Corepack)
    if (packageJson.packageManager) {
      const match = packageJson.packageManager.match(/^(npm|yarn|pnpm)@(.+)$/);
      if (match) {
        const [, manager, version] = match;
        result.indicators.packageManagerField = true;
        result.packageManagerVersion = version;

        // Only override if we haven't found a lock file or if it matches
        if (!result.packageManager || result.packageManager === manager) {
          result.packageManager = manager as 'npm' | 'yarn' | 'pnpm';
          if (result.confidence !== 'high') {
            result.confidence = 'medium';
          }
        }
      }
    }

    // Check for npm/yarn workspaces
    if (packageJson.workspaces) {
      result.isMonorepo = true;
      result.workspaceType = 'npm-workspaces';
      result.indicators.workspaceIndicators.push('package.json workspaces field');

      if (Array.isArray(packageJson.workspaces)) {
        result.workspacePaths = packageJson.workspaces;
      } else if (packageJson.workspaces.packages) {
        result.workspacePaths = packageJson.workspaces.packages;
      }
    }

    // Check for private field (often indicates monorepo root)
    if (packageJson.private && packageJson.workspaces) {
      result.indicators.workspaceIndicators.push('private: true with workspaces');
    }
  } catch (error) {
    // Ignore JSON parsing errors
  }
}

/**
 * Detect package manager config files
 */
function detectConfigFiles(projectPath: string, result: PackageManagerResult): void {
  const configFiles = [
    { files: ['.yarnrc', '.yarnrc.yml', '.yarnrc.yaml'], manager: 'yarn' as const },
    { files: ['.pnpmrc'], manager: 'pnpm' as const },
    { files: ['.npmrc'], manager: 'npm' as const },
  ];

  for (const { files, manager } of configFiles) {
    for (const file of files) {
      const configPath = path.join(projectPath, file);
      if (fs.existsSync(configPath)) {
        result.indicators.configFiles.push(file);

        // Only set package manager if not already detected with higher confidence
        if (!result.packageManager) {
          result.packageManager = manager;
          // .npmrc is less reliable as it's often present regardless
          result.confidence = manager === 'npm' ? 'low' : 'medium';
        }
      }
    }
  }
}

/**
 * Detect workspace/monorepo indicators
 */
function detectWorkspaceIndicators(projectPath: string, result: PackageManagerResult): void {
  const workspaceFiles = [
    { file: 'pnpm-workspace.yaml', type: 'pnpm-workspace' as const },
    { file: 'lerna.json', type: 'lerna' as const },
    { file: 'nx.json', type: 'nx' as const },
    { file: 'rush.json', type: 'rush' as const },
    { file: 'turbo.json', type: null }, // Turbo works with existing workspace configs
  ];

  for (const { file, type } of workspaceFiles) {
    const filePath = path.join(projectPath, file);
    if (fs.existsSync(filePath)) {
      result.indicators.workspaceIndicators.push(file);

      if (file === 'pnpm-workspace.yaml') {
        result.isMonorepo = true;
        result.workspaceType = type;
        
        // Try to parse workspace paths from pnpm-workspace.yaml
        try {
          const workspaceContent = fs.readFileSync(filePath, 'utf8');
          const packagesMatch = workspaceContent.match(/packages:\s*\n((?:\s*-\s*.+\n?)*)/);
          if (packagesMatch) {
            result.workspacePaths = packagesMatch[1]
              .split('\n')
              .map(line => line.trim().replace(/^-\s*['"]?(.+?)['"]?$/, '$1'))
              .filter(line => line && !line.startsWith('#'));
          }
        } catch (error) {
          // Ignore parsing errors
        }
      } else if (type && !result.workspaceType) {
        result.isMonorepo = true;
        result.workspaceType = type;
      } else if (file === 'turbo.json') {
        result.isMonorepo = true;
        // Turbo doesn't override workspaceType as it works with existing configs
      }
    }
  }

  // Check for packages/ directory (common in monorepos)
  const packagesDir = path.join(projectPath, 'packages');
  if (fs.existsSync(packagesDir)) {
    const stat = fs.statSync(packagesDir);
    if (stat.isDirectory()) {
      result.indicators.workspaceIndicators.push('packages/ directory');
      
      // If we haven't detected a monorepo yet but there's a packages dir, it's likely one
      if (!result.isMonorepo) {
        result.isMonorepo = true;
      }
    }
  }

  // Check for apps/ directory (common in monorepos)
  const appsDir = path.join(projectPath, 'apps');
  if (fs.existsSync(appsDir)) {
    const stat = fs.statSync(appsDir);
    if (stat.isDirectory()) {
      result.indicators.workspaceIndicators.push('apps/ directory');
      
      if (!result.isMonorepo) {
        result.isMonorepo = true;
      }
    }
  }
}

/**
 * Calculate confidence level based on available evidence
 */
function calculateConfidence(result: PackageManagerResult): void {
  if (result.lockFile) {
    result.confidence = 'high';
  } else if (result.indicators.packageManagerField) {
    result.confidence = 'medium';
  } else if (result.indicators.configFiles.length > 0) {
    // Check if only .npmrc is present (which is less reliable)
    const hasOnlyNpmrc = result.indicators.configFiles.length === 1 && 
                        result.indicators.configFiles[0] === '.npmrc' &&
                        result.packageManager === 'npm';
    
    result.confidence = hasOnlyNpmrc ? 'low' : 'medium';
  } else if (result.packageManager) {
    result.confidence = 'low';
  }

  // Boost confidence if multiple indicators point to the same package manager
  if (result.packageManager) {
    let indicatorCount = 0;
    if (result.lockFile) indicatorCount++;
    if (result.indicators.packageManagerField) indicatorCount++;
    if (result.indicators.configFiles.length > 0) indicatorCount++;

    if (indicatorCount >= 2 && result.confidence !== 'high') {
      result.confidence = 'high';
    }
  }
}