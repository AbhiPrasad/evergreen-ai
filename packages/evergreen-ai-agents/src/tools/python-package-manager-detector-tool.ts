import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';

// Schema for Python package manager detection result
const pythonPackageManagerResultSchema = z.object({
  packageManager: z
    .enum(['pip', 'uv', 'poetry', 'conda', 'pipenv'])
    .nullable()
    .describe('Detected primary Python package manager'),
  secondaryManagers: z
    .array(z.enum(['pip', 'uv', 'poetry', 'conda', 'pipenv']))
    .describe('Additional package managers detected'),
  virtualEnvironment: z
    .object({
      type: z.enum(['venv', 'virtualenv', 'conda', 'poetry-venv', 'pipenv-venv', 'uv-venv', 'none']),
      path: z.string().nullable().describe('Path to virtual environment if detected'),
      pythonVersion: z.string().nullable().describe('Python version in virtual environment'),
    })
    .describe('Virtual environment information'),
  lockFiles: z.array(z.string()).describe('Lock files found'),
  configFiles: z.array(z.string()).describe('Configuration files found'),
  dependencyFiles: z.array(z.string()).describe('Dependency declaration files found'),
  pythonVersion: z.string().nullable().describe('Python version from runtime or config'),
  confidence: z.enum(['low', 'medium', 'high']).describe('Confidence level of detection'),
  indicators: z
    .object({
      lockFiles: z.array(z.string()).describe('Lock files that contributed to detection'),
      configFiles: z.array(z.string()).describe('Config files that contributed to detection'),
      dependencyFiles: z.array(z.string()).describe('Dependency files that contributed to detection'),
      virtualEnvIndicators: z.array(z.string()).describe('Virtual environment indicators found'),
      pyprojectTomlSections: z.array(z.string()).describe('pyproject.toml sections found'),
    })
    .describe('Evidence used for detection'),
});

export type PythonPackageManagerResult = z.infer<typeof pythonPackageManagerResultSchema>;

/**
 * Tool for detecting Python package managers and virtual environment configurations
 */
export const pythonPackageManagerDetectorTool = createTool({
  id: 'python-package-manager-detector',
  description:
    'Detects which Python package manager (pip, uv, poetry, conda, pipenv) is used in a codebase and identifies virtual environment configurations',
  inputSchema: z.object({
    projectPath: z
      .string()
      .describe('Path to the project directory to analyze (default: current directory)')
      .optional(),
  }),
  outputSchema: pythonPackageManagerResultSchema,
  execute: async ({ context }) => {
    const { projectPath = process.cwd() } = context;
    const resolvedPath = path.resolve(projectPath);

    // Validate that the path exists
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Project path does not exist: ${resolvedPath}`);
    }

    const result: PythonPackageManagerResult = {
      packageManager: null,
      secondaryManagers: [],
      virtualEnvironment: {
        type: 'none',
        path: null,
        pythonVersion: null,
      },
      lockFiles: [],
      configFiles: [],
      dependencyFiles: [],
      pythonVersion: null,
      confidence: 'low',
      indicators: {
        lockFiles: [],
        configFiles: [],
        dependencyFiles: [],
        virtualEnvIndicators: [],
        pyprojectTomlSections: [],
      },
    };

    try {
      // 1. Detect from lock files (highest confidence)
      detectFromLockFiles(resolvedPath, result);

      // 2. Check pyproject.toml for package manager sections
      await detectFromPyprojectToml(resolvedPath, result);

      // 3. Check for package manager config files
      detectConfigFiles(resolvedPath, result);

      // 4. Check for dependency files
      detectDependencyFiles(resolvedPath, result);

      // 5. Check for virtual environment indicators
      await detectVirtualEnvironment(resolvedPath, result);

      // 6. Detect Python version
      await detectPythonVersion(resolvedPath, result);

      // 7. Calculate final confidence
      calculateConfidence(result);

      return result;
    } catch (error) {
      throw new Error(
        `Failed to detect Python package manager: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  },
});

/**
 * Detect package manager from lock files
 */
function detectFromLockFiles(projectPath: string, result: PythonPackageManagerResult): void {
  const lockFiles = [
    { file: 'poetry.lock', manager: 'poetry' as const },
    { file: 'uv.lock', manager: 'uv' as const },
    { file: 'Pipfile.lock', manager: 'pipenv' as const },
    { file: 'conda-lock.yml', manager: 'conda' as const },
    { file: 'environment.lock.yml', manager: 'conda' as const },
  ];

  const managers: Set<string> = new Set();

  for (const { file, manager } of lockFiles) {
    const lockPath = path.join(projectPath, file);
    if (fs.existsSync(lockPath)) {
      result.lockFiles.push(file);
      result.indicators.lockFiles.push(file);
      managers.add(manager);

      // Set primary manager based on priority
      if (!result.packageManager) {
        result.packageManager = manager;
        result.confidence = 'high';
      }
    }
  }

  // Add secondary managers
  for (const manager of managers) {
    if (manager !== result.packageManager) {
      result.secondaryManagers.push(manager as any);
    }
  }
}

