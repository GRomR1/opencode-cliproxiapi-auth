import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

import CliproxyAuthPlugin from '../dist/index.js';
import { clearModelCache } from '../dist/runtime.js';
import { clearModelsDevCache } from '../dist/src/models-dev.js';
import { parseAuthKey } from '../dist/src/plugin.js';

const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_HOME = process.env.HOME;
const ORIGINAL_XDG_DATA_HOME = process.env.XDG_DATA_HOME;

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  restoreEnv('HOME', ORIGINAL_HOME);
  restoreEnv('XDG_DATA_HOME', ORIGINAL_XDG_DATA_HOME);
  clearModelCache();
  clearModelsDevCache();
});

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function baseUrl(port = 8317) {
  return `http://localhost:${port}/v1`;
}

async function createTempAuthHome(auth = { cliproxy: { type: 'api', key: 'test-key' } }) {
  const tempHome = join(tmpdir(), `opencode-test-${Date.now()}-${Math.random()}`);
  const dataHome = join(tempHome, '.local', 'share');
  await mkdir(join(dataHome, 'opencode'), { recursive: true });
  await writeFile(join(dataHome, 'opencode', 'auth.json'), JSON.stringify(auth));
  process.env.HOME = tempHome;
  process.env.XDG_DATA_HOME = dataHome;
  return tempHome;
}

test('config hook applies default baseURL', async () => {
  const plugin = await CliproxyAuthPlugin({});
  const config = {
    provider: {
      cliproxy: {
        options: { baseURL: '  ' },
      },
    },
  };

  await plugin.config(config);
  assert.equal(config.provider.cliproxy.options.baseURL, 'http://localhost:8317/v1');
});

test('parseAuthKey supports JSON connect payload and plain keys', () => {
  const json = parseAuthKey(JSON.stringify({ baseURL: 'http://127.0.0.1:9000/v1', apiKey: 'secret' }));
  assert.equal(json.apiKey, 'secret');
  assert.equal(json.baseUrl, 'http://127.0.0.1:9000/v1');

  const plain = parseAuthKey('plain-key');
  assert.equal(plain.apiKey, 'plain-key');
});

