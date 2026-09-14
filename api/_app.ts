import { loadConfig } from '../src/config.js';
import { setLogLevel } from '../src/logger.js';
import { buildApp, type App } from '../src/app.js';

/**
 * Cached application instance for serverless functions. Built once per cold
 * start and reused across invocations of the same instance.
 */
let appPromise: Promise<App> | null = null;

export function getApp(): Promise<App> {
  if (!appPromise) {
    const config = loadConfig();
    setLogLevel(config.logLevel);
    appPromise = buildApp(config);
  }
  return appPromise;
}
