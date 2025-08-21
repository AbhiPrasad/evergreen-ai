import * as Sentry from '@sentry/astro';

Sentry.init({
  dsn: 'https://b5509b48d044ad790e17a9479d7a3e29@o447951.ingest.us.sentry.io/4509883473461248',
  // Adds request headers and IP for users, for more info visit:
  // https://docs.sentry.io/platforms/javascript/guides/astro/configuration/options/#sendDefaultPii
  sendDefaultPii: true,
  // Enable logs to be sent to Sentry
  enableLogs: true,
  integrations: [Sentry.consoleLoggingIntegration()],
  // Define how likely traces are sampled. Adjust this value in production,
  // or use tracesSampler for greater control.
  tracesSampleRate: 1.0,
});
