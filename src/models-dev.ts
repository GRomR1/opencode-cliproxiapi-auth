import type { CliproxyConfig, CliproxyModel } from './types.js';
import {
  MODELS_DEV_CACHE_TTL,
  MODELS_DEV_DEFAULT_URL,
  MODELS_DEV_TIMEOUT_MS,
} from './constants.js';
import { warn, debug, formatErrorForLog } from './logger.js';

export interface ModelsDevModel {
  id: string;
  name: string;
  attachment?: boolean;
  reasoning?: boolean;
  tool_call?: boolean;
  temperature?: boolean;
  modalities?: { input?: string[]; output?: string[] };
  cost?: { input?: number; output?: number };
  limit?: { context?: number; output?: number };
}

export type ModelsDevData = Record<
  string,
  { id: string; models: Record<string, ModelsDevModel> }
>;

export interface ModelsDevIndex {
  exactByProvider: Map<string, Map<string, ModelsDevModel>>;
  normalizedByProvider: Map<string, Map<string, ModelsDevModel>>;
  exactGlobal: Map<string, ModelsDevModel[]>;
  normalizedGlobal: Map<string, ModelsDevModel[]>;
}

const modelsDevCacheMap = new Map<string, { data: ModelsDevData; timestamp: number }>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function normalizeModelKey(modelId: string): string {
  return modelId
    .toLowerCase()
    .replace(/-\d{4}-\d{2}-\d{2}$/, '')
    .replace(/-v\d+$/, '')
    .replace(/-(preview|latest|stable)$/i, '')
    .replace(/-\d+\.\d+$/, '')
    .replace(/_/g, '-');
}

const DEFAULT_PROVIDER_ALIASES: Record<string, string> = {
  anthropic: 'anthropic',
  claude: 'anthropic',
  openai: 'openai',
  codex: 'openai',
  google: 'google',
  gemini: 'google',
  deepseek: 'deepseek',
  mistral: 'mistral',
  xai: 'xai',
};

export function resolveProviderAlias(
  ownedBy: string | undefined,
  config?: CliproxyConfig,
): string | null {
  if (!ownedBy) return null;
  const lower = ownedBy.toLowerCase();
  const aliases = { ...DEFAULT_PROVIDER_ALIASES, ...config?.modelsDev?.providerAliases };
  return aliases[lower] ?? lower;
}

async function fetchModelsDevOnce(
  url: string,
  timeoutMs: number,
): Promise<ModelsDevData | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      warn(`models.dev fetch failed: HTTP ${response.status}`);
      return null;
    }
    const data: unknown = await response.json();
    if (!isRecord(data)) return null;
    return data as ModelsDevData;
  } catch (error) {
    warn(`models.dev fetch error: ${formatErrorForLog(error)}`);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function fetchModelsDevData(config?: CliproxyConfig): Promise<ModelsDevData | null> {
  const url = config?.modelsDev?.url ?? MODELS_DEV_DEFAULT_URL;
  const timeoutMs = config?.modelsDev?.timeoutMs ?? MODELS_DEV_TIMEOUT_MS;
  const cacheTtl = config?.modelsDev?.cacheTtl ?? MODELS_DEV_CACHE_TTL;

  const cached = modelsDevCacheMap.get(url);
  if (cached && Date.now() - cached.timestamp < cacheTtl) {
    return cached.data;
  }

  const stale = cached?.data ?? null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const data = await fetchModelsDevOnce(url, timeoutMs);
    if (data) {
      modelsDevCacheMap.set(url, { data, timestamp: Date.now() });
      debug(`Fetched models.dev data (${Object.keys(data).length} providers)`);
      return data;
    }
    if (attempt < 3) await sleep(attempt === 1 ? 250 : 500);
  }

  if (stale) {
    warn('Using stale models.dev cache');
    return stale;
  }
  return null;
}

