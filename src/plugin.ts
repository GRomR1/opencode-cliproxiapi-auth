import type { Plugin, Hooks } from '@opencode-ai/plugin';
import { homedir } from 'os';
import { readFile } from 'fs/promises';
import { join } from 'path';
import type {
  CliproxyConfig,
  CliproxyModel,
  CliproxyModelVariant,
  CliproxyProviderModel,
} from './types.js';
import {
  CLIPROXY_PROVIDER_ID,
  CLIPROXY_DEFAULT_MODELS,
  CLIPROXY_ENDPOINTS,
  DEFAULT_CONTEXT_LIMIT,
  DEFAULT_MODELS_JSON_URL,
  DEFAULT_OUTPUT_LIMIT,
} from './constants.js';
import { fetchModels } from './model-fetcher.js';
import { getModelFamily } from './normalizer.js';
import { warn, debug, sanitizeForLog, formatErrorForLog } from './logger.js';
import { applyGatewayInferenceTelemetry } from './telemetry.js';

const CLIPROXY_PROVIDER_NAME = 'CLIProxyAPI';
const CLIPROXY_PROVIDER_NPM = '@ai-sdk/openai-compatible';
const CLIPROXY_PROVIDER_ENV = ['CLIPROXY_API_KEY'];

type AuthHook = NonNullable<Hooks['auth']>;
type AuthLoader = NonNullable<AuthHook['loader']>;
type AuthAccessor = Parameters<AuthLoader>[0];
type ProviderDefinition = Parameters<AuthLoader>[1];

interface ParsedAuth {
  apiKey: string;
  baseUrl?: string;
}

export const CliproxyAuthPlugin: Plugin = async (_input) => {
  return {
    config: async (config) => {
      const providers = config.provider ?? {};
      const existing = providers[CLIPROXY_PROVIDER_ID];
      const auth = await readAuthFromStore(CLIPROXY_PROVIDER_ID);
      const parsed = parseAuthKey(auth?.key);
      const baseUrl = getBaseUrl(existing?.options, parsed.baseUrl);

      let models: CliproxyModel[] = CLIPROXY_DEFAULT_MODELS;
      try {
        const apiKey = resolveApiKey(existing?.options, parsed);
        const runtimeConfig = createRuntimeConfig(
          existing?.options ?? {},
          apiKey,
          parsed.baseUrl,
        );
        models = await fetchModels(runtimeConfig, false);
      } catch (error) {
        warn(`Eager model fetch failed, using defaults: ${formatErrorForLog(error)}`);
      }

      const shouldRefresh = shouldRefreshProviderModels(existing);
      providers[CLIPROXY_PROVIDER_ID] = {
        ...existing,
        name: existing?.name ?? CLIPROXY_PROVIDER_NAME,
        npm: existing?.npm ?? CLIPROXY_PROVIDER_NPM,
        env: existing?.env ?? CLIPROXY_PROVIDER_ENV,
        options: {
          ...(existing?.options ?? {}),
          baseURL: baseUrl,
        },
        models: shouldRefresh ? toProviderModels(models, baseUrl) : existing?.models,
      };

      config.provider = providers;
    },

    provider: {
      id: CLIPROXY_PROVIDER_ID,
      models: async (provider, ctx) => {
        const parsed = parseAuthKey(ctx.auth?.type === 'api' ? ctx.auth.key : undefined);
        const apiKey = resolveApiKey(provider.options, parsed);
        const runtimeConfig = createRuntimeConfig(provider.options, apiKey, parsed.baseUrl);
        const effectiveBaseUrl = runtimeConfig.baseUrl;

        try {
          const models = await fetchModels(runtimeConfig, false);
          return toProviderModels(models, effectiveBaseUrl);
        } catch {
          return toProviderModels(CLIPROXY_DEFAULT_MODELS, effectiveBaseUrl);
        }
      },
    },

    auth: createAuthHook(),
  };
};

function createAuthHook(): AuthHook {
  return {
    provider: CLIPROXY_PROVIDER_ID,
    methods: [
      {
        type: 'api',
        label: 'CLIProxyAPI',
        prompts: [
          {
            type: 'text',
            key: 'baseURL',
            message: 'CLIProxyAPI base URL',
            placeholder: CLIPROXY_ENDPOINTS.BASE_URL,
          },
          {
            type: 'text',
            key: 'apiKey',
            message: 'API key (optional — leave empty if CLIProxyAPI has no api-keys)',
            placeholder: 'your-api-key-from-config.yaml',
          },
        ],
        authorize: async (inputs) => {
          const baseURL = getBaseUrl({ baseURL: inputs?.baseURL });
          const apiKey = inputs?.apiKey?.trim() ?? '';
          return {
            type: 'success',
            key: JSON.stringify({ baseURL, apiKey }),
            provider: CLIPROXY_PROVIDER_ID,
          };
        },
      },
    ],
    loader: loadProviderOptions,
  };
}

