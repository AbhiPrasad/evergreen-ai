import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Mock dependencies before importing the tool
vi.mock('node:fs');
vi.mock('node:child_process', () => ({
  exec: vi.fn(),
}));
vi.mock('node:util', () => ({
  promisify: vi.fn(() => vi.fn().mockResolvedValue({ stdout: '', stderr: '' })),
}));

vi.mock('./package-manager-detector-tool', () => ({
  packageManagerDetectorTool: {
    execute: vi.fn().mockResolvedValue({
      packageManager: 'npm',
      lockFile: 'package-lock.json',
      isMonorepo: false,
      workspaceType: null,
      workspacePaths: [],
      packageManagerVersion: '8.19.2',
      confidence: 'high',
      indicators: {
        lockFiles: ['package-lock.json'],
        configFiles: [],
        packageManagerField: false,
        workspaceIndicators: [],
      },
    }),
  },
}));

import { javascriptTypeScriptDependencyAnalysisTool } from './js-ts-dependency-analyzer-tool';

const mockFs = vi.mocked(fs);

describe('dependencyAnalyzerTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default fs mocks
    mockFs.existsSync = vi.fn().mockReturnValue(true);
    mockFs.readdirSync = vi.fn().mockReturnValue([]);
    mockFs.readFileSync = vi.fn().mockReturnValue('');
    mockFs.statSync = vi.fn().mockReturnValue({
      isDirectory: () => false,
      isFile: () => true,
    });
  });

  describe('Basic functionality', () => {
    it('should throw error for non-existent project path', async () => {
      mockFs.existsSync = vi.fn().mockReturnValue(false);

      await expect(
        dependencyAnalyzerTool.execute({
          context: { projectPath: '/non/existent/path' },
        }),
      ).rejects.toThrow('Project path does not exist');
    });

    it('should find and analyze files with simple patterns', async () => {
      const sourceCode = 'import React from "react";';

      mockFs.readdirSync = vi.fn().mockReturnValue([
        {
          name: 'test.tsx',
          isFile: () => true,
          isDirectory: () => false,
        },
      ]);
      mockFs.readFileSync = vi.fn().mockReturnValue(sourceCode);

      const result = await dependencyAnalyzerTool.execute({
        context: {
          includePatterns: ['**/*.tsx'], // Use simple pattern without braces
        },
      });

      expect(result.files).toHaveLength(1);
      expect(result.dependencies).toHaveLength(1);
      expect(result.dependencies[0].name).toBe('react');
      expect(result.analysisResults.totalFiles).toBe(1);
      expect(result.analysisResults.totalDependencies).toBe(1);
    });

    it('should parse import statements correctly', async () => {
      const sourceCode = `
import React from 'react';
import { useState } from 'react';
import type { Config } from './types';
const fs = require('fs');
`;

      mockFs.readdirSync = vi.fn().mockReturnValue([
        {
          name: 'test.tsx',
          isFile: () => true,
          isDirectory: () => false,
        },
      ]);
      mockFs.readFileSync = vi.fn().mockReturnValue(sourceCode);

      const result = await dependencyAnalyzerTool.execute({
        context: { includePatterns: ['**/*.tsx'] },
      });

      const file = result.files[0];
      expect(file.totalImports).toBe(4);
      expect(file.externalDependencies).toEqual(['react', 'fs']);
      expect(file.internalDependencies).toEqual(['./types']);
    });

    it('should assess dependency criticality', async () => {
      const sourceCode = `
import React from 'react';
import { Component } from 'react';
import { useState } from 'react';
`;

      const packageJson = {
        dependencies: { react: '^18.0.0' },
      };

      mockFs.readdirSync = vi.fn().mockReturnValue([
        {
          name: 'test.tsx',
          isFile: () => true,
          isDirectory: () => false,
        },
      ]);

      mockFs.readFileSync = vi.fn().mockImplementation((filePath: string) => {
        if (filePath.endsWith('package.json')) {
          return JSON.stringify(packageJson);
        }
        return sourceCode;
      });

      const result = await dependencyAnalyzerTool.execute({
        context: { includePatterns: ['**/*.tsx'] },
      });

      const reactDep = result.dependencies.find(d => d.name === 'react');
      expect(reactDep?.criticality).toBeDefined();
      expect(reactDep?.usageCount).toBe(3); // Used 3 times
      expect(reactDep?.isDirect).toBe(true);
    });
  });
});
