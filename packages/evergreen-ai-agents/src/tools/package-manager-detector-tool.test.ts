import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { packageManagerDetectorTool } from './package-manager-detector-tool.js';

// Test utility to create temporary directories and files
class TestProject {
  public tempDir: string;

  constructor() {
    this.tempDir = '';
  }

  create(): void {
    this.tempDir = fs.mkdtempSync(path.join(process.cwd(), 'test-project-'));
  }

  cleanup(): void {
    if (this.tempDir && fs.existsSync(this.tempDir)) {
      fs.rmSync(this.tempDir, { recursive: true, force: true });
    }
  }

  writeFile(filePath: string, content: string): void {
    const fullPath = path.join(this.tempDir, filePath);
    const dir = path.dirname(fullPath);
    
    // Create directory if it doesn't exist
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(fullPath, content, 'utf8');
  }

  createDir(dirPath: string): void {
    const fullPath = path.join(this.tempDir, dirPath);
    fs.mkdirSync(fullPath, { recursive: true });
  }
}

describe('packageManagerDetectorTool', () => {
  let testProject: TestProject;

  beforeEach(() => {
    testProject = new TestProject();
    testProject.create();
  });

  afterEach(() => {
    testProject.cleanup();
  });

  describe('npm detection', () => {
    it('should detect npm from package-lock.json', async () => {
      testProject.writeFile('package-lock.json', '{}');
      testProject.writeFile('package.json', '{"name": "test"}');

      const result = await packageManagerDetectorTool.execute({
        context: { projectPath: testProject.tempDir }
      });

      expect(result.packageManager).toBe('npm');
      expect(result.lockFile).toBe('package-lock.json');
      expect(result.confidence).toBe('high');
      expect(result.indicators.lockFiles).toContain('package-lock.json');
    });

    it('should detect npm from packageManager field', async () => {
      testProject.writeFile('package.json', JSON.stringify({
        name: 'test',
        packageManager: 'npm@10.0.0'
      }));

      const result = await packageManagerDetectorTool.execute({
        context: { projectPath: testProject.tempDir }
      });

      expect(result.packageManager).toBe('npm');
      expect(result.packageManagerVersion).toBe('10.0.0');
      expect(result.confidence).toBe('medium');
      expect(result.indicators.packageManagerField).toBe(true);
    });

    it('should detect npm from .npmrc (low confidence)', async () => {
      testProject.writeFile('.npmrc', 'registry=https://npm.example.com');
      testProject.writeFile('package.json', '{"name": "test"}');

      const result = await packageManagerDetectorTool.execute({
        context: { projectPath: testProject.tempDir }
      });

      expect(result.packageManager).toBe('npm');
      expect(result.confidence).toBe('low');
      expect(result.indicators.configFiles).toContain('.npmrc');
    });
  });

  describe('yarn detection', () => {
    it('should detect yarn from yarn.lock', async () => {
      testProject.writeFile('yarn.lock', '# yarn lock file');
      testProject.writeFile('package.json', '{"name": "test"}');

      const result = await packageManagerDetectorTool.execute({
        context: { projectPath: testProject.tempDir }
      });

      expect(result.packageManager).toBe('yarn');
      expect(result.lockFile).toBe('yarn.lock');
      expect(result.confidence).toBe('high');
    });

    it('should detect yarn from .yarnrc config files', async () => {
      testProject.writeFile('.yarnrc.yml', 'nodeLinker: node-modules');
      testProject.writeFile('package.json', '{"name": "test"}');

      const result = await packageManagerDetectorTool.execute({
        context: { projectPath: testProject.tempDir }
      });

      expect(result.packageManager).toBe('yarn');
      expect(result.confidence).toBe('medium');
      expect(result.indicators.configFiles).toContain('.yarnrc.yml');
    });
  });

  describe('pnpm detection', () => {
    it('should detect pnpm from pnpm-lock.yaml', async () => {
      testProject.writeFile('pnpm-lock.yaml', 'lockfileVersion: 5.4');
      testProject.writeFile('package.json', '{"name": "test"}');

      const result = await packageManagerDetectorTool.execute({
        context: { projectPath: testProject.tempDir }
      });

      expect(result.packageManager).toBe('pnpm');
      expect(result.lockFile).toBe('pnpm-lock.yaml');
      expect(result.confidence).toBe('high');
    });

    it('should detect pnpm from .pnpmrc', async () => {
      testProject.writeFile('.pnpmrc', 'store-dir=~/.pnpm-store');
      testProject.writeFile('package.json', '{"name": "test"}');

      const result = await packageManagerDetectorTool.execute({
        context: { projectPath: testProject.tempDir }
      });

      expect(result.packageManager).toBe('pnpm');
      expect(result.confidence).toBe('medium');
      expect(result.indicators.configFiles).toContain('.pnpmrc');
    });
  });

  describe('workspace detection', () => {
    it('should detect npm workspaces', async () => {
      testProject.writeFile('package.json', JSON.stringify({
        name: 'monorepo',
        private: true,
        workspaces: ['packages/*', 'apps/*']
      }));
      testProject.writeFile('package-lock.json', '{}');

      const result = await packageManagerDetectorTool.execute({
        context: { projectPath: testProject.tempDir }
      });

      expect(result.isMonorepo).toBe(true);
      expect(result.workspaceType).toBe('npm-workspaces');
      expect(result.workspacePaths).toEqual(['packages/*', 'apps/*']);
      expect(result.indicators.workspaceIndicators).toContain('package.json workspaces field');
    });

    it('should detect pnpm workspace', async () => {
      testProject.writeFile('pnpm-workspace.yaml', `
packages:
  - 'packages/*'
  - 'apps/*'
`);
      testProject.writeFile('pnpm-lock.yaml', 'lockfileVersion: 5.4');

      const result = await packageManagerDetectorTool.execute({
        context: { projectPath: testProject.tempDir }
      });

      expect(result.isMonorepo).toBe(true);
      expect(result.workspaceType).toBe('pnpm-workspace');
      expect(result.workspacePaths).toEqual(['packages/*', 'apps/*']);
    });

    it('should detect lerna monorepo', async () => {
      testProject.writeFile('lerna.json', JSON.stringify({
        version: '1.0.0',
        packages: ['packages/*']
      }));
      testProject.writeFile('package.json', '{"name": "monorepo"}');

      const result = await packageManagerDetectorTool.execute({
        context: { projectPath: testProject.tempDir }
      });

      expect(result.isMonorepo).toBe(true);
      expect(result.workspaceType).toBe('lerna');
      expect(result.indicators.workspaceIndicators).toContain('lerna.json');
    });

    it('should detect nx workspace', async () => {
      testProject.writeFile('nx.json', JSON.stringify({
        extends: 'nx/presets/npm.json'
      }));
      testProject.writeFile('package.json', '{"name": "nx-workspace"}');

      const result = await packageManagerDetectorTool.execute({
        context: { projectPath: testProject.tempDir }
      });

      expect(result.isMonorepo).toBe(true);
      expect(result.workspaceType).toBe('nx');
    });

    it('should detect turbo monorepo', async () => {
      testProject.writeFile('turbo.json', JSON.stringify({
        pipeline: {
          build: {
            dependsOn: ['^build']
          }
        }
      }));
      testProject.writeFile('package.json', JSON.stringify({
        name: 'turbo-monorepo',
        workspaces: ['packages/*']
      }));

      const result = await packageManagerDetectorTool.execute({
        context: { projectPath: testProject.tempDir }
      });

      expect(result.isMonorepo).toBe(true);
      expect(result.workspaceType).toBe('npm-workspaces'); // Turbo doesn't override existing workspace type
      expect(result.indicators.workspaceIndicators).toContain('turbo.json');
    });

    it('should detect monorepo from packages directory', async () => {
      testProject.createDir('packages');
      testProject.writeFile('package.json', '{"name": "maybe-monorepo"}');

      const result = await packageManagerDetectorTool.execute({
        context: { projectPath: testProject.tempDir }
      });

      expect(result.isMonorepo).toBe(true);
      expect(result.indicators.workspaceIndicators).toContain('packages/ directory');
    });
  });

  describe('confidence calculation', () => {
    it('should have high confidence with lock file', async () => {
      testProject.writeFile('yarn.lock', '# yarn lock');
      testProject.writeFile('.yarnrc.yml', 'config');
      testProject.writeFile('package.json', JSON.stringify({
        packageManager: 'yarn@4.0.0'
      }));

      const result = await packageManagerDetectorTool.execute({
        context: { projectPath: testProject.tempDir }
      });

      expect(result.confidence).toBe('high');
    });

    it('should have medium confidence with packageManager field only', async () => {
      testProject.writeFile('package.json', JSON.stringify({
        packageManager: 'pnpm@8.0.0'
      }));

      const result = await packageManagerDetectorTool.execute({
        context: { projectPath: testProject.tempDir }
      });

      expect(result.confidence).toBe('medium');
    });

    it('should boost confidence with multiple indicators', async () => {
      testProject.writeFile('.pnpmrc', 'config');
      testProject.writeFile('package.json', JSON.stringify({
        packageManager: 'pnpm@8.0.0'
      }));

      const result = await packageManagerDetectorTool.execute({
        context: { projectPath: testProject.tempDir }
      });

      expect(result.confidence).toBe('high');
    });
  });

  describe('error handling', () => {
    it('should throw error for non-existent path', async () => {
      await expect(
        packageManagerDetectorTool.execute({
          context: { projectPath: '/non/existent/path' }
        })
      ).rejects.toThrow('Project path does not exist');
    });

    it('should handle missing package.json gracefully', async () => {
      testProject.writeFile('yarn.lock', '# yarn lock');

      const result = await packageManagerDetectorTool.execute({
        context: { projectPath: testProject.tempDir }
      });

      expect(result.packageManager).toBe('yarn');
      expect(result.indicators.packageManagerField).toBe(false);
    });

    it('should handle malformed package.json gracefully', async () => {
      testProject.writeFile('package.json', '{ invalid json');
      testProject.writeFile('npm-lock.json', '{}');

      // Should not throw an error
      const result = await packageManagerDetectorTool.execute({
        context: { projectPath: testProject.tempDir }
      });

      expect(result.indicators.packageManagerField).toBe(false);
    });
  });
});