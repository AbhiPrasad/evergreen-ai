import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { rubyPackageManagerDetectorTool, type RubyPackageManagerResult } from './ruby-package-manager-detector-tool';

const execAsync = promisify(exec);

// Schema for Ruby require/dependency usage information
const requireUsageSchema = z.object({
  type: z
    .enum([
      'require',
      'require_relative',
      'load',
      'autoload',
      'gem-declaration',
      'bundler-require',
    ])
    .describe('Type of Ruby require/dependency usage'),
  source: z.string().describe('The required module/gem name'),
  requirePath: z.string().describe('The full require path'),
  line: z.number().describe('Line number where the require occurs'),
  column: z.number().describe('Column number where the require occurs'),
  rawStatement: z.string().describe('The raw require statement'),
  conditional: z.boolean().describe('Whether this require is conditional (in if/unless/rescue)'),
  inBundlerGroup: z.string().nullable().describe('Bundler group if this is a gem declaration'),
});

const gemInfoSchema = z.object({
  name: z.string().describe('Gem name'),
  version: z.string().nullable().describe('Installed version from Gemfile.lock'),
  versionConstraint: z.string().nullable().describe('Version constraint from Gemfile'),
  isDirect: z.boolean().describe('Whether this is a direct dependency'),
  isDevDependency: z.boolean().describe('Whether this is in development group'),
  isTestDependency: z.boolean().describe('Whether this is in test group'),
  isPeerDependency: z.boolean().describe('Whether this is a peer dependency'),
  bundlerGroups: z.array(z.string()).describe('Bundler groups this gem belongs to'),
  dependencyPath: z.array(z.string()).describe('Dependency chain (for transitive deps)'),
  usageCount: z.number().describe('Number of times this gem is required'),
  usagePatterns: z.array(requireUsageSchema).describe('All usage patterns found'),
  criticality: z.enum(['HIGH', 'MEDIUM', 'LOW']).describe('Assessed criticality of the dependency'),
  criticalityReasons: z.array(z.string()).describe('Reasons for the criticality assessment'),
  source: z.enum(['gemfile', 'gemspec', 'inferred']).describe('How this dependency was detected'),
});

const fileAnalysisSchema = z.object({
  filePath: z.string().describe('Path to the analyzed file'),
  fileType: z.enum(['ruby', 'gemfile', 'gemspec', 'rakefile']).describe('Type of Ruby file'),
  totalRequires: z.number().describe('Total number of require statements'),
  requireStatements: z.array(requireUsageSchema).describe('All require statements found'),
  gemDeclarations: z.array(requireUsageSchema).describe('Gem declarations (if Gemfile)'),
  errors: z.array(z.string()).describe('Parsing errors encountered'),
});

const dependencyAnalysisSchema = z.object({
  projectPath: z.string().describe('Path to the analyzed project'),
  packageManager: z.object({
    detected: z.string().describe('Detected package manager result'),
    confidence: z.string().describe('Detection confidence level'),
  }),
  totalGems: z.number().describe('Total number of unique gems found'),
  directDependencies: z.number().describe('Number of direct dependencies'),
  transitiveDependencies: z.number().describe('Number of transitive dependencies'),
  devDependencies: z.number().describe('Number of development dependencies'),
  testDependencies: z.number().describe('Number of test dependencies'),
  gems: z.array(gemInfoSchema).describe('Detailed information about each gem'),
  filesAnalyzed: z.array(fileAnalysisSchema).describe('Analysis of individual files'),
  bundlerGroups: z.array(z.string()).describe('All Bundler groups found'),
  securityConcerns: z.array(z.string()).describe('Potential security concerns detected'),
  recommendations: z.array(z.string()).describe('Optimization and best practice recommendations'),
  summary: z.object({
    healthScore: z.number().min(0).max(100).describe('Overall dependency health score'),
    criticalIssues: z.number().describe('Number of critical issues found'),
    warnings: z.number().describe('Number of warnings'),
    suggestions: z.number().describe('Number of improvement suggestions'),
  }),
});

export type RubyDependencyAnalysis = z.infer<typeof dependencyAnalysisSchema>;
export type RubyGemInfo = z.infer<typeof gemInfoSchema>;
export type RubyRequireUsage = z.infer<typeof requireUsageSchema>;

/**
 * Tool for analyzing Ruby dependency usage patterns and gem management
 */
