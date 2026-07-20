import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  thinkingToVariants,
  normalizeRegistryModel,
  mergeModelMetadata,
  normalizeApiModel,
} from '../dist/runtime.js';

test('thinkingToVariants maps every server-advertised level to an effective effort', () => {
  const variants = thinkingToVariants({
    levels: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
  });

  assert.deepEqual(variants.low, { reasoningEffort: 'low' });
  assert.deepEqual(variants.xhigh, { reasoningEffort: 'xhigh' });
  assert.deepEqual(variants.max, { reasoningEffort: 'max' });
  assert.deepEqual(variants.ultra, { reasoningEffort: 'ultra' });
});

test('normalizeApiModel consumes server-authoritative rich catalog metadata', () => {
  const model = normalizeApiModel({
    id: 'gpt-5.6-sol',
    display_name: 'GPT 5.6 Sol',
    description: 'Latest frontier agentic coding model.',
    max_context_window: 372000,
    input_modalities: ['text', 'image'],
    supports_parallel_tool_calls: true,
    supported_reasoning_levels: [
      { effort: 'low' },
      { effort: 'xhigh' },
      { effort: 'ultra' },
    ],
  });

  assert.equal(model.name, 'GPT 5.6 Sol');
  assert.equal(model.description, 'Latest frontier agentic coding model.');
  assert.equal(model.contextWindow, 372000);
  assert.equal(model.supportsVision, true);
  assert.equal(model.supportsTools, true);
  assert.equal(model.supportsReasoning, true);
  assert.deepEqual(model.variants.ultra, { reasoningEffort: 'ultra' });
});

test('normalizeRegistryModel reads gemini token limits', () => {
  const model = normalizeRegistryModel({
    id: 'gemini-2.5-pro',
    display_name: 'Gemini 2.5 Pro',
    inputTokenLimit: 1048576,
    outputTokenLimit: 65536,
    thinking: { dynamic_allowed: true },
  });

  assert.equal(model.contextWindow, 1048576);
  assert.equal(model.maxTokens, 65536);
  assert.equal(model.supportsReasoning, true);
});

test('mergeModelMetadata prefers registry enrichment', () => {
  const api = normalizeApiModel({ id: 'claude-sonnet-4-6', owned_by: 'anthropic' });
  const registry = normalizeRegistryModel({
    id: 'claude-sonnet-4-6',
    display_name: 'Claude 4.6 Sonnet',
    context_length: 200000,
    max_completion_tokens: 64000,
    thinking: { levels: ['low', 'high'] },
  });

  const merged = mergeModelMetadata(api, registry);
  assert.equal(merged.name, 'Claude 4.6 Sonnet');
  assert.equal(merged.contextWindow, 200000);
  assert.ok(merged.variants.high);
});