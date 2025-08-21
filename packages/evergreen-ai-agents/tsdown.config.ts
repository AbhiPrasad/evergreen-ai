import { defineConfig } from 'tsdown';
import { baseConfig } from '../../config/tsdown.config.base.ts';

export default defineConfig({
  ...baseConfig,
  // Exclude problematic dependencies that have CommonJS/ESM issues
  external: ['xml2js', 'xmlbuilder', 'sax'],
});
