import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';

// Schema for Ruby package manager detection result
const rubyPackageManagerResultSchema = z.object({
  packageManager: z.enum(['bundler']).nullable().describe('Detected package manager (primarily Bundler)'),
  gemfilePresent: z.boolean().describe('Whether Gemfile is present'),
  lockfilePresent: z.boolean().describe('Whether Gemfile.lock is present'),
  rubyVersion: z.string().nullable().describe('Ruby version specified in project'),
  rubyVersionManager: z.enum(['rbenv', 'rvm', 'asdf', 'none']).describe('Ruby version manager detected'),
  bundlerVersion: z.string().nullable().describe('Bundler version from Gemfile.lock'),
  isRailsProject: z.boolean().describe('Whether this appears to be a Rails project'),
  gemGroups: z.array(z.string()).describe('Gem groups found in Gemfile'),
  gemSources: z.array(z.string()).describe('Gem sources configured'),
  confidence: z.enum(['low', 'medium', 'high']).describe('Confidence level of detection'),
  indicators: z.object({
    configFiles: z.array(z.string()).describe('Ruby/Bundler config files found'),
    versionFiles: z.array(z.string()).describe('Ruby version files found'),
    railsIndicators: z.array(z.string()).describe('Rails-specific files found'),
    bundlerConfig: z.boolean().describe('Whether .bundle/config exists'),
  }).describe('Evidence used for detection'),
});

export type RubyPackageManagerResult = z.infer<typeof rubyPackageManagerResultSchema>;

/**
 * Tool for detecting Ruby package managers and project configurations
 */
export const rubyPackageManagerDetectorTool = createTool({
  id: 'ruby-package-manager-detector',
  description: 'Detects Ruby package manager (Bundler), Ruby version managers, and project configurations like Rails',
  inputSchema: z.object({
    projectPath: z.string().describe('Path to the project directory to analyze (default: current directory)').optional(),
  }),
  outputSchema: rubyPackageManagerResultSchema,
  execute: async ({ context }) => {
    const { projectPath = process.cwd() } = context;
    const resolvedPath = path.resolve(projectPath);

    // Validate that the path exists
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Project path does not exist: ${resolvedPath}`);
    }

    const result: RubyPackageManagerResult = {
      packageManager: null,
      gemfilePresent: false,
      lockfilePresent: false,
      rubyVersion: null,
      rubyVersionManager: 'none',
      bundlerVersion: null,
      isRailsProject: false,
      gemGroups: [],
      gemSources: [],
      confidence: 'low',
      indicators: {
        configFiles: [],
        versionFiles: [],
        railsIndicators: [],
        bundlerConfig: false,
      },
    };

    try {
      // 1. Check for Gemfile and Gemfile.lock
      detectGemfiles(resolvedPath, result);

      // 2. Detect Ruby version and version manager
      detectRubyVersion(resolvedPath, result);

      // 3. Parse Gemfile for additional information
      await parseGemfile(resolvedPath, result);

      // 4. Parse Gemfile.lock for Bundler version
      parseLockfile(resolvedPath, result);

      // 5. Check for Rails indicators
      detectRailsProject(resolvedPath, result);

      // 6. Check for Bundler configuration
      detectBundlerConfig(resolvedPath, result);

      // 7. Calculate confidence level
      calculateConfidence(result);

      return result;
    } catch (error) {
      throw new Error(`Failed to detect Ruby package manager: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },
});

/**
 * Detect Gemfile and Gemfile.lock presence
 */
function detectGemfiles(projectPath: string, result: RubyPackageManagerResult): void {
  const gemfilePath = path.join(projectPath, 'Gemfile');
  const lockfilePath = path.join(projectPath, 'Gemfile.lock');

  if (fs.existsSync(gemfilePath)) {
    result.gemfilePresent = true;
    result.packageManager = 'bundler';
    result.indicators.configFiles.push('Gemfile');
  }

  if (fs.existsSync(lockfilePath)) {
    result.lockfilePresent = true;
    result.indicators.configFiles.push('Gemfile.lock');
  }
}

/**
 * Detect Ruby version and version manager
 */
function detectRubyVersion(projectPath: string, result: RubyPackageManagerResult): void {
  const versionFiles = [
    { file: '.ruby-version', manager: 'rbenv' as const },
    { file: '.rvmrc', manager: 'rvm' as const },
    { file: '.tool-versions', manager: 'asdf' as const },
  ];

  for (const { file, manager } of versionFiles) {
    const filePath = path.join(projectPath, file);
    if (fs.existsSync(filePath)) {
      result.indicators.versionFiles.push(file);
      result.rubyVersionManager = manager;

      try {
        const content = fs.readFileSync(filePath, 'utf8').trim();
        
        if (file === '.ruby-version') {
          result.rubyVersion = content;
        } else if (file === '.rvmrc') {
          const match = content.match(/rvm use (\d+\.\d+\.\d+)/);
          if (match) {
            result.rubyVersion = match[1];
          }
        } else if (file === '.tool-versions') {
          const rubyMatch = content.match(/ruby\s+(\d+\.\d+\.\d+)/);
          if (rubyMatch) {
            result.rubyVersion = rubyMatch[1];
          }
        }
      } catch (error) {
        // Ignore parsing errors
      }
      break; // Use the first version file found
    }
  }
}

/**
 * Parse Gemfile for sources, groups, and other configuration
 */
