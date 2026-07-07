/**
 * CLIProxyAPI thinking/reasoning configuration from models.json
 */
export interface CliproxyThinking {
  min?: number;
  max?: number;
  zero_allowed?: boolean;
  dynamic_allowed?: boolean;
  levels?: string[];
}

/**
 * Raw model entry from CLIProxyAPI models.json
 */
export interface CliproxyRegistryModel {
  id: string;
  object?: string;
  created?: number;
  owned_by?: string;
  type?: string;
  display_name?: string;
  name?: string;
  description?: string;
  context_length?: number;
  max_completion_tokens?: number;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
  thinking?: CliproxyThinking;
  [key: string]: unknown;
}

/**
 * CLIProxyAPI models.json root structure (provider buckets)
 */
export type CliproxyModelsJson = Record<string, CliproxyRegistryModel[]>;

/**
 * Normalized model used throughout the plugin
 */
export interface CliproxyModel {
  id: string;
  name: string;
  description?: string;
  ownedBy?: string;
  type?: string;

  contextWindow?: number;
  maxTokens?: number;

  supportsStreaming?: boolean;
  supportsVision?: boolean;
  supportsTools?: boolean;
  supportsTemperature?: boolean;
  supportsReasoning?: boolean;
  supportsAttachment?: boolean;

  thinking?: CliproxyThinking;
  variants?: Record<string, CliproxyModelVariant>;

  pricing?: {
    input?: number;
    output?: number;
  };
}

/** OpenCode config variant — only `disabled` is allowed by opencode.ai/config.json */
export interface CliproxyModelVariant {
  disabled?: boolean;
}

/**
 * OpenAI-compatible /v1/models response
 */
export interface CliproxyModelsResponse {
  object: 'list';
  data: Array<{
    id: string;
    object?: string;
    created?: number;
    owned_by?: string;
    [key: string]: unknown;
  }>;
}

export interface CliproxyModelsDevConfig {
  enabled?: boolean;
  url?: string;
  cacheTtl?: number;
  timeoutMs?: number;
  providerAliases?: Record<string, string>;
}

/**
 * Plugin configuration
 */
export interface CliproxyConfig {
  baseUrl: string;
  apiKey: string;
  defaultModels?: CliproxyModel[];
  modelCacheTtl?: number;
  refreshOnList?: boolean;
  modelsDev?: CliproxyModelsDevConfig;
  /** Local path or URL to CLIProxyAPI models.json for metadata enrichment */
  modelsJsonPath?: string;
}

/**
 * OpenCode provider model shape (opencode.ai/config.json ProviderConfig.models.*)
 */
export interface CliproxyProviderModel {
  id: string;
  name: string;
  family: string;
  release_date: string;
  attachment?: boolean;
  reasoning?: boolean;
  temperature?: boolean;
  tool_call?: boolean;
  modalities?: {
    input: readonly string[];
    output: readonly string[];
  };
  cost: {
    input: number;
    output: number;
    cache_read?: number;
    cache_write?: number;
  };
  limit: {
    context: number;
    output: number;
  };
  options?: Record<string, unknown>;
  headers?: Record<string, string>;
  status?: 'alpha' | 'beta' | 'deprecated' | 'active';
  variants?: Record<string, CliproxyModelVariant>;
}