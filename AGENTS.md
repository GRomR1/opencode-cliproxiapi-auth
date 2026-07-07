# Agent Guidelines for opencode-cliproxiapi-auth

Guidelines for AI agents working in this repository.

## Overview

`opencode-cliproxiapi-auth` is an [OpenCode](https://opencode.ai) authentication and model-provider plugin for [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI).

It registers the `cliproxy` provider, supports `/connect cliproxy`, fetches models from `/v1/models`, enriches metadata from CLIProxyAPI `models.json` and [models.dev](https://models.dev/), and maps `thinking.levels` to OpenCode reasoning variants.

**Reference implementation:** `opencode-omniroute-auth/` in this workspace (same patterns, fewer features).

## Common Commands

```bash
# Build (required before tests)
npm run build

# Watch mode
npm run dev

# Unit tests (mocked, no network)
npm test

# Single unit test file
npm run build && node --test test/plugin.test.mjs

# Live integration tests (requires .env — see below)
npm run test:integration

# Validate plugin exports for OpenCode loader
npm run check:exports

# Full publish prep
npm run prepublishOnly
```

## Secrets & Environment

**Never commit credentials.** Use `.env` (gitignored):

```bash
cp .env.example .env
# edit CLIPROXY_BASE_URL and CLIPROXY_API_KEY
```

| Variable | Used by |
|----------|---------|
| `CLIPROXY_BASE_URL` | `test/integration.test.mjs` (required) |
| `CLIPROXY_API_KEY` | `test/integration.test.mjs` (optional), runtime fallback if not in config/auth |
| `CLIPROXY_TEST_MODEL` | `test/integration.test.mjs` — override chat-completion test model |
| `CLIPROXY_DEBUG=1` | `src/logger.ts` debug output |

Integration tests load `.env` via `test/load-env.mjs` and only run when `CLIPROXY_INTEGRATION=1`.

## Architecture

### Dual Entry Points

| File | Role |
|------|------|
| `index.ts` | Default export `CliproxyAuthPlugin` + named re-exports. **All root exports must be functions** (OpenCode loader constraint). |
| `runtime.ts` | Programmatic API: `fetchModels`, `clearModelCache`, `refreshModels`, normalizers, constants. |

### Core Modules

| File | Responsibility |
|------|----------------|
| `src/plugin.ts` | `config` hook (provider registration), `provider` hook (dynamic models, OpenCode ≥1.14.49), `auth` hook (`/connect cliproxy`, loader, fetch interceptor). |
| `src/model-fetcher.ts` | Fetches `/v1/models`, merges `models.json` + models.dev, TTL cache, singleflight dedup, fallback models. |
| `src/models-json.ts` | Loads CLIProxyAPI `models.json` from local path or URL; flattens provider buckets into `id → model` map. |
| `src/normalizer.ts` | Normalizes API/registry fields; `thinkingToVariants()` maps `thinking.levels` → OpenCode variants. |
| `src/models-dev.ts` | Fetches and indexes models.dev; fills missing context/output/capabilities. |
| `src/cache.ts` | Generic `TtlCache<T>` used by model fetcher. |
| `src/logger.ts` | Async file logging to OpenCode log dir; `sanitizeForLog()` + `formatErrorForLog()` redact keys/tokens/`sk-*`. |
| `src/constants.ts` | `CLIPROXY_PROVIDER_ID`, endpoints, defaults, TTLs. |
| `src/types.ts` | Shared TypeScript interfaces. |

### Auth Flow

1. **`/connect cliproxy`** — prompts for `baseURL` (default `http://localhost:8317/v1`) and optional `apiKey`.
2. **`authorize`** stores JSON in auth key: `{"baseURL":"...","apiKey":"..."}`.
3. **`parseAuthKey()`** accepts JSON payload or plain API key string.
4. **baseURL priority:** `options.baseURL` → auth-stored `baseURL` from `/connect` → `http://localhost:8317/v1` (`getBaseUrl()`).
5. **API key priority:** `options.apiKey` → auth key → `CLIPROXY_API_KEY` env → empty (no `Authorization` header).
6. Credentials persist in `~/.local/share/opencode/auth.json` under `cliproxy`.

### Fetch Interceptor (`createFetchInterceptor`)

- Intercepts only requests to the configured `baseURL` (safe prefix match).
- Sets `Authorization: Bearer <key>` **only when apiKey is non-empty**.
- Sets `Content-Type: application/json` only on POST/PUT/PATCH requests that include a body.

### models.json path (`resolveModelsJsonPath`)

- When `modelsJsonPath` is **omitted** from options → `DEFAULT_MODELS_JSON_URL` (CLIProxyAPI GitHub registry).
- When set to a non-empty string → local path or URL.
- When set to `""` → registry enrichment disabled.

### Caching

| Cache | Location | Default TTL |
|-------|----------|-------------|
| Models | `src/model-fetcher.ts` | 5 min (`modelCacheTtl`) |
| models.json | `src/models-json.ts` | 10 min |
| models.dev | `src/models-dev.ts` | 24 h |
| In-flight fetches | `src/model-fetcher.ts` | Per `cacheKey`; concurrent callers share one promise |

`clearModelCache()` clears the model list cache and in-flight map.

## Local OpenCode Development

Before publishing, load the built plugin via `file://` in project `opencode.json`:

```json
{
  "plugin": ["file://./dist/index.js"],
  "provider": {
    "cliproxy": {
      "options": {
        "refreshOnList": true
      }
    }
  }
}
```

`modelsJsonPath` is optional — defaults to CLIProxyAPI GitHub `models.json`. Set `"modelsJsonPath": ""` to disable.

Then:

```bash
npm run build
/connect cliproxy          # set baseURL + apiKey interactively
opencode models cliproxy   # verify models load
```

**Note:** `opencode --pure` skips external plugins. Do not use `--pure` when testing this plugin.

## Code Style

### TypeScript

- **Target:** ES2022, **Module:** NodeNext (ESM), **strict:** true.
- **Imports:** Always use `.js` extensions for relative paths.
- **No `any`**. Validate API responses before casting.
- Named exports in `src/`; default export only in `index.ts` for the plugin function.

### Naming

| Kind | Convention | Example |
|------|------------|---------|
| Constants | `UPPER_SNAKE_CASE` | `CLIPROXY_PROVIDER_ID` |
| Functions/vars | `camelCase` | `fetchModels` |
| Types | `PascalCase` | `CliproxyConfig` |
| Provider slug | `cliproxy` | `opencode.json` key |

### Security

- Never log API keys, bearer tokens, or full auth payloads.
- Use `sanitizeForLog()` / `formatErrorForLog()` from `src/logger.ts` before writing sensitive strings or errors.
- Optional API key: CLIProxyAPI may run without `api-keys` in `config.yaml`.

### Error Handling

```typescript
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
try {
  const response = await fetch(url, { signal: controller.signal });
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  // validate shape before cast
} finally {
  clearTimeout(timeoutId);
}
```

Graceful degradation order for model fetch:

1. Fresh `/v1/models` + enrichment
2. Stale cache (even if TTL expired)
3. `CLIPROXY_DEFAULT_MODELS`

## Testing

### Unit (`npm test`)

| File | Covers |
|------|--------|
| `test/models.test.mjs` | Cache, singleflight dedup, fetch mocks, models.json enrichment |
| `test/normalizer.test.mjs` | Thinking variants, registry merge |
| `test/models-json.test.mjs` | `parseModelsJson()` |
| `test/models-dev.test.mjs` | models.dev enrichment and ambiguous-match skip |
| `test/logger.test.mjs` | `sanitizeForLog()`, `formatErrorForLog()` |
| `test/plugin.test.mjs` | Config/auth/provider hooks, auth baseURL, fetch interceptor |

### Integration (`npm run test:integration`)

Requires `.env` with `CLIPROXY_BASE_URL`. `CLIPROXY_API_KEY` is optional. Chat test model: `CLIPROXY_TEST_MODEL` or `gpt-5.4-mini` or first from `/v1/models`.

| Test | What it verifies |
|------|------------------|
| live /v1/models | `fetchModels()` against real server |
| reasoning metadata | `models.json` thinking enrichment |
| opencode models cliproxy | Plugin loads, provider registered |
| chat completion API | Direct `/v1/chat/completions` works |

**Known limitation:** `opencode run` in subprocess is flaky (global config merge suggests `cliapiproxy` instead of `cliproxy`). Not included in integration suite; manual smoke test from a stable project dir works.

## Common Tasks

### Add a config option

1. Add type in `src/types.ts` (`CliproxyConfig`).
2. Parse in `createRuntimeConfig()` / `getModelsDevConfig()` in `src/plugin.ts`.
3. Use in `src/model-fetcher.ts` if fetch-related.
4. Document in `README.md`.
5. Add unit test.

### Add export to runtime API

1. Export from source module.
2. Re-export in `runtime.ts` with `.js` paths.
3. Run `npm run build && npm run check:exports`.

### Debug plugin in OpenCode

```bash
CLIPROXY_DEBUG=1 opencode --print-logs --log-level DEBUG models cliproxy
```

Check logs under `~/.local/share/opencode/log/` (`service=cliproxy`).

## Release Checklist

1. Bump `package.json` version.
2. Update `CHANGELOG.md` (if present).
3. `npm run prepublishOnly` — must pass.
4. `npm test` and optionally `npm run test:integration`.
5. Push tag `vX.Y.Z` (must match `package.json` version).
6. Publish **GitHub Release** for that tag — workflow `.github/workflows/publish.yml` runs `npm publish`.

**CI:** `.github/workflows/ci.yml` on push/PR. **npm secret:** `NPM_TOKEN` in GitHub repo settings.

Package name: **`opencode-cliproxiapi-auth`**. Provider slug: **`cliproxy`**.