/**
 * Check pyproject.toml for package manager sections
 */
async function detectFromPyprojectToml(projectPath: string, result: PythonPackageManagerResult): Promise<void> {
  const pyprojectPath = path.join(projectPath, 'pyproject.toml');

  if (!fs.existsSync(pyprojectPath)) {
    return;
  }

  result.configFiles.push('pyproject.toml');
  result.indicators.configFiles.push('pyproject.toml');

  try {
    const content = fs.readFileSync(pyprojectPath, 'utf8');

    // Check for Poetry section
    if (content.includes('[tool.poetry]')) {
      result.indicators.pyprojectTomlSections.push('tool.poetry');
      if (!result.packageManager) {
        result.packageManager = 'poetry';
        result.confidence = 'high';
      } else if (result.packageManager !== 'poetry') {
        result.secondaryManagers.push('poetry');
      }
    }

    // Check for uv section
    if (content.includes('[tool.uv]')) {
      result.indicators.pyprojectTomlSections.push('tool.uv');
      if (!result.packageManager) {
        result.packageManager = 'uv';
        result.confidence = 'high';
      } else if (result.packageManager !== 'uv') {
        result.secondaryManagers.push('uv');
      }
    }

    // Check for PEP 621 dependencies (used by pip and uv)
    if (content.includes('[project]') && content.includes('dependencies')) {
      result.indicators.pyprojectTomlSections.push('project.dependencies');
      if (!result.packageManager) {
        result.packageManager = 'pip';
        result.confidence = 'medium';
      }
    }

    // Check for setuptools section
    if (content.includes('[tool.setuptools]') || content.includes('[build-system]')) {
      result.indicators.pyprojectTomlSections.push('build-system');
    }
  } catch (error) {
    // Ignore TOML parsing errors
  }
}

/**
 * Detect package manager config files
 */
function detectConfigFiles(projectPath: string, result: PythonPackageManagerResult): void {
  const configFiles = [
    { files: ['pip.conf', 'pip.ini', '.pip.conf'], manager: 'pip' as const },
    { files: ['.pipenv'], manager: 'pipenv' as const },
    { files: ['conda.yaml', 'environment.yml', 'environment.yaml'], manager: 'conda' as const },
    { files: ['poetry.toml'], manager: 'poetry' as const },
  ];

  for (const { files, manager } of configFiles) {
    for (const file of files) {
      const configPath = path.join(projectPath, file);
      if (fs.existsSync(configPath)) {
        result.configFiles.push(file);
        result.indicators.configFiles.push(file);

        // Only set package manager if not already detected with higher confidence
        if (!result.packageManager) {
          result.packageManager = manager;
          result.confidence = 'medium';
        } else if (result.packageManager !== manager) {
          result.secondaryManagers.push(manager);
        }
      }
    }
  }
}

/**
 * Detect dependency files
 */
function detectDependencyFiles(projectPath: string, result: PythonPackageManagerResult): void {
  const dependencyFiles = [
    { files: ['requirements.txt', 'requirements.in', 'dev-requirements.txt'], manager: 'pip' as const },
    { files: ['Pipfile'], manager: 'pipenv' as const },
    { files: ['setup.py', 'setup.cfg'], manager: 'pip' as const },
    { files: ['constraints.txt'], manager: 'pip' as const },
  ];

  for (const { files, manager } of dependencyFiles) {
    for (const file of files) {
      const depPath = path.join(projectPath, file);
      if (fs.existsSync(depPath)) {
        result.dependencyFiles.push(file);
        result.indicators.dependencyFiles.push(file);

        // Lower priority than lock files and config files
        if (!result.packageManager && result.confidence === 'low') {
          result.packageManager = manager;
          result.confidence = 'low';
        } else if (result.packageManager !== manager && !result.secondaryManagers.includes(manager)) {
          result.secondaryManagers.push(manager);
        }
      }
    }
  }
}

/**
 * Detect virtual environment
 */
