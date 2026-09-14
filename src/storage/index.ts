import type { AppConfig } from '../config.js';
import { logger } from '../logger.js';
import { MemoryBackend, RedisBackend, type KvBackend } from './backend.js';
import { Repo } from './repo.js';

export { Repo } from './repo.js';
export type { KvBackend } from './backend.js';

/** Build the configured KV backend (Upstash Redis in prod, file-backed memory locally). */
export async function createBackend(config: AppConfig): Promise<KvBackend> {
  if (config.storageBackend === 'redis') {
    logger.info('Using Upstash Redis storage backend');
    return RedisBackend.create(config.upstashUrl, config.upstashToken);
  }
  logger.info('Using file-backed in-memory storage', { file: config.dataFile });
  const mem = new MemoryBackend(config.dataFile);
  await mem.init();
  return mem;
}

/** Build a Repo from config. */
export async function createRepo(config: AppConfig): Promise<Repo> {
  const backend = await createBackend(config);
  return new Repo(backend, config.defaultSlippageBps);
}
