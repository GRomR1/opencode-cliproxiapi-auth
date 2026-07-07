import { readdirSync, statSync, existsSync } from 'fs';
import { appendFile } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';

const LOG_DIR = join(
  process.env.XDG_DATA_HOME || join(process.env.HOME || homedir(), '.local', 'share'),
  'opencode',
  'log',
);

function findCurrentLogFile(): string | null {
  try {
    if (!existsSync(LOG_DIR)) return null;

    const files = readdirSync(LOG_DIR)
      .filter((f) => f.endsWith('.log'))
      .map((f) => {
        const path = join(LOG_DIR, f);
        const stat = statSync(path);
        return { path, mtime: stat.mtime.getTime(), isFile: stat.isFile() };
      })
      .filter((f) => f.isFile)
      .sort((a, b) => b.mtime - a.mtime || a.path.localeCompare(b.path));

    return files[0]?.path ?? null;
  } catch {
    return null;
  }
}

let cachedLogFile: string | null = findCurrentLogFile();

function getLogFile(): string | null {
  if (cachedLogFile === null || !existsSync(cachedLogFile)) {
    cachedLogFile = findCurrentLogFile();
  }
  return cachedLogFile;
}

function formatLogLine(level: string, message: string): string {
  const timestamp = new Date().toISOString();
  return `${level.padEnd(5)} ${timestamp} +0ms service=cliproxy ${message}\n`;
}

/** Sanitize values before logging — never log API keys or bearer tokens */
export function sanitizeForLog(value: string): string {
  return value
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/api[_-]?key["']?\s*[:=]\s*["']?[^\s"',}]+/gi, 'apiKey=[REDACTED]')
    .replace(/"key"\s*:\s*"[^"]+"/g, '"key":"[REDACTED]"')
    .replace(/\bsk-[a-zA-Z0-9_-]{8,}\b/g, 'sk-[REDACTED]');
}

/** Format unknown errors for safe logging */
export function formatErrorForLog(error: unknown): string {
  if (error instanceof Error) {
    return sanitizeForLog(error.message);
  }
  return sanitizeForLog(String(error));
}

export function warn(message: string): void {
  const logFile = getLogFile();
  if (!logFile) return;
  appendFile(logFile, formatLogLine('WARN', sanitizeForLog(message))).catch(() => {});
}

export function debug(message: string): void {
  if (process.env.CLIPROXY_DEBUG !== '1') return;
  const logFile = getLogFile();
  if (!logFile) return;
  appendFile(logFile, formatLogLine('DEBUG', sanitizeForLog(message))).catch(() => {});
}