async function detectVirtualEnvironment(projectPath: string, result: PythonPackageManagerResult): Promise<void> {
  const venvPaths = [
    { path: '.venv', type: 'venv' as const },
    { path: 'venv', type: 'venv' as const },
    { path: 'env', type: 'virtualenv' as const },
    { path: '.env', type: 'virtualenv' as const },
  ];

  // Check for local virtual environments
  for (const { path: venvPath, type } of venvPaths) {
    const fullPath = path.join(projectPath, venvPath);
    if (fs.existsSync(fullPath)) {
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        // Check if it looks like a virtual environment
        const pythonPath = path.join(fullPath, 'bin', 'python');
        const pythonExePath = path.join(fullPath, 'Scripts', 'python.exe');
        const pyvenvCfg = path.join(fullPath, 'pyvenv.cfg');

        if (fs.existsSync(pythonPath) || fs.existsSync(pythonExePath) || fs.existsSync(pyvenvCfg)) {
          result.virtualEnvironment.type = type;
          result.virtualEnvironment.path = fullPath;
          result.indicators.virtualEnvIndicators.push(`${venvPath} directory`);

          // Try to detect Python version from pyvenv.cfg
          if (fs.existsSync(pyvenvCfg)) {
            try {
              const pyvenvContent = fs.readFileSync(pyvenvCfg, 'utf8');
              const versionMatch = pyvenvContent.match(/version\s*=\s*([^\s\n]+)/);
              if (versionMatch) {
                result.virtualEnvironment.pythonVersion = versionMatch[1];
              }
            } catch (error) {
              // Ignore read errors
            }
          }
          break;
        }
      }
    }
  }

  // Check for Poetry virtual environment
  if (result.packageManager === 'poetry') {
    result.virtualEnvironment.type = 'poetry-venv';
    result.indicators.virtualEnvIndicators.push('Poetry manages virtual environment');
  }

  // Check for Pipenv virtual environment
  if (result.packageManager === 'pipenv') {
    result.virtualEnvironment.type = 'pipenv-venv';
    result.indicators.virtualEnvIndicators.push('Pipenv manages virtual environment');
  }

  // Check for uv virtual environment
  if (result.packageManager === 'uv') {
    result.virtualEnvironment.type = 'uv-venv';
    result.indicators.virtualEnvIndicators.push('uv manages virtual environment');
  }

  // Check for conda environment
  if (result.packageManager === 'conda' || result.secondaryManagers.includes('conda')) {
    result.virtualEnvironment.type = 'conda';
    result.indicators.virtualEnvIndicators.push('Conda environment detected');
  }
}

/**
 * Detect Python version
 */
async function detectPythonVersion(projectPath: string, result: PythonPackageManagerResult): Promise<void> {
  // Check .python-version file (pyenv)
  const pythonVersionPath = path.join(projectPath, '.python-version');
  if (fs.existsSync(pythonVersionPath)) {
    try {
      const version = fs.readFileSync(pythonVersionPath, 'utf8').trim();
      result.pythonVersion = version;
      result.indicators.configFiles.push('.python-version');
      return;
    } catch (error) {
      // Ignore read errors
    }
  }

  // Check runtime.txt (Heroku style)
  const runtimePath = path.join(projectPath, 'runtime.txt');
  if (fs.existsSync(runtimePath)) {
    try {
      const content = fs.readFileSync(runtimePath, 'utf8');
      const match = content.match(/python-([0-9.]+)/);
      if (match) {
        result.pythonVersion = match[1];
        result.indicators.configFiles.push('runtime.txt');
        return;
      }
    } catch (error) {
      // Ignore read errors
    }
  }

  // Use virtual environment Python version if available
  if (result.virtualEnvironment.pythonVersion) {
    result.pythonVersion = result.virtualEnvironment.pythonVersion;
  }
}

/**
 * Calculate confidence level based on available evidence
 */
function calculateConfidence(result: PythonPackageManagerResult): void {
  let confidenceScore = 0;

  // Lock files provide highest confidence
  if (result.indicators.lockFiles.length > 0) {
    confidenceScore += 3;
  }

  // pyproject.toml sections provide high confidence
  if (result.indicators.pyprojectTomlSections.length > 0) {
    confidenceScore += 2;
  }

  // Config files provide medium confidence
  if (result.indicators.configFiles.length > 0) {
    confidenceScore += 1;
  }

  // Dependency files provide low confidence
  if (result.indicators.dependencyFiles.length > 0) {
    confidenceScore += 1;
  }

  // Virtual environment indicators boost confidence
  if (result.indicators.virtualEnvIndicators.length > 0) {
    confidenceScore += 1;
  }

  // Set confidence based on score
  if (confidenceScore >= 4) {
    result.confidence = 'high';
  } else if (confidenceScore >= 2) {
    result.confidence = 'medium';
  } else {
    result.confidence = 'low';
  }

  // Ensure we have at least medium confidence if we found strong indicators
  if (result.indicators.lockFiles.length > 0 || result.indicators.pyprojectTomlSections.length > 0) {
    if (result.confidence === 'low') {
      result.confidence = 'medium';
    }
  }
}