import { readFile } from 'fs/promises';
import type { CliproxyModelsJson, CliproxyModel, CliproxyRegistryModel } from './types.js';
import { normalizeRegistryModel } from './normalizer.js';
import { warn, debug } from './logger.js';
import { REQUEST_TIMEOUT } from './constants.js';

const registryCache = new Map<string, { models: Map<string, CliproxyModel>; timestamp: number }>();
const REGISTRY_CACHE_TTL = 10 * 60 * 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRegistryModel(value: unknown): value is CliproxyRegistryModel {
  return isRecord(value) && typeof value.id === 'string';
}

/** Parse CLIProxyAPI models.json into a flat id → model map */
export function parseModelsJson(data: unknown): Map<string, CliproxyModel> {
  const result = new Map<string, CliproxyModel>();
  if (!isRecord(data)) return result;

  for (const entries of Object.values(data)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!isRegistryModel(entry)) continue;
      const normalized = normalizeRegistryModel(entry);
      result.set(normalized.id, normalized);
    }
  }

  return result;
}

function isUrl(path: string): boolean {
  return /^https?:\/\//i.test(path);
}

async function loadRawModelsJson(source: string): Promise<unknown> {
  if (isUrl(source)) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    try {
      const response = await fetch(source, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      return response.json();
    } finally {
      clearTimeout(timeoutId);
    }
  }

  const content = await readFile(source, 'utf-8');
  return JSON.parse(content) as CliproxyModelsJson;
}

/**
 * Load models.json from a local path or URL with in-memory caching.
 * Returns an empty map on failure (graceful degradation).
 */
export async function loadModelsJson(source?: string): Promise<Map<string, CliproxyModel>> {
  if (!source?.trim()) return new Map();

  const trimmed = source.trim();
  const cached = registryCache.get(trimmed);
  if (cached && Date.now() - cached.timestamp < REGISTRY_CACHE_TTL) {
    debug(`Using cached models.json for ${trimmed}`);
    return cached.models;
  }

  try {
    debug(`Loading models.json from ${trimmed}`);
    const raw = await loadRawModelsJson(trimmed);
    const models = parseModelsJson(raw);
    registryCache.set(trimmed, { models, timestamp: Date.now() });
    debug(`Loaded ${models.size} models from models.json`);
    return models;
  } catch (error) {
    warn(`Failed to load models.json from ${trimmed}: ${error}`);
    if (cached) {
      debug('Returning stale models.json cache');
      return cached.models;
    }
    return new Map();
  }
}

/** Clear models.json cache (all sources or one specific source) */
export function clearModelsJsonCache(source?: string): void {
  if (source) {
    registryCache.delete(source.trim());
  } else {
    registryCache.clear();
  }
}