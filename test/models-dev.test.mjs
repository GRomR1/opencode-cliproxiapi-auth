import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeModelKey,
  resolveProviderAlias,
  buildModelsDevIndex,
  enrichWithModelsDev,
} from '../dist/src/models-dev.js';

test('normalizeModelKey strips date and preview suffixes', () => {
  assert.equal(normalizeModelKey('gpt-4o-2024-11-20'), 'gpt-4o');
  assert.equal(normalizeModelKey('claude-3-preview'), 'claude-3');
});

test('resolveProviderAlias maps claude to anthropic', () => {
  assert.equal(resolveProviderAlias('claude'), 'anthropic');
  assert.equal(resolveProviderAlias('gemini'), 'google');
});

test('enrichWithModelsDev fills missing limits from provider match', () => {
  const index = buildModelsDevIndex({
    anthropic: {
      id: 'anthropic',
      models: {
        'claude-sonnet-4-6': {
          id: 'claude-sonnet-4-6',
          name: 'Claude Sonnet',
          limit: { context: 200000, output: 64000 },
          reasoning: true,
        },
      },
    },
  });

  assert.ok(index);
  const enriched = enrichWithModelsDev(
    { id: 'claude-sonnet-4-6', name: 'claude-sonnet-4-6', ownedBy: 'anthropic' },
    index,
  );

  assert.equal(enriched.contextWindow, 200000);
  assert.equal(enriched.maxTokens, 64000);
  assert.equal(enriched.supportsReasoning, true);
});

test('enrichWithModelsDev skips ambiguous global matches', () => {
  const index = buildModelsDevIndex({
    openai: {
      id: 'openai',
      models: {
        'shared-model': { id: 'shared-model', name: 'OpenAI', limit: { context: 1000 } },
      },
    },
    anthropic: {
      id: 'anthropic',
      models: {
        'shared-model': { id: 'shared-model', name: 'Anthropic', limit: { context: 2000 } },
      },
    },
  });

  assert.ok(index);
  const enriched = enrichWithModelsDev(
    { id: 'shared-model', name: 'shared-model' },
    index,
  );

  assert.equal(enriched.contextWindow, undefined);
});