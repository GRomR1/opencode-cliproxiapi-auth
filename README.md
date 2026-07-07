# opencode-cliproxiapi-auth

OpenCode authentication and model-provider plugin for [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI).

Connect OpenCode to a running CLIProxyAPI instance (local or remote), authenticate with an optional API key, dynamically load models from `/v1/models`, and enrich metadata from CLIProxyAPI `models.json` and [models.dev](https://models.dev/).

## Features

- **`/connect cliproxy`** — interactive setup (base URL + optional API key)
- **Provider `cliproxy`** — auto-registered with full model list
- **Dynamic models** — fetched from CLIProxyAPI `/v1/models` with TTL cache
- **models.json enrichment** — defaults to CLIProxyAPI registry URL; override with local path or custom URL
- **models.dev enrichment** — fills missing metadata (graceful fallback)
- **Auth-aware base URL** — `/connect cliproxy` base URL used when `opencode.json` omits `baseURL`
- **Thinking / reasoning** — maps CLIProxyAPI `thinking.levels` to OpenCode variants (`low`, `medium`, `high`, `xhigh`, `max`, …)
- **Optional API key** — works when CLIProxyAPI runs without `api-keys`
- **Fallback models** — sensible defaults when the server is unreachable
- **Safe logging** — API keys, bearer tokens, and `sk-*` values are redacted from logs
- **Concurrent fetch dedup** — parallel model requests share a single in-flight fetch

## Requirements

- [OpenCode](https://opencode.ai) ≥ 1.14.49 recommended (provider hook for dynamic models)
- Node.js ≥ 22.14 (npm trusted publishing); CI uses Node 24
- Running [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) (default port `8317`)

## Installation

### From npm

Published: [opencode-cliproxiapi-auth](https://www.npmjs.com/package/opencode-cliproxiapi-auth)

```bash
npm install opencode-cliproxiapi-auth
```

Add to `opencode.json`:

```json
{
  "plugin": ["opencode-cliproxiapi-auth"]
}
```

### Local development

```bash
git clone https://github.com/GRomR1/opencode-cliproxiapi-auth.git
cd opencode-cliproxiapi-auth
npm install
npm run build
```

In your project's `opencode.json`:

```json
{
  "plugin": ["file:///absolute/path/to/opencode-cliproxiapi-auth/dist/index.js"]
}
```

Or from inside the plugin repo (relative path):

```json
{
  "plugin": ["file://./dist/index.js"]
}
```

## Quick Start

### 1. Start CLIProxyAPI

Default endpoint: `http://localhost:8317/v1`

If `api-keys` is set in CLIProxyAPI `config.yaml`, use one of those keys. If omitted, no key is required.

### 2. Connect in OpenCode

```
/connect cliproxy
```

Prompts:

| Field | Default | Notes |
|-------|---------|-------|
| Base URL | `http://localhost:8317/v1` | Include `/v1` suffix |
| API key | *(empty)* | Optional if CLIProxyAPI has no `api-keys` |

Credentials are stored in `~/.local/share/opencode/auth.json`.

### 3. Verify models

```bash
opencode models cliproxy
```

Models appear as `cliproxy/<model-id>`, e.g. `cliproxy/claude-sonnet-4-6`.

### 4. Use a model

```bash
opencode run -m cliproxy/gpt-5.4-mini "Hello"
```

## Configuration

Optional settings in `opencode.json`:

```json
{
  "plugin": ["opencode-cliproxiapi-auth"],
  "provider": {
    "cliproxy": {
      "options": {
        "baseURL": "http://localhost:8317/v1",
        "apiKey": "your-key-from-config.yaml",
        "modelCacheTtl": 300000,
        "refreshOnList": true,
        "modelsDev": { "enabled": true }
      }
    }
  }
}
```

### models.json enrichment

`/v1/models` often returns minimal metadata. By default, the plugin loads CLIProxyAPI's registry from GitHub (`DEFAULT_MODELS_JSON_URL`). No config is required for thinking levels and token limits in most setups.

Override with a local clone or custom URL:

```json
{
  "provider": {
    "cliproxy": {
      "options": {
        "modelsJsonPath": "/path/to/CLIProxyAPI/internal/registry/models/models.json"
      }
    }
  }
}
```

Set `"modelsJsonPath": ""` to disable registry enrichment entirely.

Enrichment mapping:

| CLIProxyAPI `models.json` | OpenCode field |
|---------------------------|----------------|
| `context_length` / `inputTokenLimit` | `contextWindow` |
| `max_completion_tokens` / `outputTokenLimit` | `maxTokens` |
| `thinking.levels` | reasoning `variants` |
| `display_name` | model `name` |
| `description` | model `description` |

### Options reference

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `baseURL` | string | `http://localhost:8317/v1` | CLIProxyAPI base URL; falls back to `/connect cliproxy` stored URL |
| `apiKey` | string | — | Key from `config.yaml` `api-keys` (optional) |
| `modelCacheTtl` | number | `300000` | Model cache TTL (ms) |
| `refreshOnList` | boolean | `true` | Refresh models when provider options reload |
| `modelsJsonPath` | string | CLIProxyAPI GitHub `models.json` | Local path or URL; `""` disables enrichment |
| `modelsDev.enabled` | boolean | `true` | Enrich from models.dev |
| `modelsDev.url` | string | `https://models.dev/api.json` | models.dev API URL |
| `modelsDev.cacheTtl` | number | `86400000` | models.dev cache TTL (ms) |
| `modelsDev.timeoutMs` | number | `5000` | models.dev fetch timeout (ms) |
| `modelsDev.providerAliases` | object | — | Map `owned_by` → models.dev provider |

### baseURL resolution

Effective base URL is chosen in order:

1. `provider.cliproxy.options.baseURL` in `opencode.json`
2. `baseURL` stored by `/connect cliproxy` in `~/.local/share/opencode/auth.json`
3. Default `http://localhost:8317/v1`

API key priority: `options.apiKey` → auth key → `CLIPROXY_API_KEY` env → none (no `Authorization` header).

### Environment variables

| Variable | Description |
|----------|-------------|
| `CLIPROXY_API_KEY` | API key fallback (config/auth take precedence) |
| `CLIPROXY_DEBUG=1` | Enable debug logging to OpenCode log files |
| `CLIPROXY_BASE_URL` | Integration tests only — live CLIProxyAPI base URL |
| `CLIPROXY_TEST_MODEL` | Integration tests only — override model for chat-completion test |

## Runtime API

For scripts and manual cache control:

```typescript
import {
  fetchModels,
  clearModelCache,
  refreshModels,
  CLIPROXY_PROVIDER_ID,
  CLIPROXY_ENDPOINTS,
} from 'opencode-cliproxiapi-auth/runtime';

const config = {
  baseUrl: 'http://localhost:8317/v1',
  apiKey: 'optional-key',
  // modelsJsonPath omitted → uses CLIProxyAPI GitHub registry by default
};

const models = await fetchModels(config);
await refreshModels(config);
clearModelCache(config);
```

Exported helpers also include `loadModelsJson`, `parseModelsJson`, `thinkingToVariants`, `normalizeRegistryModel`, and models.dev utilities.

## Architecture

```
index.ts          → CliproxyAuthPlugin (OpenCode entry)
runtime.ts        → programmatic exports
src/
  plugin.ts       → config / provider / auth hooks
  model-fetcher.ts→ /v1/models + cache + orchestration
  models-json.ts  → CLIProxyAPI models.json loader
  normalizer.ts   → field normalization + thinking variants
  models-dev.ts   → models.dev enrichment
  cache.ts        → TTL cache primitive
  logger.ts       → sanitized file logging
  constants.ts    → defaults and endpoints
  types.ts        → TypeScript interfaces
```

Inspired by [opencode-omniroute-auth](https://github.com/Alph4d0g/opencode-omniroute-auth), simplified for CLIProxyAPI (no combo models, no Gemini schema sanitization).

## Development

```bash
npm install
npm run build      # compile TypeScript → dist/
npm test           # unit tests (mocked)
npm run check:exports
```

## Publishing to npm

Publishing uses [npm trusted publishing](https://docs.npmjs.com/trusted-publishers) (OIDC from GitHub Actions). **No `NPM_TOKEN` secret is required.**

Workflow: `.github/workflows/publish.yml` (triggers: tag `v*`, GitHub Release, manual dispatch).

### One-time setup (npm trusted publisher)

1. Log in to [npmjs.com](https://www.npmjs.com/) as [gromr1](https://www.npmjs.com/~gromr1).
2. Open package settings for `opencode-cliproxiapi-auth` (after first publish) **or** account publishing settings before the first release.
3. Section **Trusted publishing** → **GitHub Actions**.
4. Configure **exactly** (case-sensitive):

| Field | Value |
|-------|-------|
| Organization or user | `GRomR1` (exact GitHub casing — npm is case-sensitive) |
| Repository | `opencode-cliproxiapi-auth` |
| Workflow filename | `publish.yml` |
| Allowed actions | `npm publish` |

5. Save. npm does not validate until the first publish attempt — double-check spelling.

`package.json` → `repository.url` must use the same casing as GitHub (`git+https://github.com/GRomR1/opencode-cliproxiapi-auth.git`).

Optional hardening after verified publish: package **Settings → Publishing access → Require 2FA and disallow tokens**, then revoke old automation tokens.

### Release flow

```bash
# 1. Bump version in package.json (must be higher than npm latest)
# 2. Commit, push, tag (tag must match version: v1.0.2 ↔ 1.0.2)
git tag v1.0.2
git push origin v1.0.2
```

Or: **Actions → Publish to npm → Run workflow** (branch `main`).

CI uses `actions/checkout@v6`, `actions/setup-node@v6`, Node 24. The workflow runs `npm test`, checks the version is not already on npm, then `npm publish` via OIDC. Provenance is added automatically for public repos.

**Do not re-publish an existing version** — npm rejects duplicate versions; bump `package.json` first.

### Local dry run (no upload)

```bash
npm pack
tar -tf opencode-cliproxiapi-auth-*.tgz
```

### Integration tests (live CLIProxyAPI)

Credentials go in `.env` (never commit — see `.env.example`):

```bash
cp .env.example .env
# CLIPROXY_BASE_URL=https://your-cpa-host/v1
# CLIPROXY_API_KEY=          # optional if CLIProxyAPI has no api-keys
# CLIPROXY_TEST_MODEL=gpt-5.4-mini   # optional chat test model
```

```bash
npm run test:integration
```

Requires `CLIPROXY_BASE_URL`. `CLIPROXY_API_KEY` is optional. The chat-completion test uses `CLIPROXY_TEST_MODEL` when set, otherwise prefers `gpt-5.4-mini`, then the first model from `/v1/models`.

Integration suite verifies:

- Live `/v1/models` fetch and enrichment
- Reasoning metadata from `models.json`
- `opencode models cliproxy` (plugin registration)
- Direct `/v1/chat/completions` against CLIProxyAPI

### Debug

```bash
CLIPROXY_DEBUG=1 opencode --print-logs models cliproxy
```

Logs: `~/.local/share/opencode/log/` (lines tagged `service=cliproxy`).

## Troubleshooting

### Provider not found: `cliproxy`

- Ensure plugin is in `opencode.json` `plugin` array.
- Run `npm run build` if using `file://./dist/index.js`.
- Do **not** use `opencode --pure` (skips external plugins).
- For plugin development from source: use `file://` path to `dist/index.js`.

### No models / connection failed

```bash
curl -H "Authorization: Bearer YOUR_KEY" https://your-host/v1/models
```

- Match `apiKey` with CLIProxyAPI `config.yaml` `api-keys`.
- Or leave key empty if CLIProxyAPI has no auth.

### Models lack context limits or thinking levels

Registry enrichment is on by default (CLIProxyAPI GitHub `models.json`). If you disabled it with `"modelsJsonPath": ""`, remove that or point to a local clone / custom URL.

### Stale model list

```typescript
import { clearModelCache } from 'opencode-cliproxiapi-auth/runtime';
clearModelCache();
```

Or keep `refreshOnList: true` (default).

### OpenCode suggests `cliapiproxy` instead of `cliproxy`

You may have a manual `cliapiproxy` provider in global `opencode.json`. This plugin registers **`cliproxy`** — use `cliproxy/<model-id>`.

## Related

- [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)
- [OpenCode](https://opencode.ai)
- [opencode-omniroute-auth](https://github.com/Alph4d0g/opencode-omniroute-auth) — reference plugin

## License

MIT