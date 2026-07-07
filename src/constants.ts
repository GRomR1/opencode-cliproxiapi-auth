import type { CliproxyModel } from './types.js';

export const CLIPROXY_PROVIDER_ID = 'cliproxy';

export const CLIPROXY_ENDPOINTS = {
  BASE_URL: 'http://localhost:8317/v1',
  MODELS: '/models',
} as const;

export const DEFAULT_MODELS_JSON_URL =
  'https://raw.githubusercontent.com/router-for-me/CLIProxyAPI/refs/heads/main/internal/registry/models/models.json';

/** Model cache TTL (5 minutes) */
export const MODEL_CACHE_TTL = 5 * 60 * 1000;

/** HTTP request timeout (30 seconds) */
export const REQUEST_TIMEOUT = 30_000;

export const DEFAULT_CONTEXT_LIMIT = 128_000;
export const DEFAULT_OUTPUT_LIMIT = 8_192;

export const MODELS_DEV_DEFAULT_URL = 'https://models.dev/api.json';
export const MODELS_DEV_CACHE_TTL = 24 * 60 * 60 * 1000;
export const MODELS_DEV_TIMEOUT_MS = 5_000;

/** Fallback models when CLIProxyAPI is unreachable */
export const CLIPROXY_DEFAULT_MODELS: CliproxyModel[] = [
  {
    id: 'claude-sonnet-4-6',
    name: 'Claude 4.6 Sonnet',
    description: 'Anthropic Claude Sonnet via CLIProxyAPI',
    contextWindow: 200_000,
    maxTokens: 64_000,
    supportsStreaming: true,
    supportsTools: true,
    supportsReasoning: true,
  },
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    description: 'Google Gemini via CLIProxyAPI',
    contextWindow: 1_048_576,
    maxTokens: 65_536,
    supportsStreaming: true,
    supportsTools: true,
    supportsReasoning: true,
  },
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI GPT-4o via CLIProxyAPI',
    contextWindow: 128_000,
    maxTokens: 16_384,
    supportsStreaming: true,
    supportsVision: true,
    supportsTools: true,
  },
];