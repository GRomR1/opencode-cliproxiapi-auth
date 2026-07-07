import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseModelsJson } from '../dist/runtime.js';

test('parseModelsJson flattens provider buckets by model id', () => {
  const map = parseModelsJson({
    claude: [{ id: 'claude-sonnet-4-6', display_name: 'Claude 4.6 Sonnet' }],
    gemini: [{ id: 'gemini-2.5-pro', display_name: 'Gemini 2.5 Pro' }],
  });

  assert.equal(map.size, 2);
  assert.equal(map.get('claude-sonnet-4-6')?.name, 'Claude 4.6 Sonnet');
  assert.equal(map.get('gemini-2.5-pro')?.name, 'Gemini 2.5 Pro');
});

test('parseModelsJson ignores invalid entries', () => {
  const map = parseModelsJson({
    claude: [{ no_id: true }, { id: 'valid-model', display_name: 'Valid' }],
  });

  assert.equal(map.size, 1);
  assert.ok(map.has('valid-model'));
});