export const rubyDependencyAnalyzerTool = createTool({
  id: 'ruby-dependency-analyzer',
  description: 'Analyzes Ruby codebases for dependency usage patterns, gem management, and optimization opportunities',
  inputSchema: z.object({
    projectPath: z.string().describe('Path to the Ruby project directory to analyze (default: current directory)').optional(),
    includePatterns: z.array(z.string()).describe('File patterns to include in analysis').optional(),
    excludePatterns: z.array(z.string()).describe('File patterns to exclude from analysis').optional(),
    maxDepth: z.number().describe('Maximum directory depth to analyze').optional(),
  }),
  outputSchema: dependencyAnalysisSchema,
  execute: async ({ context, runtimeContext }) => {
    const { 
      projectPath = process.cwd(), 
      includePatterns = ['**/*.rb', '**/Gemfile', '**/Gemfile.lock', '**/*.gemspec', '**/Rakefile'],
      excludePatterns = ['**/node_modules/**', '**/vendor/**', '**/tmp/**', '**/.git/**'],
      maxDepth = 10 
    } = context;

    const resolvedPath = path.resolve(projectPath);

    // Validate that the path exists
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Project path does not exist: ${resolvedPath}`);
    }

    try {
      // 1. Detect package manager and basic project info
      const packageManagerResult = await rubyPackageManagerDetectorTool.execute({
        context: { projectPath: resolvedPath },
        runtimeContext,
      });

      // 2. Find all relevant files
      const files = await findRubyFiles(resolvedPath, includePatterns, excludePatterns, maxDepth);

      // 3. Analyze each file
      const filesAnalyzed: typeof fileAnalysisSchema._type[] = [];
      const allRequires: RubyRequireUsage[] = [];
      const allGemDeclarations: RubyRequireUsage[] = [];

      for (const file of files) {
        const analysis = await analyzeRubyFile(file);
        filesAnalyzed.push(analysis);
        allRequires.push(...analysis.requireStatements);
        allGemDeclarations.push(...analysis.gemDeclarations);
      }

      // 4. Parse Gemfile and Gemfile.lock for dependency information
      const gemfileInfo = await parseGemfileAndLock(resolvedPath);

      // 5. Combine usage patterns with dependency information
      const gems = analyzeGemUsage(allRequires, allGemDeclarations, gemfileInfo, packageManagerResult);

      // 6. Generate security concerns and recommendations
      const securityConcerns = identifySecurityConcerns(gems, packageManagerResult);
      const recommendations = generateRecommendations(gems, packageManagerResult, filesAnalyzed);

      // 7. Calculate summary metrics
      const summary = calculateSummaryMetrics(gems, securityConcerns, recommendations);

      return {
        projectPath: resolvedPath,
        packageManager: {
          detected: packageManagerResult.packageManager || 'none',
          confidence: packageManagerResult.confidence,
        },
        totalGems: gems.length,
        directDependencies: gems.filter(g => g.isDirect).length,
        transitiveDependencies: gems.filter(g => !g.isDirect).length,
        devDependencies: gems.filter(g => g.isDevDependency).length,
        testDependencies: gems.filter(g => g.isTestDependency).length,
        gems,
        filesAnalyzed,
        bundlerGroups: packageManagerResult.gemGroups,
        securityConcerns,
        recommendations,
        summary,
      };
    } catch (error) {
      throw new Error(`Failed to analyze Ruby dependencies: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },
});

/**
 * Find all Ruby-related files in the project
 */
async function findRubyFiles(
  projectPath: string, 
  includePatterns: string[], 
  excludePatterns: string[],
  maxDepth: number
): Promise<string[]> {
  const files: string[] = [];

  function walkDir(dir: string, currentDepth: number = 0) {
    if (currentDepth > maxDepth) return;

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(projectPath, fullPath);

        // Check exclude patterns
        if (excludePatterns.some(pattern => minimatch(relativePath, pattern))) {
          continue;
        }

        if (entry.isDirectory()) {
          walkDir(fullPath, currentDepth + 1);
        } else if (entry.isFile()) {
          // Check include patterns
          if (includePatterns.some(pattern => minimatch(relativePath, pattern))) {
            files.push(fullPath);
          }
        }
      }
    } catch (error) {
      // Ignore directories we can't read
    }
  }

  walkDir(projectPath);
  return files.sort();
}

