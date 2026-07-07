# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- GitHub Actions upgraded to `checkout@v6` and `setup-node@v6` (Node 24)
- `README.md` and `AGENTS.md` updated for npm publish and trusted publishing

## [1.0.1] - 2026-07-07

Published via GitHub Actions ([npm trusted publishing](https://docs.npmjs.com/trusted-publishers)).

### Changed

- Provider model output aligned with [opencode.ai/config.json](https://opencode.ai/config.json) (removed `providerID`, `api`, `capabilities`; fixed `cost` and `variants` shape)
- `repository.url` uses GitHub owner casing `GRomR1` (required for OIDC publish)
- CI and publish workflows use Node 24
- npm publish switched from `NPM_TOKEN` to OIDC trusted publishing
- Release workflow fails early if the version already exists on npm

### Fixed

- `config` / `provider` hooks use auth-stored `baseURL` when options omit it
- Fetch interceptor sets `Content-Type` only on POST/PUT/PATCH with body
- Concurrent model fetches deduplicated (singleflight)
- Logger redacts `sk-*` tokens; `formatErrorForLog()` for safe error messages
- Default `modelsJsonPath` when option is omitted; empty string disables enrichment

### Added

- Unit tests: `models-dev`, `logger`, schema-compliant `toProviderModel`, auth baseURL, singleflight
- `examples/provider-localhost.json` sample provider output
- Publish guard for duplicate npm versions

## [1.0.0] - 2026-07-07

Initial public release on [npm](https://www.npmjs.com/package/opencode-cliproxiapi-auth).

### Added

- OpenCode plugin for [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) (`cliproxy` provider)
- `/connect cliproxy` — interactive base URL + optional API key
- Dynamic models from `/v1/models` with TTL cache and fallback defaults
- Enrichment from CLIProxyAPI `models.json` and [models.dev](https://models.dev/)
- Thinking / reasoning variants from `thinking.levels`
- Optional API key (no auth when CLIProxyAPI has no `api-keys`)
- Runtime API (`opencode-cliproxiapi-auth/runtime`)
- Unit and integration test suites
- GitHub Actions CI (`.github/workflows/ci.yml`)

[Unreleased]: https://github.com/GRomR1/opencode-cliproxiapi-auth/compare/v1.0.1...main
[1.0.1]: https://github.com/GRomR1/opencode-cliproxiapi-auth/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/GRomR1/opencode-cliproxiapi-auth/releases/tag/v1.0.0