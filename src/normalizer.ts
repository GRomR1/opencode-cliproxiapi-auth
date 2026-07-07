import type {
  CliproxyModel,
  CliproxyModelVariant,
  CliproxyRegistryModel,
  CliproxyThinking,
} from './types.js';

const REASONING_LEVELS = new Set([
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]);

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
    const key = level.toLowerCase();
    if (REASONING_LEVELS.has(key)) {
      // Variant key is the reasoning level; config schema allows only `disabled`.
      variants[key] = {};
    }
  }

  return Object.keys(variants).length > 0 ? variants : undefined;
}

/** Normalize a /v1/models entry */
export function normalizeApiModel(model: {
  id: string;
  owned_by?: string;
  [key: string]: unknown;
}): CliproxyModel {
  return {
    id: model.id,
    name: typeof model.name === 'string' ? model.name : model.id,
    ownedBy: typeof model.owned_by === 'string' ? model.owned_by : undefined,
    description: `CLIProxyAPI model: ${model.id}`,
    supportsStreaming: true,
    supportsTools: true,
    supportsTemperature: true,
  };
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

/** Merge registry metadata into API model (registry wins for known fields) */
export function mergeModelMetadata(
  apiModel: CliproxyModel,
  registry?: CliproxyModel,
): CliproxyModel {
  if (!registry) return apiModel;

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

/** Derive model family from id for OpenCode provider metadata */
export function getModelFamily(modelId: string): string {
  const segment = modelId.includes('/') ? modelId.split('/').pop() : modelId;
  const base = segment?.trim() || modelId;
  const [family] = base.split('-');
  return family || base;
}