async function parseGemfile(projectPath: string, result: RubyPackageManagerResult): Promise<void> {
  const gemfilePath = path.join(projectPath, 'Gemfile');

  if (!result.gemfilePresent) {
    return;
  }

  try {
    const gemfileContent = fs.readFileSync(gemfilePath, 'utf8');
    
    // Extract sources
    const sourceMatches = gemfileContent.match(/^source\s+['"]([^'"]+)['"]/gm);
    if (sourceMatches) {
      result.gemSources = sourceMatches.map(match => {
        const sourceMatch = match.match(/source\s+['"]([^'"]+)['"]/);
        return sourceMatch ? sourceMatch[1] : '';
      }).filter(Boolean);
    }

    // Extract Ruby version from Gemfile
    const rubyVersionMatch = gemfileContent.match(/^ruby\s+['"]([^'"]+)['"]/m);
    if (rubyVersionMatch && !result.rubyVersion) {
      result.rubyVersion = rubyVersionMatch[1];
    }

    // Extract gem groups
    const groupMatches = gemfileContent.match(/^group\s+([^do\n]+)\s+do/gm);
    if (groupMatches) {
      const groups = groupMatches.map(match => {
        const groupMatch = match.match(/group\s+([^do\n]+)\s+do/);
        if (groupMatch) {
          return groupMatch[1].split(',').map(g => g.trim().replace(/['":]/g, ''));
        }
        return [];
      }).flat();
      result.gemGroups = [...new Set(groups)];
    }

    // Also check for inline group specifications
    const inlineGroupMatches = gemfileContent.match(/gem\s+['"][^'"]+['"],.*?group:\s*:?([a-zA-Z_]+)/g);
    if (inlineGroupMatches) {
      const inlineGroups = inlineGroupMatches.map(match => {
        const groupMatch = match.match(/group:\s*:?([a-zA-Z_]+)/);
        return groupMatch ? groupMatch[1] : '';
      }).filter(Boolean);
      result.gemGroups = [...new Set([...result.gemGroups, ...inlineGroups])];
    }

    // Default sources if none specified
    if (result.gemSources.length === 0) {
      result.gemSources = ['https://rubygems.org'];
    }
  } catch (error) {
    // Ignore parsing errors
  }
}

/**
 * Parse Gemfile.lock for Bundler version
 */
function parseLockfile(projectPath: string, result: RubyPackageManagerResult): void {
  const lockfilePath = path.join(projectPath, 'Gemfile.lock');

  if (!result.lockfilePresent) {
    return;
  }

  try {
    const lockfileContent = fs.readFileSync(lockfilePath, 'utf8');
    
    // Extract Bundler version from BUNDLED WITH section
    const bundlerMatch = lockfileContent.match(/BUNDLED WITH\s+(\d+\.\d+\.\d+)/);
    if (bundlerMatch) {
      result.bundlerVersion = bundlerMatch[1];
    }
  } catch (error) {
    // Ignore parsing errors
  }
}

/**
 * Detect Rails project indicators
 */
function detectRailsProject(projectPath: string, result: RubyPackageManagerResult): void {
  const railsIndicators = [
    'config/application.rb',
    'config/environment.rb',
    'config/routes.rb',
    'app/controllers/application_controller.rb',
    'bin/rails',
    'Rakefile',
  ];

  for (const indicator of railsIndicators) {
    const filePath = path.join(projectPath, indicator);
    if (fs.existsSync(filePath)) {
      result.indicators.railsIndicators.push(indicator);
      result.isRailsProject = true;
    }
  }

  // Also check for Rails gem in Gemfile
  if (result.gemfilePresent) {
    try {
      const gemfileContent = fs.readFileSync(path.join(projectPath, 'Gemfile'), 'utf8');
      if (gemfileContent.match(/gem\s+['"]rails['"]/)) {
        result.indicators.railsIndicators.push('Rails gem in Gemfile');
        result.isRailsProject = true;
      }
    } catch (error) {
      // Ignore errors
    }
  }
}

/**
 * Detect Bundler configuration
 */
function detectBundlerConfig(projectPath: string, result: RubyPackageManagerResult): void {
  const bundlerConfigPath = path.join(projectPath, '.bundle', 'config');
  
  if (fs.existsSync(bundlerConfigPath)) {
    result.indicators.bundlerConfig = true;
    result.indicators.configFiles.push('.bundle/config');
  }

  // Check for other Bundler-related files
  const bundlerFiles = ['.bundle', 'vendor/bundle', '.bundlercache'];
  for (const file of bundlerFiles) {
    const filePath = path.join(projectPath, file);
    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        result.indicators.configFiles.push(`${file}/ directory`);
      }
    }
  }
}

/**
 * Calculate confidence level based on available evidence
 */
function calculateConfidence(result: RubyPackageManagerResult): void {
  if (result.gemfilePresent && result.lockfilePresent) {
    result.confidence = 'high';
  } else if (result.gemfilePresent) {
    result.confidence = 'medium';
  } else if (result.indicators.versionFiles.length > 0 || result.indicators.railsIndicators.length > 0) {
    result.confidence = 'medium';
  } else {
    result.confidence = 'low';
  }

  // Boost confidence if multiple indicators are present
  const totalIndicators = 
    result.indicators.configFiles.length + 
    result.indicators.versionFiles.length + 
    result.indicators.railsIndicators.length +
    (result.indicators.bundlerConfig ? 1 : 0);

  if (totalIndicators >= 4 && result.confidence !== 'high') {
    result.confidence = 'high';
  } else if (totalIndicators >= 2 && result.confidence === 'low') {
    result.confidence = 'medium';
  }
}