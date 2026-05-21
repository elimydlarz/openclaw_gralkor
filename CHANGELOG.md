# Changelog

## [2.2.0] - 2026-05-21

### Added
- `pluginConfig.interpretMaxOutputTokens` (optional positive integer). When set, every recall HTTP call carries the value as the server's interpret output budget; when unset, the bundled server applies its 2000-token default. Raise this for wide-recall workloads where the default truncates and surfaces as `InterpretParseFailed` in the server logs. `resolveConfig` validates and throws on non-positive / non-integer values.

### Changed
- `@susulabs/gralkor-ts` pin bumped to `^2.1.0` to pick up `GralkorHttpClient`'s new `interpretMaxOutputTokens` constructor option and the server's `output_token_budget` kwarg / `InterpretParseFailed` typed exception.

## [2.1.13] - 2026-05-18

- Re-published to pick up `@susulabs/gralkor-ts` v2.0.0 (`wheelRepo` is now a required option on `createServerManager`; the plugin already supplies it from `package.json`'s `repository.url`). Default LLM model upstream is now `gemini-3.1-flash-lite` (GA — `-preview` suffix removed).

## [2.1.12] - 2026-05-18

### Added
- Memory capability declaration via `api.registerMemoryCapability` so OpenClaw 2026.5.x routes the `plugins.slots.memory` slot through this plugin; `openclaw plugins info @susulabs/gralkor` now reports `Shape: memory capability` (previously `non-capability`). The capability is intentionally minimal — a static `promptBuilder` briefing the agent on `memory_search` / `memory_add`, and a `flushPlanResolver` that returns `null` so OpenClaw's compaction-flush turn is skipped (per-turn capture lives in the `agent_end` hook).

### Fixed
- Per-turn capture stopped firing after the first agent run on OpenClaw 2026.5.x. The plugin's process-wide `globalThis[Symbol.for("@susulabs/gralkor:registered")]` flag survived plugin hot-reloads (OpenClaw rebuilds the plugin registry from scratch on every agent run), so the second-and-later loads early-returned without re-binding hooks or tools. `openclaw plugins info` reported `hookCount: 0` despite the boot log showing the plugin loaded. The flag is gone; `register()` re-binds on every call. Server-manager construction stays a process-singleton via a module-level slot, so hot-reload doesn't race on port 4000.
