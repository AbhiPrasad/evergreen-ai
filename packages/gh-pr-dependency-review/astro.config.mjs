import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import node from '@astrojs/node';
import sentry from '@sentry/astro';

export default defineConfig({
  integrations: [
    react(),
    sentry({
      sourceMapsUploadOptions: {
        project: 'abhi-evergreen-ai',
        authToken: process.env.SENTRY_AUTH_TOKEN,
      },
    }),
  ],
  output: 'server',
  adapter: node({
    mode: 'standalone',
  }),
  server: {
    port: 4321,
    host: true,
  },
});
