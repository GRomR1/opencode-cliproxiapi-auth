/**
 * Simple TTL cache for model lists keyed by configuration fingerprint.
 */

export interface CacheEntry<T> {
  value: T;
  timestamp: number;
}

export class TtlCache<T> {
  private readonly store = new Map<string, CacheEntry<T>>();

  get(key: string): T | null {
    return this.store.get(key)?.value ?? null;
  }

  getEntry(key: string): CacheEntry<T> | null {
    return this.store.get(key) ?? null;
  }

  set(key: string, value: T): void {
    this.store.set(key, { value, timestamp: Date.now() });
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  isValid(key: string, ttlMs: number): boolean {
    const entry = this.store.get(key);
    if (!entry) return false;
    return Date.now() - entry.timestamp < ttlMs;
  }
}