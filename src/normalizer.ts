import type {
  CliproxyModel,
  CliproxyModelVariant,
  CliproxyRegistryModel,
  CliproxyThinking,
} from './types.js';

const REASONING_LEVEL_PATTERN = /^[a-z][a-z0-9_-]*$/;

/** Map CLIProxyAPI thinking config to OpenCode reasoning variants */
export function thinkingToVariants(
  thinking?: CliproxyThinking,
): Record<string, CliproxyModelVariant> | undefined {
  if (!thinking) return undefined;

  const levels = thinking.levels?.length
    ? thinking.levels
    : thinking.zero_allowed || thinking.dynamic_allowed || thinking.min !== undefined
      ? ['low', 'medium', 'high']
      : undefined;

  if (!levels?.length) return undefined;

  const variants: Record<string, CliproxyModelVariant> = {};
  for (const level of levels) {
    const key = level.toLowerCase().trim();
    if (REASONING_LEVEL_PATTERN.test(key)) {
      variants[key] = { reasoningEffort: key };
    }
  }

  return Object.keys(variants).length > 0 ? variants : undefined;
}

/** Normalize a minimal OpenAI or rich Codex-compatible /v1/models entry. */
export function normalizeApiModel(model: Record<string, unknown>): CliproxyModel {
  const id = getString(model.id) ?? getString(model.slug) ?? '';
  const inputModalities = getStringArray(model.input_modalities);
  const levels = getReasoningLevels(model.supported_reasoning_levels);
  const directThinking = isRecord(model.thinking) ? normalizeThinking(model.thinking) : undefined;
  const thinking = directThinking ?? (levels.length > 0 ? { levels } : undefined);
  const variants = thinkingToVariants(thinking);
  const supportsTools = getBoolean(model.supports_tool_calls) ??
    getBoolean(model.supports_parallel_tool_calls);
  const serverAuthoritative = [
    model.display_name,
    model.max_context_window,
    model.input_modalities,
    model.supported_reasoning_levels,
  ].some((value) => value !== undefined);

  return {
    id,
    name: getString(model.display_name) ?? getString(model.name) ?? id,
    ownedBy: getString(model.owned_by),
    description: getString(model.description) ?? `CLIProxyAPI model: ${id}`,
    contextWindow: getNumber(model.max_context_window) ??
      getNumber(model.context_window) ??
      getNumber(model.context_length) ??
      getNumber(model.inputTokenLimit),
    maxTokens: getNumber(model.max_completion_tokens) ?? getNumber(model.outputTokenLimit),
    supportsStreaming: getBoolean(model.supports_streaming) ?? true,
    supportsVision: inputModalities.length > 0
      ? inputModalities.includes('image')
      : getBoolean(model.supports_vision),
    supportsTools,
    supportsTemperature: getBoolean(model.supports_temperature),
    supportsReasoning: thinking ? true : getBoolean(model.supports_reasoning),
    supportsAttachment: inputModalities.length > 0
      ? inputModalities.includes('image')
      : getBoolean(model.supports_attachment),
    thinking,
    variants,
    serverAuthoritative,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function getNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function getBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function getStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(getString).filter((entry): entry is string => entry !== undefined);
}

function getReasoningLevels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => getString(entry) ?? (isRecord(entry) ? getString(entry.effort) : undefined))
    .filter((entry): entry is string => entry !== undefined);
}

function normalizeThinking(value: Record<string, unknown>): CliproxyThinking | undefined {
  const thinking: CliproxyThinking = {
    min: getNumber(value.min),
    max: getNumber(value.max),
    zero_allowed: getBoolean(value.zero_allowed),
    dynamic_allowed: getBoolean(value.dynamic_allowed),
    levels: getStringArray(value.levels),
  };
  return Object.values(thinking).some((entry) => entry !== undefined) ? thinking : undefined;
}

/** Normalize a models.json registry entry with rich metadata */
export function normalizeRegistryModel(model: CliproxyRegistryModel): CliproxyModel {
  const contextWindow =
    model.context_length ??
    (typeof model.inputTokenLimit === 'number' ? model.inputTokenLimit : undefined);

  const maxTokens =
    model.max_completion_tokens ??
    (typeof model.outputTokenLimit === 'number' ? model.outputTokenLimit : undefined);

  const supportsReasoning = Boolean(model.thinking);
  const variants = thinkingToVariants(model.thinking);

  return {
    id: model.id,
    name: model.display_name || model.name || model.id,
    description: model.description,
    ownedBy: model.owned_by,
    type: model.type,
    contextWindow,
    maxTokens,
    supportsStreaming: true,
    supportsTools: true,
    supportsTemperature: true,
    supportsReasoning,
    thinking: model.thinking,
    variants,
  };
}

/** Fill missing API metadata from an optional registry; live rich fields remain authoritative. */
export function mergeModelMetadata(
  apiModel: CliproxyModel,
  registry?: CliproxyModel,
): CliproxyModel {
  if (!registry) return apiModel;

  if (!apiModel.serverAuthoritative) {
    return {
      ...apiModel,
      ...registry,
      id: apiModel.id,
      name: registry.name || apiModel.name,
      description: registry.description || apiModel.description,
      supportsStreaming: registry.supportsStreaming ?? apiModel.supportsStreaming,
      supportsTools: registry.supportsTools ?? apiModel.supportsTools,
      supportsTemperature: registry.supportsTemperature ?? apiModel.supportsTemperature,
      supportsReasoning: registry.supportsReasoning ?? apiModel.supportsReasoning,
      supportsVision: registry.supportsVision ?? apiModel.supportsVision,
      supportsAttachment: registry.supportsAttachment ?? apiModel.supportsAttachment,
      contextWindow: registry.contextWindow ?? apiModel.contextWindow,
      maxTokens: registry.maxTokens ?? apiModel.maxTokens,
      thinking: registry.thinking ?? apiModel.thinking,
      variants: registry.variants ?? apiModel.variants,
    };
  }

  return {
    ...registry,
    ...apiModel,
    id: apiModel.id,
    name: apiModel.name && apiModel.name !== apiModel.id ? apiModel.name : registry.name || apiModel.name,
    description: apiModel.description && apiModel.description !== `CLIProxyAPI model: ${apiModel.id}`
      ? apiModel.description
      : registry.description || apiModel.description,
    supportsStreaming: apiModel.supportsStreaming ?? registry.supportsStreaming,
    supportsTools: apiModel.supportsTools ?? registry.supportsTools,
    supportsTemperature: apiModel.supportsTemperature ?? registry.supportsTemperature,
    supportsReasoning: apiModel.supportsReasoning ?? registry.supportsReasoning,
    supportsVision: apiModel.supportsVision ?? registry.supportsVision,
    supportsAttachment: apiModel.supportsAttachment ?? registry.supportsAttachment,
    contextWindow: apiModel.contextWindow ?? registry.contextWindow,
    maxTokens: apiModel.maxTokens ?? registry.maxTokens,
    thinking: apiModel.thinking ?? registry.thinking,
    variants: apiModel.variants ?? registry.variants,
  };
}

/** Derive model family from id for OpenCode provider metadata */
export function getModelFamily(modelId: string): string {
  const segment = modelId.includes('/') ? modelId.split('/').pop() : modelId;
  const base = segment?.trim() || modelId;
  const [family] = base.split('-');
  return family || base;
}