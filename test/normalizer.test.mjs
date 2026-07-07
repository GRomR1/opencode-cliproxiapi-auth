import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  thinkingToVariants,
  normalizeRegistryModel,
  mergeModelMetadata,
  normalizeApiModel,
} from '../dist/runtime.js';

test('thinkingToVariants maps CLIProxyAPI levels to reasoning variants', () => {
  const variants = thinkingToVariants({
    levels: ['low', 'medium', 'high', 'xhigh', 'max'],
  });

  assert.deepEqual(variants.low, {});
  assert.deepEqual(variants.xhigh, {});
  assert.deepEqual(variants.max, {});
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