async function loadProviderOptions(
  getAuth: AuthAccessor,
  provider: ProviderDefinition,
): Promise<Record<string, unknown>> {
  const auth = await getAuth();
  const parsed = auth?.type === 'api' ? parseAuthKey(auth.key) : { apiKey: '' };
  const apiKey = resolveApiKey(provider.options, parsed);
  const config = createRuntimeConfig(provider.options, apiKey, parsed.baseUrl);

  let models: CliproxyModel[] = [];
  try {
    const forceRefresh = config.refreshOnList !== false;
    models = await fetchModels(config, forceRefresh);
    debug(`Available models: ${models.map((m) => sanitizeForLog(m.id)).join(', ')}`);
  } catch (error) {
    warn(`Failed to fetch models, using defaults: ${formatErrorForLog(error)}`);
    models = CLIPROXY_DEFAULT_MODELS;
  }

  replaceProviderModels(provider, toProviderModels(models, config.baseUrl));

  return {
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
    fetch: createFetchInterceptor(config),
  };
}

function createRuntimeConfig(
  options: Record<string, unknown> | undefined,
  apiKey: string,
  authBaseUrl?: string,
): CliproxyConfig {
  const baseUrl = getBaseUrl(options, authBaseUrl);
  return {
    baseUrl,
    apiKey,
    modelCacheTtl: getPositiveNumber(options, 'modelCacheTtl'),
    refreshOnList: getBoolean(options, 'refreshOnList'),
    modelsDev: getModelsDevConfig(options),
    modelsJsonPath: resolveModelsJsonPath(options),
  };
}

function resolveModelsJsonPath(
  options: Record<string, unknown> | undefined,
): string | undefined {
  if (!options || !('modelsJsonPath' in options)) {
    return DEFAULT_MODELS_JSON_URL;
  }
  return getStringOption(options, 'modelsJsonPath');
}

function resolveApiKey(
  options: Record<string, unknown> | undefined,
  parsed: ParsedAuth,
): string {
  const fromOptions = getStringOption(options, 'apiKey');
  if (fromOptions !== undefined) return fromOptions;
  if (parsed.apiKey) return parsed.apiKey;
  const fromEnv = process.env.CLIPROXY_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  return '';
}

/** Parse auth key — supports JSON from /connect or plain API key string */
export function parseAuthKey(key?: string): ParsedAuth {
  if (!key) return { apiKey: '' };
  try {
    const parsed: unknown = JSON.parse(key);
    if (
      parsed &&
      typeof parsed === 'object' &&
      'apiKey' in parsed &&
      typeof (parsed as ParsedAuth).apiKey === 'string'
    ) {
      const record = parsed as Record<string, unknown>;
      const baseUrl =
        typeof record.baseUrl === 'string'
          ? record.baseUrl
          : typeof record.baseURL === 'string'
            ? record.baseURL
            : undefined;
      return {
        apiKey: String(record.apiKey),
        baseUrl,
      };
    }
  } catch {
    // Plain API key string
  }
  return { apiKey: key };
}

async function readAuthFromStore(
  providerId: string,
): Promise<{ key?: string; type?: string } | null> {
  try {
    const dataHome =
      process.env.XDG_DATA_HOME ||
      join(process.env.HOME || homedir(), '.local', 'share');
    const authPath = join(dataHome, 'opencode', 'auth.json');
    const content = await readFile(authPath, 'utf-8');
    const data: unknown = JSON.parse(content);
    if (!isRecord(data)) return null;
    const auth = data[providerId];
    if (!isRecord(auth)) return null;
    return auth as { key?: string; type?: string };
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    warn(`Unexpected error reading auth store: ${formatErrorForLog(error)}`);
    return null;
  }
}

export function getBaseUrl(
  options?: Record<string, unknown>,
  authBaseUrl?: string,
): string {
  const candidates: string[] = [];
  const fromOptions = options?.baseURL ?? options?.baseUrl;
  if (typeof fromOptions === 'string' && fromOptions.trim()) {
    candidates.push(fromOptions.trim());
  }
  if (typeof authBaseUrl === 'string' && authBaseUrl.trim()) {
    candidates.push(authBaseUrl.trim());
  }

  for (const trimmed of candidates) {
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        warn(`Ignoring unsupported baseURL protocol: ${sanitizeForLog(parsed.protocol)}`);
        continue;
      }
      return trimmed.replace(/\/+$/, '');
    } catch {
      warn(`Ignoring invalid baseURL: ${sanitizeForLog(trimmed)}`);
    }
  }

  return CLIPROXY_ENDPOINTS.BASE_URL;
}

function getPositiveNumber(
  options: Record<string, unknown> | undefined,
  key: string,
): number | undefined {
  const value = options?.[key];
  return typeof value === 'number' && value > 0 ? value : undefined;
}

function getBoolean(
  options: Record<string, unknown> | undefined,
  key: string,
): boolean | undefined {
  const value = options?.[key];
  return typeof value === 'boolean' ? value : undefined;
}

