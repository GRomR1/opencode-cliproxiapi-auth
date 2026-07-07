import type { CliproxyConfig, CliproxyModel, CliproxyModelsResponse } from './types.js';
import {
  CLIPROXY_DEFAULT_MODELS,
  CLIPROXY_ENDPOINTS,
  MODEL_CACHE_TTL,
  REQUEST_TIMEOUT,
} from './constants.js';
import { TtlCache } from './cache.js';
import { mergeModelMetadata, normalizeApiModel } from './normalizer.js';
import { loadModelsJson } from './models-json.js';
import { enrichWithModelsDev, getModelsDevIndex } from './models-dev.js';
import { warn, debug, formatErrorForLog } from './logger.js';

const modelCache = new TtlCache<CliproxyModel[]>();
const inFlightFetches = new Map<string, Promise<CliproxyModel[]>>();

function getCacheKey(config: CliproxyConfig): string {
  const modelsDevHash = config.modelsDev
    ? JSON.stringify({
        enabled: config.modelsDev.enabled,
        url: config.modelsDev.url,
        providerAliases: config.modelsDev.providerAliases,
      })
    : '';
  return `${config.baseUrl}:${config.apiKey}:${config.modelsJsonPath ?? ''}:${modelsDevHash}`;
}

function buildAuthHeaders(apiKey: string): HeadersInit {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

async function fetchApiModels(
  config: CliproxyConfig,
): Promise<CliproxyModel[]> {
  const baseUrl = config.baseUrl || CLIPROXY_ENDPOINTS.BASE_URL;
  const modelsUrl = `${baseUrl}${CLIPROXY_ENDPOINTS.MODELS}`;

  debug(`Fetching models from ${modelsUrl}`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const response = await fetch(modelsUrl, {
      method: 'GET',
      headers: buildAuthHeaders(config.apiKey),
      signal: controller.signal,
    });

    if (!response.ok) {
      warn(`Failed to fetch models: ${response.status} ${response.statusText}`);
      throw new Error(`Failed to fetch models: ${response.status}`);
    }

    const rawData: unknown = await response.json();
    if (
      !rawData ||
      typeof rawData !== 'object' ||
      !Array.isArray((rawData as CliproxyModelsResponse).data)
    ) {
      throw new Error('Invalid models response structure');
    }

    const data = rawData as CliproxyModelsResponse;
    return data.data
      .filter((m) => m && typeof m.id === 'string')
      .map(normalizeApiModel);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function enrichModels(
  models: CliproxyModel[],
  config: CliproxyConfig,
): Promise<CliproxyModel[]> {
  const registry = await loadModelsJson(config.modelsJsonPath);
  const modelsDevIndex = await getModelsDevIndex(config);

  return models.map((apiModel) => {
    const withRegistry = mergeModelMetadata(apiModel, registry.get(apiModel.id));
    return modelsDevIndex
      ? enrichWithModelsDev(withRegistry, modelsDevIndex, config)
      : withRegistry;
  });
}

/**
 * Fetch models from CLIProxyAPI /v1/models, enrich via models.json and models.dev.
 */
async function fetchModelsUncached(config: CliproxyConfig): Promise<CliproxyModel[]> {
  const cacheKey = getCacheKey(config);

  try {
    const apiModels = await fetchApiModels(config);
    const models = await enrichModels(apiModels, config);
    modelCache.set(cacheKey, models);
    debug(`Successfully fetched ${models.length} models`);
    return models;
  } catch (error) {
    warn(`Error fetching models: ${formatErrorForLog(error)}`);

    const stale = modelCache.getEntry(cacheKey);
    if (stale) {
      debug('Returning expired cached models as fallback');
      return stale.value;
    }

    debug('Returning default models as fallback');
    return config.defaultModels ?? CLIPROXY_DEFAULT_MODELS;
  }
}

export async function fetchModels(
  config: CliproxyConfig,
  forceRefresh = false,
): Promise<CliproxyModel[]> {
  const cacheKey = getCacheKey(config);
  const ttl =
    config.modelCacheTtl && config.modelCacheTtl > 0
      ? config.modelCacheTtl
      : MODEL_CACHE_TTL;

  if (!forceRefresh && modelCache.isValid(cacheKey, ttl)) {
    const cached = modelCache.get(cacheKey);
    if (cached) {
      debug('Using cached models');
      return cached;
    }
  }

  if (forceRefresh) {
    debug('Forcing model refresh');
    inFlightFetches.delete(cacheKey);
  }

  const inFlight = inFlightFetches.get(cacheKey);
  if (inFlight && !forceRefresh) {
    debug('Awaiting in-flight model fetch');
    return inFlight;
  }

  const promise = fetchModelsUncached(config).finally(() => {
    inFlightFetches.delete(cacheKey);
  });
  inFlightFetches.set(cacheKey, promise);
  return promise;
}

export function clearModelCache(config?: CliproxyConfig): void {
  if (config) {
    const cacheKey = getCacheKey(config);
    modelCache.delete(cacheKey);
    inFlightFetches.delete(cacheKey);
    debug('Model cache cleared for provided configuration');
  } else {
    modelCache.clear();
    inFlightFetches.clear();
    debug('All model caches cleared');
  }
}

export function getCachedModels(config: CliproxyConfig): CliproxyModel[] | null {
  return modelCache.get(getCacheKey(config));
}

export function isCacheValid(config: CliproxyConfig): boolean {
  const ttl = config.modelCacheTtl || MODEL_CACHE_TTL;
  return modelCache.isValid(getCacheKey(config), ttl);
}

export async function refreshModels(config: CliproxyConfig): Promise<CliproxyModel[]> {
  clearModelCache(config);
  return fetchModels(config, true);
}