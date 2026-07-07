/**
 * Live integration tests against CLIProxyAPI.
 * Requires .env (see .env.example) and CLIPROXY_INTEGRATION=1.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawn } from 'child_process';

import { fetchModels, clearModelCache } from '../dist/runtime.js';
import { loadEnv, requireEnv } from './load-env.mjs';

const PLUGIN_PATH = new URL('../dist/index.js', import.meta.url).pathname;
const INTEGRATION_ENABLED = process.env.CLIPROXY_INTEGRATION === '1';

let projectDir;
let config;

function runCommand(cmd, args, options = {}) {
  const { cwd, timeoutMs = 120_000, env = process.env } = options;

  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Command timed out after ${timeoutMs}ms: ${cmd} ${args.join(' ')}`));
    }, timeoutMs);

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(
        new Error(
          `Command failed (code=${code}, signal=${signal}): ${cmd} ${args.join(' ')}\n${stderr || stdout}`,
        ),
      );
    });
  });
}

before(async () => {
  if (!INTEGRATION_ENABLED) return;

  await loadEnv();
  const baseUrl = requireEnv('CLIPROXY_BASE_URL');
  const apiKey = process.env.CLIPROXY_API_KEY?.trim() ?? '';

  config = {
    baseUrl,
    apiKey,
    modelsJsonPath:
      'https://raw.githubusercontent.com/router-for-me/CLIProxyAPI/refs/heads/main/internal/registry/models/models.json',
  };

  const providerOptions = {
    baseURL: baseUrl,
    refreshOnList: true,
    modelsJsonPath: config.modelsJsonPath,
    ...(apiKey ? { apiKey } : {}),
  };

  projectDir = join(tmpdir(), `cliproxy-integration-${Date.now()}`);
  await mkdir(projectDir, { recursive: true });
  await writeFile(
    join(projectDir, 'opencode.json'),
    JSON.stringify(
      {
        plugin: [`file://${PLUGIN_PATH}`],
        provider: {
          cliproxy: {
            options: providerOptions,
          },
        },
      },
      null,
      2,
    ),
  );
});

test('live /v1/models returns models', { skip: !INTEGRATION_ENABLED }, async () => {
  clearModelCache();
  const models = await fetchModels(config, true);
  assert.ok(models.length >= 1, 'expected at least one model');
  assert.ok(models.every((m) => typeof m.id === 'string'));
});

test('live models include reasoning metadata when registry matches', {
  skip: !INTEGRATION_ENABLED,
}, async () => {
  clearModelCache();
  const models = await fetchModels(config, true);
  const withReasoning = models.filter((m) => m.supportsReasoning || m.variants);
  assert.ok(withReasoning.length > 0, 'expected some models with thinking metadata');
});

test('opencode lists cliproxy provider models', { skip: !INTEGRATION_ENABLED }, async () => {
  const { stdout } = await runCommand('opencode', ['models', 'cliproxy', '--verbose'], {
    cwd: projectDir,
    timeoutMs: 120_000,
  });
  assert.match(stdout, /cliproxy\//);
  assert.match(stdout, /providerID.*cliproxy/);
});

test('live chat completion via /v1/chat/completions', { skip: !INTEGRATION_ENABLED }, async () => {
  clearModelCache();
  const models = await fetchModels(config, true);
  const preferred = process.env.CLIPROXY_TEST_MODEL?.trim();
  const modelId =
    (preferred && models.find((m) => m.id === preferred)?.id) ||
    models.find((m) => m.id === 'gpt-5.4-mini')?.id ||
    models[0]?.id;
  assert.ok(modelId, 'no model available for chat completion test');

  const headers = { 'Content-Type': 'application/json' };
  if (config.apiKey) {
    headers.Authorization = `Bearer ${config.apiKey}`;
  }

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: modelId,
      messages: [{ role: 'user', content: 'Reply with exactly: API_OK' }],
      max_tokens: 16,
    }),
  });

  assert.equal(response.status, 200, `chat completion failed: ${response.status}`);
  const body = await response.json();
  const text = body.choices?.[0]?.message?.content ?? '';
  assert.match(text, /API_OK/i);
});

after(async () => {
  if (projectDir) await rm(projectDir, { recursive: true, force: true }).catch(() => {});
});