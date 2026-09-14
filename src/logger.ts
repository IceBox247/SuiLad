/**
 * Tiny leveled logger. No dependency; writes structured-ish lines to stderr/stdout.
 */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
export type LogLevel = keyof typeof LEVELS;

let currentLevel: LogLevel = 'info';

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

function emit(level: LogLevel, msg: string, meta?: unknown): void {
  if (LEVELS[level] < LEVELS[currentLevel]) return;
  const ts = new Date().toISOString();
  const base = `${ts} ${level.toUpperCase().padEnd(5)} ${msg}`;
  const line = meta === undefined ? base : `${base} ${safeJson(meta)}`;
  if (level === 'error' || level === 'warn') console.error(line);
  else console.log(line);
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export const logger = {
  debug: (msg: string, meta?: unknown) => emit('debug', msg, meta),
  info: (msg: string, meta?: unknown) => emit('info', msg, meta),
  warn: (msg: string, meta?: unknown) => emit('warn', msg, meta),
  error: (msg: string, meta?: unknown) => emit('error', msg, meta),
};
