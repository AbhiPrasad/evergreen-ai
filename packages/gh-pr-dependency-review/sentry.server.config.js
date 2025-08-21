import * as Sentry from '@sentry/astro';

Sentry.init({
  debug: true,
  dsn: import.meta.env.PUBLIC_SENTRY_DSN,
  // Adds request headers and IP for users, for more info visit:
  // https://docs.sentry.io/platforms/javascript/guides/astro/configuration/options/#sendDefaultPii
  // Enable logs to be sent to Sentry
  enableLogs: true,
  integrations: [Sentry.consoleLoggingIntegration()],
  // Define how likely traces are sampled. Adjust this value in production,
  // or use tracesSampler for greater control.
  tracesSampleRate: 1.0,
});
