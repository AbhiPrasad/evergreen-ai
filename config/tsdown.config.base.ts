import { defineConfig } from 'tsdown'

/**
 * Base tsdown configuration for all packages in the monorepo
 */
export const baseConfig = defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  unbundle: true,
  exports: true,
})

export default baseConfig