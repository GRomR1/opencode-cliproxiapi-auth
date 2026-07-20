import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  clearModelCache,
  fetchModels,
  getCachedModels,
  isCacheValid,
  refreshModels,
} from '../dist/runtime.js';

const ORIGINAL_FETCH = global.fetch;

const CONFIG = {
  baseUrl: 'http://localhost:8317/v1',
  apiKey: 'test-key',
  modelCacheTtl: 60_000,
};

afterEach(() => {
  clearModelCache();
  global.fetch = ORIGINAL_FETCH;
});

function createMockFetch(registryBody = null) {
  let modelCalls = 0;

  const mockFetch = async (input) => {
    const url = input instanceof Request ? input.url : input.toString();

    if (url.includes('/v1/models')) {
      modelCalls += 1;
      return new Response(
        JSON.stringify({
          object: 'list',
          data: [{ id: `model-${modelCalls}`, name: `Model ${modelCalls}`, owned_by: 'anthropic' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (registryBody && url.includes('models.json')) {
      return new Response(JSON.stringify(registryBody), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  return { mockFetch, getCalls: () => modelCalls };
}

test('fetchModels caches successful responses', async () => {
  const { mockFetch, getCalls } = createMockFetch();
  global.fetch = mockFetch;

  const first = await fetchModels(CONFIG, false);
  const second = await fetchModels(CONFIG, false);

  assert.equal(getCalls(), 1);
  assert.equal(first[0].id, 'model-1');
  assert.equal(second[0].id, 'model-1');
  assert.ok(getCachedModels(CONFIG));
  assert.equal(isCacheValid(CONFIG), true);
});

test('refreshModels forces refetch', async () => {
  const { mockFetch, getCalls } = createMockFetch();
  global.fetch = mockFetch;

  await fetchModels(CONFIG, false);
  const refreshed = await refreshModels(CONFIG);

  assert.equal(getCalls(), 2);
  assert.equal(refreshed[0].id, 'model-2');
});

test('fetchModels works without api key', async () => {
  let authHeader = 'unset';
  global.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (url.includes('/v1/models')) {
      const headers = new Headers(init?.headers);
      authHeader = headers.get('Authorization') ?? 'none';
      return new Response(
        JSON.stringify({ object: 'list', data: [{ id: 'no-auth-model', name: 'No Auth' }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return new Response('{}', { status: 200 });
  };

  const models = await fetchModels({ ...CONFIG, apiKey: '' }, true);
  assert.equal(authHeader, 'none');
  assert.equal(models[0].id, 'no-auth-model');
});

test('fetchModels falls back to defaults when response shape is invalid', async () => {
  global.fetch = async (input) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (url.includes('/v1/models')) {
      return new Response(JSON.stringify({ data: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('{}', { status: 200 });
  };

  const models = await fetchModels(CONFIG, true);
  assert.ok(models.length > 0);
  assert.equal(typeof models[0].id, 'string');
});

test('fetchModels can disable fabricated fallback models', async () => {
  global.fetch = async () => new Response(JSON.stringify({ data: null }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  const models = await fetchModels({ ...CONFIG, fabricatedFallback: false }, true);
  assert.deepEqual(models, []);
});

test('fetchModels requests and parses CLIProxyAPI rich client catalog', async () => {
  let requestedUrl = '';
  global.fetch = async (input) => {
    requestedUrl = input instanceof Request ? input.url : input.toString();
    return new Response(JSON.stringify({
      models: [{
        slug: 'gpt-5.6-sol',
        display_name: 'GPT 5.6 Sol',
        max_context_window: 372000,
        input_modalities: ['text', 'image'],
        supported_reasoning_levels: [
          { effort: 'low' },
          { effort: 'xhigh' },
          { effort: 'ultra' },
        ],
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  const models = await fetchModels({
    ...CONFIG,
    modelsClientVersion: '0.144.1',
    modelsJsonPath: undefined,
    modelsDev: { enabled: false },
    fabricatedFallback: false,
  }, true);

  assert.equal(new URL(requestedUrl).searchParams.get('client_version'), '0.144.1');
  assert.equal(models[0].id, 'gpt-5.6-sol');
  assert.equal(models[0].contextWindow, 372000);
  assert.deepEqual(models[0].variants.ultra, { reasoningEffort: 'ultra' });
});

test('fetchModels deduplicates concurrent requests', async () => {
  let calls = 0;
  global.fetch = async (input) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (url.includes('/v1/models')) {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return new Response(
        JSON.stringify({ object: 'list', data: [{ id: 'concurrent-model', name: 'Concurrent' }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return new Response('{}', { status: 200 });
  };

  const [first, second] = await Promise.all([
    fetchModels(CONFIG, true),
    fetchModels(CONFIG, false),
  ]);

  assert.equal(calls, 1);
  assert.equal(first[0].id, 'concurrent-model');
  assert.equal(second[0].id, 'concurrent-model');
});

test('fetchModels enriches from models.json URL', async () => {
  const registry = {
    claude: [
      {
        id: 'model-1',
        display_name: 'Claude Enriched',
        context_length: 200000,
        max_completion_tokens: 64000,
        thinking: { levels: ['low', 'high', 'max'] },
      },
    ],
  };

  const { mockFetch } = createMockFetch(registry);
  global.fetch = mockFetch;

  const models = await fetchModels(
    {
      ...CONFIG,
      modelsJsonPath: 'https://example.com/models.json',
    },
    true,
  );

  assert.equal(models[0].name, 'Claude Enriched');
  assert.equal(models[0].contextWindow, 200000);
  assert.equal(models[0].supportsReasoning, true);
  assert.ok(models[0].variants.low);
  assert.ok(models[0].variants.max);
});