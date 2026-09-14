import { loadConfig } from '../src/config.js';
import { setLogLevel } from '../src/logger.js';
import { buildApp, type App } from '../src/app.js';

/**
 * Cached application instance for serverless functions. Built once per cold
 * start and reused across invocations. The bot is initialized (bot.init) so
 * handleUpdate works without the streaming webhook adapter.
 */
let appPromise: Promise<App> | null = null;

export function getApp(): Promise<App> {
  if (!appPromise) {
    appPromise = (async () => {
      const config = loadConfig();
      setLogLevel(config.logLevel);
      const app = await buildApp(config);
      await app.bot.init();
      return app;
    })();
  }
  return appPromise;
}