function getStringOption(
  options: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = options?.[key];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function getModelsDevConfig(
  options: Record<string, unknown> | undefined,
): CliproxyConfig['modelsDev'] {
  const raw = options?.modelsDev;
  if (!isRecord(raw)) return undefined;

  const enabled = typeof raw.enabled === 'boolean' ? raw.enabled : undefined;
  const url = getStringOption(raw, 'url');
  const cacheTtl = getPositiveNumber(raw, 'cacheTtl');
  const timeoutMs = getPositiveNumber(raw, 'timeoutMs');
  const providerAliases = getStringRecord(raw.providerAliases);

  if (
    enabled === undefined &&
    url === undefined &&
    cacheTtl === undefined &&
    timeoutMs === undefined &&
    providerAliases === undefined
  ) {
    return undefined;
  }

  return {
    ...(enabled !== undefined ? { enabled } : {}),
    ...(url !== undefined ? { url } : {}),
    ...(cacheTtl !== undefined ? { cacheTtl } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(providerAliases !== undefined ? { providerAliases } : {}),
  };
}

function getStringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (trimmed) out[key] = trimmed;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function hasProviderModels(provider: ProviderDefinition | undefined): boolean {
  return Boolean(provider?.models && Object.keys(provider.models).length > 0);
}

function shouldRefreshProviderModels(provider: ProviderDefinition | undefined): boolean {
  if (!hasProviderModels(provider)) return true;
  return hasGeneratedProviderModels(provider?.models);
}

function hasGeneratedProviderModels(models: Record<string, unknown> | undefined): boolean {
  if (!isRecord(models)) return false;
  const values = Object.values(models);
  if (values.length === 0) return false;
  return values.every(isGeneratedCliproxyProviderModel);
}

function isGeneratedCliproxyProviderModel(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.providerID !== undefined || value.api !== undefined || value.capabilities !== undefined) {
    return false;
  }
  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    isRecord(value.cost) &&
    typeof value.cost.input === 'number' &&
    isRecord(value.limit)
  );
}

function replaceProviderModels(
  provider: ProviderDefinition,
  models: Record<string, CliproxyProviderModel>,
): void {
  if (isRecord(provider.models)) {
    for (const key of Object.keys(provider.models)) {
      delete provider.models[key];
    }
    Object.assign(provider.models, models);
    return;
  }
  provider.models = models;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function toProviderModels(
  models: CliproxyModel[],
  baseUrl: string,
): Record<string, CliproxyProviderModel> {
  return Object.fromEntries(models.map((model) => [model.id, toProviderModel(model, baseUrl)]));
}

export function toProviderModel(
  model: CliproxyModel,
  _baseUrl: string,
): CliproxyProviderModel {
  const supportsVision = model.supportsVision === true;
  const supportsTools = model.supportsTools !== false;
  const supportsTemperature = model.supportsTemperature !== false;
  const supportsReasoning = model.supportsReasoning === true;
  const supportsAttachment =
    model.supportsAttachment !== undefined ? model.supportsAttachment : supportsVision;

  const defaultReasoningVariants: Record<string, CliproxyModelVariant> =
    supportsReasoning && !model.variants
      ? { low: {}, medium: {}, high: {} }
      : {};

  const variants =
    model.variants && Object.keys(model.variants).length > 0
      ? model.variants
      : defaultReasoningVariants;

  const providerModel: CliproxyProviderModel = {
    id: model.id,
    name: model.name || model.id,
    family: getModelFamily(model.id),
    release_date: '',
    attachment: supportsAttachment,
    reasoning: supportsReasoning,
    temperature: supportsTemperature,
    tool_call: supportsTools,
    modalities: {
      input: supportsVision ? ['text', 'image'] : ['text'],
      output: ['text'],
    },
    cost: {
      input: model.pricing?.input ?? 0,
      output: model.pricing?.output ?? 0,
    },
    limit: {
      context: model.contextWindow ?? DEFAULT_CONTEXT_LIMIT,
      output: model.maxTokens ?? DEFAULT_OUTPUT_LIMIT,
    },
    status: 'active',
  };

  if (model.thinking) {
    providerModel.options = { thinking: model.thinking };
  }

  if (Object.keys(variants).length > 0) {
    providerModel.variants = variants;
  }

  return providerModel;
}

function createFetchInterceptor(
  config: CliproxyConfig,
): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  const baseUrl = config.baseUrl || CLIPROXY_ENDPOINTS.BASE_URL;
  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;

  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : input.toString();
    const isCliproxyRequest = url === baseUrl || url.startsWith(normalizedBaseUrl);

    if (!isCliproxyRequest) {
      return fetch(input, init);
    }

    debug(`Intercepting request to ${sanitizeForLog(url)}`);

    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    }

    if (config.apiKey) {
      headers.set('Authorization', `Bearer ${config.apiKey}`);
    }

    const method = (
      init?.method ?? (input instanceof Request ? input.method : 'GET')
    ).toUpperCase();
    const hasBody =
      init?.body !== undefined ||
      (input instanceof Request && init?.body === undefined && input.body !== null);
    if (hasBody && !headers.has('Content-Type') && ['POST', 'PUT', 'PATCH'].includes(method)) {
      headers.set('Content-Type', 'application/json');
    }

    return applyGatewayInferenceTelemetry(await fetch(input, { ...init, headers }));
  };
}