test('loader injects auth header only for CLIProxyAPI URLs', async () => {
  const plugin = await CliproxyAuthPlugin({});
  const calls = [];

  global.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push({ url, init });

    if (url.endsWith('/v1/models')) {
      return new Response(
        JSON.stringify({ object: 'list', data: [{ id: 'gpt-test', name: 'GPT Test' }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    return new Response('{"ok":true}', { status: 200 });
  };

  const provider = { options: { baseURL: baseUrl() }, models: {} };
  const options = await plugin.auth.loader(async () => ({ type: 'api', key: 'secret-key' }), provider);
  const interceptedFetch = options.fetch;

  await interceptedFetch(`${baseUrl()}/chat/completions`, {
    method: 'POST',
    body: JSON.stringify({ model: 'gpt-test', messages: [] }),
  });

  await interceptedFetch('https://example.com/external', { method: 'GET' });

  const cliproxyCall = calls.find((c) => c.url.includes('/chat/completions'));
  const externalCall = calls.find((c) => c.url.includes('example.com'));

  assert.equal(new Headers(cliproxyCall.init?.headers).get('Authorization'), 'Bearer secret-key');
  assert.equal(new Headers(externalCall.init?.headers).get('Authorization'), null);
});

test('loader works without api key when server has no auth', async () => {
  const plugin = await CliproxyAuthPlugin({});
  let authHeader = 'unset';

  global.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.endsWith('/v1/models')) {
      authHeader = new Headers(init?.headers).get('Authorization') ?? 'none';
      return new Response(
        JSON.stringify({ object: 'list', data: [{ id: 'open-model', name: 'Open' }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return new Response('{}', { status: 200 });
  };

  const provider = { options: { baseURL: baseUrl(8318) }, models: {} };
  const options = await plugin.auth.loader(
    async () => ({ type: 'api', key: JSON.stringify({ baseURL: baseUrl(8318), apiKey: '' }) }),
    provider,
  );

  assert.equal(options.apiKey, '');
  assert.equal(authHeader, 'none');
  assert.ok(provider.models['open-model']);
});

test('provider hook fetches models with thinking variants', async () => {
  const plugin = await CliproxyAuthPlugin({});

  global.fetch = async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.endsWith('/v1/models')) {
      return new Response(
        JSON.stringify({ object: 'list', data: [{ id: 'claude-sonnet-4-6', owned_by: 'anthropic' }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (url.includes('models.json')) {
      return new Response(
        JSON.stringify({
          claude: [{
            id: 'claude-sonnet-4-6',
            display_name: 'Claude 4.6 Sonnet',
            context_length: 200000,
            thinking: { levels: ['low', 'medium', 'high', 'max'] },
          }],
        }),
        { status: 200 },
      );
    }
    return new Response('{}', { status: 200 });
  };

  const result = await plugin.provider.models(
    {
      id: 'cliproxy',
      name: 'CLIProxyAPI',
      source: 'config',
      env: [],
      options: {
        baseURL: baseUrl(8319),
        modelsJsonPath: 'https://example.com/models.json',
      },
      models: {},
    },
    { auth: { type: 'api', key: 'live-key' } },
  );

  assert.ok(result['claude-sonnet-4-6']);
  assert.equal(result['claude-sonnet-4-6'].reasoning, true);
  assert.ok(result['claude-sonnet-4-6'].variants.max);
  assert.equal(result['claude-sonnet-4-6'].limit.context, 200000);
});

test('config hook eagerly fetches models when auth is available', async () => {
  const tempHome = await createTempAuthHome();
  try {
    global.fetch = async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.endsWith('/v1/models')) {
        return new Response(
          JSON.stringify({ object: 'list', data: [{ id: 'live-model', name: 'Live Model' }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('{}', { status: 200 });
    };

    const plugin = await CliproxyAuthPlugin({});
    const config = { provider: { cliproxy: { options: { baseURL: baseUrl() } } } };
    await plugin.config(config);

    assert.ok(config.provider.cliproxy.models['live-model']);
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});

test('config hook uses auth-stored baseURL when options omit baseURL', async () => {
  const remote = 'https://cpa.example.com/v1';
  const tempHome = await createTempAuthHome({
    cliproxy: {
      type: 'api',
      key: JSON.stringify({ baseURL: remote, apiKey: 'test-key' }),
    },
  });
  try {
    global.fetch = async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.endsWith('/v1/models')) {
        return new Response(
          JSON.stringify({ object: 'list', data: [{ id: 'remote-model', name: 'Remote' }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('{}', { status: 200 });
    };

    const plugin = await CliproxyAuthPlugin({});
    const config = { provider: { cliproxy: { options: {} } } };
    await plugin.config(config);

    assert.equal(config.provider.cliproxy.options.baseURL, remote);
    assert.equal(config.provider.cliproxy.models['remote-model'].id, 'remote-model');
    assert.equal(config.provider.cliproxy.models['remote-model'].providerID, undefined);
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});

test('provider hook uses auth-stored baseURL when options omit baseURL', async () => {
  const remote = 'https://cpa.example.com/v1';
  global.fetch = async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.endsWith('/v1/models')) {
      return new Response(
        JSON.stringify({ object: 'list', data: [{ id: 'remote-model', name: 'Remote' }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return new Response('{}', { status: 200 });
  };

  const plugin = await CliproxyAuthPlugin({});
  const result = await plugin.provider.models(
    {
      id: 'cliproxy',
      name: 'CLIProxyAPI',
      source: 'config',
      env: [],
      options: {},
      models: {},
    },
    {
      auth: {
        type: 'api',
        key: JSON.stringify({ baseURL: remote, apiKey: 'live-key' }),
      },
    },
  );

  assert.equal(result['remote-model'].id, 'remote-model');
  assert.equal(result['remote-model'].api, undefined);
});

test('toProviderModel matches opencode.ai/config.json model shape', async () => {
  const { toProviderModel } = await import('../dist/src/plugin.js');

  const model = toProviderModel(
    {
      id: 'claude-sonnet-4-6',
      name: 'Claude Sonnet 4.6',
      contextWindow: 200000,
      maxTokens: 64000,
      supportsReasoning: true,
      thinking: { levels: ['low', 'high'] },
      variants: { low: {}, high: {} },
      pricing: { input: 3, output: 15 },
    },
    'https://cpa.example.com/v1',
  );

  const forbidden = ['providerID', 'api', 'capabilities'];
  for (const key of forbidden) {
    assert.equal(model[key], undefined, `unexpected field ${key}`);
  }
  assert.equal(model.cost.cache, undefined);
  assert.deepEqual(model.variants.low, {});
  assert.equal(model.variants.low.reasoningEffort, undefined);
});

test('fetch interceptor does not force Content-Type on GET requests', async () => {
  const plugin = await CliproxyAuthPlugin({});
  let capturedHeaders;

  global.fetch = async (_input, init) => {
    capturedHeaders = new Headers(init?.headers);
    return new Response('{}', { status: 200 });
  };

  const provider = { options: { baseURL: baseUrl() }, models: {} };
  const options = await plugin.auth.loader(async () => ({ type: 'api', key: 'secret-key' }), provider);
  await options.fetch(`${baseUrl()}/models`, { method: 'GET' });

  assert.equal(capturedHeaders.get('Content-Type'), null);
});

test('authorize stores baseURL and optional apiKey as JSON', async () => {
  const plugin = await CliproxyAuthPlugin({});
  const method = plugin.auth.methods[0];

  const result = await method.authorize({
    baseURL: 'http://127.0.0.1:8317/v1',
    apiKey: '',
  });

  assert.equal(result.type, 'success');
  const parsed = JSON.parse(result.key);
  assert.equal(parsed.baseURL, 'http://127.0.0.1:8317/v1');
  assert.equal(parsed.apiKey, '');
});
test('getBaseUrl rejects plaintext HTTP for remote hosts but allows loopback', async () => {
  const { getBaseUrl } = await import('../dist/src/plugin.js');
  assert.equal(getBaseUrl({ baseURL: 'http://localhost:8317/v1' }), 'http://localhost:8317/v1');
  assert.equal(getBaseUrl({ baseURL: 'http://127.42.0.1:8317/v1' }), 'http://127.42.0.1:8317/v1');
  assert.equal(getBaseUrl({ baseURL: 'http://[::1]:8317/v1' }), 'http://[::1]:8317/v1');
  assert.equal(getBaseUrl({ baseURL: 'http://proxy.example/v1' }), 'http://localhost:8317/v1');
  assert.equal(getBaseUrl({ baseURL: 'http://192.168.1.10:8317/v1' }), 'http://localhost:8317/v1');
});
