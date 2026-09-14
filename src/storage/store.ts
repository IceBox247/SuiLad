import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  emptyDatabase,
  type DatabaseShape,
  type LaunchRecord,
  type TradeRecord,
  type UserRecord,
  type UserSettings,
} from './types.js';

/**
 * A durable, dependency-free JSON store with atomic writes and serialized
 * mutations. Suitable for a single-process bot; swap for SQLite/Postgres behind
 * the same method surface if you outgrow it.
 */
export class Store {
  private db: DatabaseShape = emptyDatabase();
  private loaded = false;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly defaults: UserSettings,
  ) {}

  async init(): Promise<void> {
    if (this.loaded) return;
    await mkdir(dirname(this.filePath), { recursive: true });
    if (existsSync(this.filePath)) {
      const raw = await readFile(this.filePath, 'utf8');
      try {
        this.db = raw.trim() ? (JSON.parse(raw) as DatabaseShape) : emptyDatabase();
      } catch (err) {
        throw new Error(`Corrupt data file at ${this.filePath}: ${(err as Error).message}`);
      }
      if (!this.db.users) this.db.users = {};
    } else {
      this.db = emptyDatabase();
      await this.flush();
    }
    this.loaded = true;
  }

  private async flush(): Promise<void> {
    // Serialize writes and write atomically via a temp file + rename.
    this.writeChain = this.writeChain.then(async () => {
      const tmp = join(dirname(this.filePath), `.${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`);
      await writeFile(tmp, JSON.stringify(this.db, null, 2), 'utf8');
      await rename(tmp, this.filePath);
    });
    return this.writeChain;
  }

  getUser(telegramId: string): UserRecord | undefined {
    return this.db.users[telegramId];
  }

  hasUser(telegramId: string): boolean {
    return Boolean(this.db.users[telegramId]);
  }

  async upsertUser(
    telegramId: string,
    data: { address: string; encryptedSecretKey: string; keyScheme: string },
  ): Promise<UserRecord> {
    const now = new Date().toISOString();
    const existing = this.db.users[telegramId];
    const record: UserRecord = existing
      ? { ...existing, ...data, updatedAt: now }
      : {
          telegramId,
          address: data.address,
          encryptedSecretKey: data.encryptedSecretKey,
          keyScheme: data.keyScheme,
          settings: { ...this.defaults },
          trades: [],
          launches: [],
          createdAt: now,
          updatedAt: now,
        };
    this.db.users[telegramId] = record;
    await this.flush();
    return record;
  }

  async updateSettings(telegramId: string, patch: Partial<UserSettings>): Promise<UserRecord> {
    const user = this.requireUser(telegramId);
    user.settings = { ...user.settings, ...patch };
    user.updatedAt = new Date().toISOString();
    await this.flush();
    return user;
  }

  async addTrade(telegramId: string, trade: TradeRecord): Promise<void> {
    const user = this.requireUser(telegramId);
    user.trades.unshift(trade);
    user.trades = user.trades.slice(0, 100);
    user.updatedAt = new Date().toISOString();
    await this.flush();
  }

  async updateTrade(telegramId: string, id: string, patch: Partial<TradeRecord>): Promise<void> {
    const user = this.requireUser(telegramId);
    const trade = user.trades.find((t) => t.id === id);
    if (trade) Object.assign(trade, patch);
    await this.flush();
  }

  async addLaunch(telegramId: string, launch: LaunchRecord): Promise<void> {
    const user = this.requireUser(telegramId);
    user.launches.unshift(launch);
    user.launches = user.launches.slice(0, 100);
    user.updatedAt = new Date().toISOString();
    await this.flush();
  }

  async updateLaunch(telegramId: string, id: string, patch: Partial<LaunchRecord>): Promise<void> {
    const user = this.requireUser(telegramId);
    const launch = user.launches.find((l) => l.id === id);
    if (launch) Object.assign(launch, patch);
    await this.flush();
  }

  /** Remove a user and their stored key material. */
  async deleteUser(telegramId: string): Promise<void> {
    delete this.db.users[telegramId];
    await this.flush();
  }

  private requireUser(telegramId: string): UserRecord {
    const user = this.db.users[telegramId];
    if (!user) throw new Error(`No wallet for user ${telegramId}`);
    return user;
  }
}
