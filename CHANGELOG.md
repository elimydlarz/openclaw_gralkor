# Changelog

## [4.0.3] - 2026-05-31

### Fixed
- `memory_search` and `memory_add` now resolve to executors instead of "tool not found" under OpenClaw 2026.5.7. The plugin's `register()` previously bound tools only in `full` registration mode, but 2026.5.7 builds the agent's tool-dispatch map in a separate `tool-discovery` pass — so the tools never entered the map even though the server booted and auto-recall fired. Registration now wires tools, hooks, and the memory capability in all capability-handler modes (`full`, `discovery`, `tool-discovery`); the bundled Python server is still started only in `full`.

## [4.0.2] - 2026-05-30

### Changed
- The Gralkor TypeScript adapter (`GralkorClient`, `GralkorHttpClient`, `GralkorInMemoryClient`, `waitForHealth`, `createServerManager`, config helpers) is now imported from the in-tree `src/gralkor/` instead of the deprecated `@susulabs/gralkor-ts` package. The plugin is fully self-contained — installing `@gralkor/openclaw` pulls the adapter and the bundled Python server with no external Gralkor dependency. No change to tools, hooks, or config shape.

### Fixed
- `src/index.ts` runtime `export const id` corrected from the stale `@susulabs/gralkor` to `@gralkor/openclaw`, matching the manifest's locked runtime plugin id. The two previously disagreed, which could surface the plugin under the wrong id to code reading the runtime export.

## [4.0.1] - 2026-05-21

### Fixed
- Bundled Python server path resolution. 4.0.0 shipped with `server/server/` (a nested directory created during the merge from `gralkor/ts/server/`) and `server-manager.ts`'s `bundledServerDir()` resolving to `dist/server/` (a non-existent path post-merge). Result: any consumer that actually spawned the server got an immediate path-not-found failure. 4.0.1 ships the server flat at `<pkg>/server/` and `bundledServerDir()` resolves to `../../server` from `dist/gralkor/server-manager.js`. Consumers on 4.0.0 should bump to 4.0.1.

### Changed
- `.clawhubignore` rewritten to whitelist the full `server/` runtime tree (including `pipelines/`) and explicitly exclude `server/wheels/` (the arm64 falkordblite wheel still exceeds ClawHub's 20 MB upload limit; the runtime downloads it from GitHub Releases on first start). 4.0.0 was never on ClawHub — first ClawHub publish is 4.0.1.

## [4.0.0] - 2026-05-21

### Changed
- **BREAKING.** Package renamed from `@susulabs/gralkor` to `@gralkor/openclaw`. The legacy `@susulabs/gralkor` and `@susulabs/gralkor-ts` packages are deprecated on npm and point here. Consumers must update their install command: `openclaw plugins install @gralkor/openclaw@latest`. OpenClaw config keys that reference the plugin by id must change too: `plugins.entries["@gralkor/openclaw"].enabled`, `plugins.slots.memory = "@gralkor/openclaw"`, `plugins.config["@gralkor/openclaw"]`.
- **BREAKING.** Plugin runtime id changed from `@susulabs/gralkor` to `@gralkor/openclaw` to match the new package name. ClawHub locks the runtime id at first publish; this version is the first publish under the new id.
- Absorbed the former `@susulabs/gralkor-ts` npm package. The `GralkorClient` port, `GralkorHttpClient`, `GralkorInMemoryClient`, `waitForHealth`, `createServerManager`, `sanitizeGroupId`, and the Python FastAPI server are now shipped inside this package (under `src/gralkor/` and `server/`). The legacy `@susulabs/gralkor-ts` package is deprecated on npm and points here.

### Preserved (no consumer-visible behaviour change)
- All hooks (`before_prompt_build`, `agent_end`, `session_end`), tools (`memory_search`, `memory_add`, `memory_build_indices`, `memory_build_communities`), the memory capability registration, the native indexer, the session map, and the bundled Python server behave exactly as in 2.2.0.
- Config shape (`pluginConfig`) is unchanged.

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
