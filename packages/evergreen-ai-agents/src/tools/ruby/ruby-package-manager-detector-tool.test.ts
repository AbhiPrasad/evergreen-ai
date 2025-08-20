import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rubyPackageManagerDetectorTool } from './ruby-package-manager-detector-tool';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('rubyPackageManagerDetectorTool', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ruby-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should detect Bundler with Gemfile', async () => {
    // Create a basic Gemfile
    const gemfileContent = `source 'https://rubygems.org'

gem 'rails', '~> 7.0.0'
gem 'sqlite3', '~> 1.4'`;

    fs.writeFileSync(path.join(tempDir, 'Gemfile'), gemfileContent);

    const result = await rubyPackageManagerDetectorTool.execute({
      context: { projectPath: tempDir },
      runtimeContext: {},
    });

    expect(result.packageManager).toBe('bundler');
    expect(result.gemfilePresent).toBe(true);
    expect(result.lockfilePresent).toBe(false);
    expect(result.confidence).toBe('medium');
    expect(result.gemSources).toContain('https://rubygems.org');
  });

  it('should detect Bundler with high confidence when both Gemfile and Gemfile.lock exist', async () => {
    // Create Gemfile
    const gemfileContent = `source 'https://rubygems.org'

gem 'rails', '~> 7.0.0'`;

    fs.writeFileSync(path.join(tempDir, 'Gemfile'), gemfileContent);

    // Create Gemfile.lock
    const lockfileContent = `GEM
  remote: https://rubygems.org/
  specs:
    rails (7.0.4)

PLATFORMS
  ruby

DEPENDENCIES
  rails (~> 7.0.0)

BUNDLED WITH
   2.4.10`;

    fs.writeFileSync(path.join(tempDir, 'Gemfile.lock'), lockfileContent);

    const result = await rubyPackageManagerDetectorTool.execute({
      context: { projectPath: tempDir },
      runtimeContext: {},
    });

    expect(result.packageManager).toBe('bundler');
    expect(result.gemfilePresent).toBe(true);
    expect(result.lockfilePresent).toBe(true);
    expect(result.confidence).toBe('high');
    expect(result.bundlerVersion).toBe('2.4.10');
  });

  it('should detect Ruby version from .ruby-version', async () => {
    fs.writeFileSync(path.join(tempDir, '.ruby-version'), '3.1.0');
    fs.writeFileSync(path.join(tempDir, 'Gemfile'), "gem 'test'");

    const result = await rubyPackageManagerDetectorTool.execute({
      context: { projectPath: tempDir },
      runtimeContext: {},
    });

    expect(result.rubyVersion).toBe('3.1.0');
    expect(result.rubyVersionManager).toBe('rbenv');
    expect(result.indicators.versionFiles).toContain('.ruby-version');
  });

  it('should detect Ruby version from .rvmrc', async () => {
    fs.writeFileSync(path.join(tempDir, '.rvmrc'), 'rvm use 3.0.5@myapp');
    fs.writeFileSync(path.join(tempDir, 'Gemfile'), "gem 'test'");

    const result = await rubyPackageManagerDetectorTool.execute({
      context: { projectPath: tempDir },
      runtimeContext: {},
    });

    expect(result.rubyVersion).toBe('3.0.5');
    expect(result.rubyVersionManager).toBe('rvm');
    expect(result.indicators.versionFiles).toContain('.rvmrc');
  });

  it('should detect Rails project', async () => {
    // Create basic Rails structure
    fs.mkdirSync(path.join(tempDir, 'app', 'controllers'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'config'));
    fs.mkdirSync(path.join(tempDir, 'bin'));

    fs.writeFileSync(path.join(tempDir, 'config', 'application.rb'), 'Rails.application');
    fs.writeFileSync(path.join(tempDir, 'config', 'routes.rb'), 'Rails.application.routes.draw');
    fs.writeFileSync(path.join(tempDir, 'bin', 'rails'), '#!/usr/bin/env ruby');
    fs.writeFileSync(path.join(tempDir, 'Rakefile'), 'require_relative "config/application"');

    // Create Gemfile with Rails
    const gemfileContent = `source 'https://rubygems.org'
gem 'rails', '~> 7.0.0'`;

    fs.writeFileSync(path.join(tempDir, 'Gemfile'), gemfileContent);

    const result = await rubyPackageManagerDetectorTool.execute({
      context: { projectPath: tempDir },
      runtimeContext: {},
    });

    expect(result.isRailsProject).toBe(true);
    expect(result.indicators.railsIndicators).toContain('config/application.rb');
    expect(result.indicators.railsIndicators).toContain('config/routes.rb');
    expect(result.indicators.railsIndicators).toContain('bin/rails');
    expect(result.indicators.railsIndicators).toContain('Rakefile');
    expect(result.indicators.railsIndicators).toContain('Rails gem in Gemfile');
  });

  it('should detect gem groups from Gemfile', async () => {
    const gemfileContent = `source 'https://rubygems.org'

gem 'rails', '~> 7.0.0'

group :development do
  gem 'pry'
end

group :test do
  gem 'rspec'
end

group :development, :test do
  gem 'factory_bot'
end

gem 'debug', group: :development`;

    fs.writeFileSync(path.join(tempDir, 'Gemfile'), gemfileContent);

    const result = await rubyPackageManagerDetectorTool.execute({
      context: { projectPath: tempDir },
      runtimeContext: {},
    });

    expect(result.gemGroups).toContain('development');
    expect(result.gemGroups).toContain('test');
  });

  it('should detect Ruby version from Gemfile', async () => {
    const gemfileContent = `source 'https://rubygems.org'
ruby '3.2.0'

gem 'rails', '~> 7.0.0'`;

    fs.writeFileSync(path.join(tempDir, 'Gemfile'), gemfileContent);

    const result = await rubyPackageManagerDetectorTool.execute({
      context: { projectPath: tempDir },
      runtimeContext: {},
    });

    expect(result.rubyVersion).toBe('3.2.0');
  });

  it('should detect Bundler configuration', async () => {
    fs.mkdirSync(path.join(tempDir, '.bundle'));
    fs.writeFileSync(path.join(tempDir, '.bundle', 'config'), 'BUNDLE_PATH: vendor/bundle');
    fs.writeFileSync(path.join(tempDir, 'Gemfile'), "gem 'test'");

    const result = await rubyPackageManagerDetectorTool.execute({
      context: { projectPath: tempDir },
      runtimeContext: {},
    });

    expect(result.indicators.bundlerConfig).toBe(true);
    expect(result.indicators.configFiles).toContain('.bundle/config');
  });

  it('should handle non-existent project path', async () => {
    const nonExistentPath = path.join(tempDir, 'non-existent');

    await expect(
      rubyPackageManagerDetectorTool.execute({
        context: { projectPath: nonExistentPath },
        runtimeContext: {},
      })
    ).rejects.toThrow('Project path does not exist');
  });

  it('should return low confidence when no Ruby indicators found', async () => {
    // Create a directory with no Ruby files
    fs.writeFileSync(path.join(tempDir, 'package.json'), '{}');

    const result = await rubyPackageManagerDetectorTool.execute({
      context: { projectPath: tempDir },
      runtimeContext: {},
    });

    expect(result.packageManager).toBeNull();
    expect(result.confidence).toBe('low');
    expect(result.gemfilePresent).toBe(false);
    expect(result.isRailsProject).toBe(false);
  });

  it('should detect multiple gem sources', async () => {
    const gemfileContent = `source 'https://rubygems.org'
source 'https://gems.example.com' do
  gem 'private_gem'
end

gem 'rails', '~> 7.0.0'`;

    fs.writeFileSync(path.join(tempDir, 'Gemfile'), gemfileContent);

    const result = await rubyPackageManagerDetectorTool.execute({
      context: { projectPath: tempDir },
      runtimeContext: {},
    });

    expect(result.gemSources).toContain('https://rubygems.org');
    expect(result.gemSources).toContain('https://gems.example.com');
  });

  it('should handle malformed Gemfile gracefully', async () => {
    const malformedGemfile = `source 'https://rubygems.org'
gem 'rails' # missing version
gem # malformed line`;

    fs.writeFileSync(path.join(tempDir, 'Gemfile'), malformedGemfile);

    const result = await rubyPackageManagerDetectorTool.execute({
      context: { projectPath: tempDir },
      runtimeContext: {},
    });

    // Should still detect Bundler despite parsing errors
    expect(result.packageManager).toBe('bundler');
    expect(result.gemfilePresent).toBe(true);
  });

  it('should prioritize .ruby-version over other version files', async () => {
    fs.writeFileSync(path.join(tempDir, '.ruby-version'), '3.1.0');
    fs.writeFileSync(path.join(tempDir, '.rvmrc'), 'rvm use 2.7.0');
    fs.writeFileSync(path.join(tempDir, 'Gemfile'), "gem 'test'");

    const result = await rubyPackageManagerDetectorTool.execute({
      context: { projectPath: tempDir },
      runtimeContext: {},
    });

    expect(result.rubyVersion).toBe('3.1.0');
    expect(result.rubyVersionManager).toBe('rbenv');
  });
});