// Simple minimatch-like function
function minimatch(str: string, pattern: string): boolean {
  const regexPattern = pattern
    .replace(/\*\*/g, '___DOUBLESTAR___')
    .replace(/\*/g, '[^/]*')
    .replace(/___DOUBLESTAR___/g, '.*')
    .replace(/\?/g, '.');
  
  return new RegExp(`^${regexPattern}$`).test(str);
}

/**
 * Analyze a single Ruby file for requires and gem declarations
 */
async function analyzeRubyFile(filePath: string): Promise<typeof fileAnalysisSchema._type> {
  const fileName = path.basename(filePath);
  let fileType: 'ruby' | 'gemfile' | 'gemspec' | 'rakefile' = 'ruby';
  
  if (fileName === 'Gemfile' || fileName.endsWith('.gemfile')) {
    fileType = 'gemfile';
  } else if (fileName.endsWith('.gemspec')) {
    fileType = 'gemspec';
  } else if (fileName === 'Rakefile' || fileName.endsWith('.rake')) {
    fileType = 'rakefile';
  }

  const requireStatements: RubyRequireUsage[] = [];
  const gemDeclarations: RubyRequireUsage[] = [];
  const errors: string[] = [];

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNumber = i + 1;

      try {
        // Parse require statements
        const requireMatch = line.match(/^(\s*)(require|require_relative|load|autoload)\s*\(?['"]([^'"]+)['"].*$/);
        if (requireMatch) {
          const [, indent, requireType, requirePath] = requireMatch;
          const conditional = isConditionalStatement(lines, i);
          
          requireStatements.push({
            type: requireType as any,
            source: extractGemNameFromPath(requirePath),
            requirePath,
            line: lineNumber,
            column: indent.length + 1,
            rawStatement: line.trim(),
            conditional,
            inBundlerGroup: null,
          });
        }

        // Parse gem declarations (in Gemfiles)
        if (fileType === 'gemfile') {
          const gemMatch = line.match(/^\s*gem\s+['"]([^'"]+)['"](.*)$/);
          if (gemMatch) {
            const [, gemName, gemOptions] = gemMatch;
            const groupMatch = gemOptions.match(/group:\s*:?([a-zA-Z_]+)/);
            const inBundlerGroup = groupMatch ? groupMatch[1] : null;

            gemDeclarations.push({
              type: 'gem-declaration',
              source: gemName,
              requirePath: gemName,
              line: lineNumber,
              column: 1,
              rawStatement: line.trim(),
              conditional: false,
              inBundlerGroup,
            });
          }

          // Parse group blocks
          const groupMatch = line.match(/^\s*group\s+([^do\n]+)\s+do/);
          if (groupMatch) {
            const groupNames = groupMatch[1].split(',').map(g => g.trim().replace(/['":]/g, ''));
            // This would require more complex parsing to associate gems with groups
            // For now, we'll rely on inline group specifications
          }
        }

        // Parse Bundler.require statements
        const bundlerRequireMatch = line.match(/Bundler\.require\s*\(?:?([^)]*)\)?/);
        if (bundlerRequireMatch) {
          requireStatements.push({
            type: 'bundler-require',
            source: 'bundler',
            requirePath: 'bundler',
            line: lineNumber,
            column: line.indexOf('Bundler'),
            rawStatement: line.trim(),
            conditional: false,
            inBundlerGroup: null,
          });
        }
      } catch (lineError) {
        errors.push(`Line ${lineNumber}: ${lineError instanceof Error ? lineError.message : 'Parse error'}`);
      }
    }
  } catch (error) {
    errors.push(`Failed to read file: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  return {
    filePath,
    fileType,
    totalRequires: requireStatements.length,
    requireStatements,
    gemDeclarations,
    errors,
  };
}

/**
 * Check if a statement is conditional (inside if/unless/rescue block)
 */
function isConditionalStatement(lines: string[], currentIndex: number): boolean {
  // Look backwards for conditional statements
  for (let i = currentIndex - 1; i >= 0; i--) {
    const line = lines[i].trim();
    
    if (line.match(/^\s*(if|unless|rescue|begin)\b/) || line.includes(' if ') || line.includes(' unless ')) {
      return true;
    }
    
    // Stop at method definitions, class definitions, or empty lines
    if (line.match(/^\s*(def|class|module|end)\b/) || line === '') {
      break;
    }
  }
  
  return false;
}

/**
 * Extract gem name from require path
 */
function extractGemNameFromPath(requirePath: string): string {
  // Handle relative requires
  if (requirePath.startsWith('./') || requirePath.startsWith('../')) {
    return 'relative';
  }
  
  // Extract the first part of the path (gem name)
  const parts = requirePath.split('/');
  return parts[0];
}

/**
 * Parse Gemfile and Gemfile.lock for dependency information
 */
async function parseGemfileAndLock(projectPath: string) {
  const gemfileInfo = {
    gems: new Map<string, any>(),
    groups: new Map<string, string[]>(),
    sources: [] as string[],
  };

  // Parse Gemfile
  const gemfilePath = path.join(projectPath, 'Gemfile');
  if (fs.existsSync(gemfilePath)) {
    try {
      const content = fs.readFileSync(gemfilePath, 'utf8');
      const lines = content.split('\n');

      for (const line of lines) {
        // Parse gem declarations
        const gemMatch = line.match(/^\s*gem\s+['"]([^'"]+)['"](?:\s*,\s*['"]([^'"]+)['"])?(.*)$/);
        if (gemMatch) {
          const [, gemName, version, options] = gemMatch;
          
          const groups = [];
          const groupMatch = options.match(/group:\s*:?([a-zA-Z_]+)/);
          if (groupMatch) {
            groups.push(groupMatch[1]);
          }

          gemfileInfo.gems.set(gemName, {
            name: gemName,
            versionConstraint: version || null,
            groups,
            source: 'gemfile',
          });
        }

        // Parse sources
        const sourceMatch = line.match(/^\s*source\s+['"]([^'"]+)['"]/);
        if (sourceMatch) {
          gemfileInfo.sources.push(sourceMatch[1]);
        }
      }
    } catch (error) {
      // Ignore parsing errors
    }
  }

  // Parse Gemfile.lock
  const lockfilePath = path.join(projectPath, 'Gemfile.lock');
  if (fs.existsSync(lockfilePath)) {
    try {
      const content = fs.readFileSync(lockfilePath, 'utf8');
      const lines = content.split('\n');
      
      let currentSection = '';
      let indentLevel = 0;
      
      for (const line of lines) {
        const trimmed = line.trim();
        const currentIndent = line.length - line.trimStart().length;
        
        if (trimmed === 'GEM' || trimmed === 'DEPENDENCIES') {
          currentSection = trimmed;
          continue;
        }
        
        if (currentSection === 'GEM' && currentIndent === 4) {
          // Parse gem with version
          const gemMatch = trimmed.match(/^([a-zA-Z0-9_-]+)\s+\(([^)]+)\)$/);
          if (gemMatch) {
            const [, gemName, version] = gemMatch;
            const existing = gemfileInfo.gems.get(gemName) || { name: gemName, groups: [], source: 'gemfile.lock' };
            gemfileInfo.gems.set(gemName, {
              ...existing,
              version,
              isDirect: currentSection === 'DEPENDENCIES',
            });
          }
        }
      }
    } catch (error) {
      // Ignore parsing errors
    }
  }

  return gemfileInfo;
}

/**
 * Analyze gem usage patterns and combine with dependency information
 */
function analyzeGemUsage(
  requires: RubyRequireUsage[],
  gemDeclarations: RubyRequireUsage[],
  gemfileInfo: any,
  packageManagerResult: RubyPackageManagerResult
): RubyGemInfo[] {
  const gemMap = new Map<string, RubyGemInfo>();

  // Process gem declarations from Gemfile
  for (const [gemName, info] of gemfileInfo.gems) {
    const usagePatterns = requires.filter(r => r.source === gemName);
    const gemUsage = gemDeclarations.filter(g => g.source === gemName);
    
    const groups = info.groups || [];
    const isDevDependency = groups.includes('development') || groups.includes('dev');
    const isTestDependency = groups.includes('test');

    const gem: RubyGemInfo = {
      name: gemName,
      version: info.version || null,
      versionConstraint: info.versionConstraint || null,
      isDirect: gemDeclarations.some(g => g.source === gemName) || info.isDirect || false,
      isDevDependency,
      isTestDependency,
      isPeerDependency: false, // Ruby doesn't have explicit peer dependencies
      bundlerGroups: groups,
      dependencyPath: [gemName], // Would need more complex analysis for full dependency tree
      usageCount: usagePatterns.length,
      usagePatterns: [...usagePatterns, ...gemUsage],
      criticality: assessGemCriticality(gemName, usagePatterns.length, groups, packageManagerResult),
      criticalityReasons: getGemCriticalityReasons(gemName, usagePatterns.length, groups, packageManagerResult),
      source: info.source,
    };

    gemMap.set(gemName, gem);
  }

  // Process gems found in require statements that aren't in Gemfile
  const usedGems = new Set(requires.map(r => r.source));
  for (const gemName of usedGems) {
    if (!gemMap.has(gemName) && gemName !== 'relative' && !isStandardLibrary(gemName)) {
      const usagePatterns = requires.filter(r => r.source === gemName);
      
      const gem: RubyGemInfo = {
        name: gemName,
        version: null,
        versionConstraint: null,
        isDirect: false,
        isDevDependency: false,
        isTestDependency: false,
        isPeerDependency: false,
        bundlerGroups: [],
        dependencyPath: [gemName],
        usageCount: usagePatterns.length,
        usagePatterns,
        criticality: assessGemCriticality(gemName, usagePatterns.length, [], packageManagerResult),
        criticalityReasons: getGemCriticalityReasons(gemName, usagePatterns.length, [], packageManagerResult),
        source: 'inferred',
      };

      gemMap.set(gemName, gem);
    }
  }

  return Array.from(gemMap.values()).sort((a, b) => b.usageCount - a.usageCount);
}

/**
 * Check if a gem is part of Ruby's standard library
 */
function isStandardLibrary(gemName: string): boolean {
  const stdLibGems = [
    'json', 'csv', 'uri', 'net', 'http', 'https', 'fileutils', 'pathname',
    'digest', 'base64', 'time', 'date', 'logger', 'benchmark', 'yaml',
    'erb', 'cgi', 'securerandom', 'ostruct', 'set', 'tempfile', 'tmpdir'
  ];
  
  return stdLibGems.includes(gemName);
}

/**
 * Assess the criticality of a gem
 */
function assessGemCriticality(
  gemName: string, 
  usageCount: number, 
  groups: string[], 
  packageManagerResult: RubyPackageManagerResult
): 'HIGH' | 'MEDIUM' | 'LOW' {
  // High criticality gems
  const highCriticalityGems = ['rails', 'activerecord', 'activesupport', 'bundler'];
  if (highCriticalityGems.some(critical => gemName.includes(critical))) {
    return 'HIGH';
  }

  // Rails project specific
  if (packageManagerResult.isRailsProject) {
    const railsCriticalGems = ['actionpack', 'actionview', 'actionmailer', 'activejob'];
    if (railsCriticalGems.some(critical => gemName.includes(critical))) {
      return 'HIGH';
    }
  }

  // High usage count
  if (usageCount >= 10) {
    return 'HIGH';
  }

  // Medium criticality
  if (usageCount >= 5 || groups.length === 0) { // Production gems
    return 'MEDIUM';
  }

  return 'LOW';
}

/**
 * Get reasons for gem criticality assessment
 */
function getGemCriticalityReasons(
  gemName: string, 
  usageCount: number, 
  groups: string[], 
  packageManagerResult: RubyPackageManagerResult
): string[] {
  const reasons: string[] = [];

  if (gemName.includes('rails')) {
    reasons.push('Core Rails framework dependency');
  }

  if (packageManagerResult.isRailsProject && gemName.includes('active')) {
    reasons.push('Core Rails Active* component');
  }

  if (usageCount >= 10) {
    reasons.push(`High usage count (${usageCount} requires)`);
  } else if (usageCount >= 5) {
    reasons.push(`Moderate usage count (${usageCount} requires)`);
  }

  if (groups.length === 0) {
    reasons.push('Production dependency (no group specified)');
  }

  if (groups.includes('development') || groups.includes('test')) {
    reasons.push('Development/test only dependency');
  }

  return reasons;
}

/**
 * Identify potential security concerns
 */
function identifySecurityConcerns(gems: RubyGemInfo[], packageManagerResult: RubyPackageManagerResult): string[] {
  const concerns: string[] = [];

  // Check for gems without version constraints
  const unconstrainedGems = gems.filter(g => g.isDirect && !g.versionConstraint);
  if (unconstrainedGems.length > 0) {
    concerns.push(`${unconstrainedGems.length} gems without version constraints (security risk)`);
  }

  // Check for gems inferred from usage but not in Gemfile
  const inferredGems = gems.filter(g => g.source === 'inferred');
  if (inferredGems.length > 0) {
    concerns.push(`${inferredGems.length} gems used in code but not declared in Gemfile`);
  }

  // Check for missing Gemfile.lock
  if (packageManagerResult.gemfilePresent && !packageManagerResult.lockfilePresent) {
    concerns.push('Gemfile.lock is missing (inconsistent dependency versions)');
  }

  // Check for development gems in production
  const prodDevGems = gems.filter(g => g.isDevDependency && g.usageCount > 0 && !g.bundlerGroups.includes('development'));
  if (prodDevGems.length > 0) {
    concerns.push('Development gems may be loaded in production');
  }

  return concerns;
}

/**
 * Generate optimization and best practice recommendations
 */
function generateRecommendations(
  gems: RubyGemInfo[], 
  packageManagerResult: RubyPackageManagerResult,
  filesAnalyzed: any[]
): string[] {
  const recommendations: string[] = [];

  // Version constraint recommendations
  const unconstrainedGems = gems.filter(g => g.isDirect && !g.versionConstraint);
  if (unconstrainedGems.length > 0) {
    recommendations.push(`Add version constraints using pessimistic operator (~>) for ${unconstrainedGems.length} gems`);
  }

  // Unused gem recommendations
  const unusedGems = gems.filter(g => g.isDirect && g.usageCount === 0);
  if (unusedGems.length > 0) {
    recommendations.push(`Consider removing ${unusedGems.length} unused gems from Gemfile`);
  }

  // Group organization recommendations
  if (packageManagerResult.gemGroups.length < 2) {
    recommendations.push('Consider organizing gems into groups (development, test, production)');
  }

  // Bundler recommendations
  if (!packageManagerResult.lockfilePresent) {
    recommendations.push('Run bundle install to generate Gemfile.lock for consistent deployments');
  }

  // Security recommendations
  recommendations.push('Run bundle audit to check for known security vulnerabilities');
  
  if (gems.some(g => !g.version)) {
    recommendations.push('Use bundle outdated to check for gem updates');
  }

  // Rails-specific recommendations
  if (packageManagerResult.isRailsProject) {
    const railsGem = gems.find(g => g.name === 'rails');
    if (railsGem && railsGem.version) {
      const majorVersion = parseInt(railsGem.version.split('.')[0]);
      if (majorVersion < 7) {
        recommendations.push('Consider upgrading to Rails 7.x for better performance and security');
      }
    }
  }

  // Performance recommendations
  const highUsageGems = gems.filter(g => g.usageCount >= 10);
  if (highUsageGems.length > 0) {
    recommendations.push('Review high-usage gems for potential optimization opportunities');
  }

  return recommendations;
}

/**
 * Calculate summary metrics for the dependency analysis
 */
function calculateSummaryMetrics(
  gems: RubyGemInfo[], 
  securityConcerns: string[], 
  recommendations: string[]
) {
  const criticalIssues = securityConcerns.filter(c => 
    c.includes('security risk') || c.includes('missing') || c.includes('production')
  ).length;
  
  const warnings = securityConcerns.length - criticalIssues;
  
  const suggestions = recommendations.filter(r => 
    r.includes('Consider') || r.includes('Review')
  ).length;

  // Calculate health score (0-100)
  let healthScore = 100;
  
  // Deduct points for critical issues
  healthScore -= criticalIssues * 20;
  
  // Deduct points for warnings
  healthScore -= warnings * 10;
  
  // Deduct points for missing version constraints
  const unconstrainedCount = gems.filter(g => g.isDirect && !g.versionConstraint).length;
  healthScore -= Math.min(unconstrainedCount * 5, 30);
  
  // Deduct points for unused gems
  const unusedCount = gems.filter(g => g.isDirect && g.usageCount === 0).length;
  healthScore -= Math.min(unusedCount * 3, 20);
  
  return {
    healthScore: Math.max(0, Math.min(100, healthScore)),
    criticalIssues,
    warnings,
    suggestions,
  };
}