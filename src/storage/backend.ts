import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Minimal key/value + set + counter backend. Redis (Upstash) in production;
 * an in-memory (optionally file-persisted) backend for local dev and tests.
 */
export interface KvBackend {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  del(key: string): Promise<void>;
  sadd(key: string, member: string): Promise<void>;
  srem(key: string, member: string): Promise<void>;
  smembers(key: string): Promise<string[]>;
  /** Atomic increment within a fixed window; returns the new count. */
  incrWindow(key: string, windowSeconds: number): Promise<number>;
  /** Best-effort distributed lock. Returns a release fn, or null if not acquired. */
  acquireLock(key: string, ttlMs: number): Promise<(() => Promise<void>) | null>;
}

// ---------------------------------------------------------------------------
// In-memory backend (dev/tests), with optional JSON-file persistence.
// ---------------------------------------------------------------------------

export class MemoryBackend implements KvBackend {
  private kv = new Map<string, string>();
  private sets = new Map<string, Set<string>>();
  private counters = new Map<string, { count: number; resetAt: number }>();
  private locks = new Map<string, number>(); // key -> expiry ms
  private saveChain: Promise<void> = Promise.resolve();

  constructor(private readonly filePath?: string) {}

  async init(): Promise<void> {
    if (this.filePath && existsSync(this.filePath)) {
      try {
        const raw = JSON.parse(await readFile(this.filePath, 'utf8')) as {
          kv?: Record<string, string>;
          sets?: Record<string, string[]>;
        };
        this.kv = new Map(Object.entries(raw.kv ?? {}));
        this.sets = new Map(Object.entries(raw.sets ?? {}).map(([k, v]) => [k, new Set(v)]));
      } catch {
        /* start fresh on parse errors */
      }
    }
  }

  private persist(): Promise<void> {
    if (!this.filePath) return Promise.resolve();
    const snapshot = JSON.stringify({
      kv: Object.fromEntries(this.kv),
      sets: Object.fromEntries([...this.sets].map(([k, v]) => [k, [...v]])),
    });
    this.saveChain = this.saveChain.then(async () => {
      await mkdir(dirname(this.filePath!), { recursive: true });
      const tmp = join(dirname(this.filePath!), `.${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`);
      await writeFile(tmp, snapshot, 'utf8');
      await rename(tmp, this.filePath!);
    });
    return this.saveChain;
  }

  async get(key: string): Promise<string | null> {
    return this.kv.get(key) ?? null;
  }
  async set(key: string, value: string): Promise<void> {
    this.kv.set(key, value);
    await this.persist();
  }
  async del(key: string): Promise<void> {
    this.kv.delete(key);
    await this.persist();
  }
  async sadd(key: string, member: string): Promise<void> {
    (this.sets.get(key) ?? this.sets.set(key, new Set()).get(key)!).add(member);
    await this.persist();
  }
  async srem(key: string, member: string): Promise<void> {
    this.sets.get(key)?.delete(member);
    await this.persist();
  }
  async smembers(key: string): Promise<string[]> {
    return [...(this.sets.get(key) ?? [])];
  }
  async incrWindow(key: string, windowSeconds: number): Promise<number> {
    const now = Date.now();
    const cur = this.counters.get(key);
    if (!cur || cur.resetAt <= now) {
      this.counters.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
      return 1;
    }
    cur.count += 1;
    return cur.count;
  }
  async acquireLock(key: string, ttlMs: number): Promise<(() => Promise<void>) | null> {
    const now = Date.now();
    const expiry = this.locks.get(key);
    if (expiry && expiry > now) return null;
    this.locks.set(key, now + ttlMs);
    return async () => {
      this.locks.delete(key);
    };
  }
}

// ---------------------------------------------------------------------------
// Upstash Redis backend (production / Vercel). Lazily imports @upstash/redis.
// ---------------------------------------------------------------------------

interface UpstashLike {
  get(key: string): Promise<unknown>;
  set(key: string, value: string, opts?: Record<string, unknown>): Promise<unknown>;
  del(key: string): Promise<unknown>;
  sadd(key: string, member: string): Promise<unknown>;
  srem(key: string, member: string): Promise<unknown>;
  smembers(key: string): Promise<unknown>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
  eval?(script: string, keys: string[], args: string[]): Promise<unknown>;
}

export class RedisBackend implements KvBackend {
  constructor(private readonly redis: UpstashLike) {}

  static async create(url: string, token: string): Promise<RedisBackend> {
    const mod = (await import('@upstash/redis')) as { Redis: new (o: { url: string; token: string; automaticDeserialization: boolean }) => UpstashLike };
    const redis = new mod.Redis({ url, token, automaticDeserialization: false });
    return new RedisBackend(redis);
  }

  async get(key: string): Promise<string | null> {
    const v = await this.redis.get(key);
    return v == null ? null : String(v);
  }
  async set(key: string, value: string): Promise<void> {
    await this.redis.set(key, value);
  }
  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }
  async sadd(key: string, member: string): Promise<void> {
    await this.redis.sadd(key, member);
  }
  async srem(key: string, member: string): Promise<void> {
    await this.redis.srem(key, member);
  }
  async smembers(key: string): Promise<string[]> {
    const v = await this.redis.smembers(key);
    return Array.isArray(v) ? v.map(String) : [];
  }
  async incrWindow(key: string, windowSeconds: number): Promise<number> {
    const n = await this.redis.incr(key);
    if (n === 1) await this.redis.expire(key, windowSeconds);
    return n;
  }
  async acquireLock(key: string, ttlMs: number): Promise<(() => Promise<void>) | null> {
    const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const res = await this.redis.set(`lock:${key}`, token, { nx: true, px: ttlMs });
    if (res !== 'OK' && res !== true) return null;
    return async () => {
      // Best-effort release (only if we still hold it).
      const cur = await this.redis.get(`lock:${key}`);
      if (cur != null && String(cur) === token) await this.redis.del(`lock:${key}`);
    };
  }
}