export function buildModelsDevIndex(data: ModelsDevData | null): ModelsDevIndex | null {
  if (!data) return null;

  const exactByProvider = new Map<string, Map<string, ModelsDevModel>>();
  const normalizedByProvider = new Map<string, Map<string, ModelsDevModel>>();
  const exactGlobal = new Map<string, ModelsDevModel[]>();
  const normalizedGlobal = new Map<string, ModelsDevModel[]>();

  for (const provider of Object.values(data)) {
    if (!provider?.models) continue;
    const providerId = provider.id.toLowerCase();
    const exactMap = new Map<string, ModelsDevModel>();
    const normMap = new Map<string, ModelsDevModel>();

    for (const [modelId, model] of Object.entries(provider.models)) {
      const lower = modelId.toLowerCase();
      exactMap.set(lower, model);
      normMap.set(normalizeModelKey(modelId), model);

      const globalExact = exactGlobal.get(lower) ?? [];
      globalExact.push(model);
      exactGlobal.set(lower, globalExact);

      const normKey = normalizeModelKey(modelId);
      const globalNorm = normalizedGlobal.get(normKey) ?? [];
      globalNorm.push(model);
      normalizedGlobal.set(normKey, globalNorm);
    }

    exactByProvider.set(providerId, exactMap);
    normalizedByProvider.set(providerId, normMap);
  }

  return { exactByProvider, normalizedByProvider, exactGlobal, normalizedGlobal };
}

export async function getModelsDevIndex(config?: CliproxyConfig): Promise<ModelsDevIndex | null> {
  if (config?.modelsDev?.enabled === false) return null;
  const data = await fetchModelsDevData(config);
  return buildModelsDevIndex(data);
}

export function clearModelsDevCache(): void {
  modelsDevCacheMap.clear();
}

function lookupModelsDevModel(
  index: ModelsDevIndex,
  providerCandidates: string[],
  modelId: string,
): ModelsDevModel | undefined {
  const candidates = [
    modelId.toLowerCase(),
    normalizeModelKey(modelId),
  ];

  for (const provider of providerCandidates) {
    for (const candidate of candidates) {
      const exact = index.exactByProvider.get(provider)?.get(candidate);
      if (exact) return exact;
      const normalized = index.normalizedByProvider.get(provider)?.get(normalizeModelKey(candidate));
      if (normalized) return normalized;
    }
  }

  for (const candidate of candidates) {
    const exactList = index.exactGlobal.get(candidate);
    if (exactList?.length === 1) return exactList[0];
    const normList = index.normalizedGlobal.get(normalizeModelKey(candidate));
    if (normList?.length === 1) return normList[0];
  }

  return undefined;
}

/** Fill missing model fields from models.dev */
export function enrichWithModelsDev(
  model: CliproxyModel,
  index: ModelsDevIndex,
  config?: CliproxyConfig,
): CliproxyModel {
  const provider = resolveProviderAlias(model.ownedBy ?? model.type, config);
  const providers = provider ? [provider] : [];
  const dev = lookupModelsDevModel(index, providers, model.id);
  if (!dev) return model;

  return {
    ...model,
    name: model.name || dev.name,
    ...(model.contextWindow === undefined && dev.limit?.context
      ? { contextWindow: dev.limit.context }
      : {}),
    ...(model.maxTokens === undefined && dev.limit?.output
      ? { maxTokens: dev.limit.output }
      : {}),
    ...(model.supportsVision === undefined && dev.modalities?.input?.includes('image')
      ? { supportsVision: true }
      : {}),
    ...(model.supportsTools === undefined && dev.tool_call === true
      ? { supportsTools: true }
      : {}),
    ...(model.supportsTemperature === undefined && dev.temperature !== undefined
      ? { supportsTemperature: dev.temperature }
      : {}),
    ...(model.supportsReasoning === undefined && dev.reasoning !== undefined
      ? { supportsReasoning: dev.reasoning }
      : {}),
    ...(model.supportsAttachment === undefined && dev.attachment !== undefined
      ? { supportsAttachment: dev.attachment }
      : {}),
    ...(model.pricing === undefined &&
    (dev.cost?.input !== undefined || dev.cost?.output !== undefined)
      ? {
          pricing: {
            ...(dev.cost.input !== undefined ? { input: dev.cost.input } : {}),
            ...(dev.cost.output !== undefined ? { output: dev.cost.output } : {}),
          },
        }
      : {}),
  };
}