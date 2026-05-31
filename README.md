# @gralkor/openclaw

OpenClaw memory plugin powered by Gralkor — a temporally-aware knowledge-graph memory service (Graphiti + FalkorDB). This package is the OpenClaw harness: it embeds the Gralkor TypeScript adapter (`src/gralkor/`) and the Gralkor Python FastAPI server (`server/`, bundled in the npm tarball), supervises that server under OpenClaw's managed-service lifecycle, wires the HTTP API into OpenClaw hooks, and exposes `memory_search`, `memory_add`, `memory_build_indices`, and `memory_build_communities` as tools.

The adapter and server used to live in the now-deprecated `@susulabs/gralkor` / `@susulabs/gralkor-ts` packages; they are embedded here, so installing `@gralkor/openclaw` pulls everything in one package — no external Gralkor dependency.

## Compatibility

Requires OpenClaw `>= 2026.5.7`. Two loader behaviours matter:

- The 2026.5.7 loader gates tool registration on the manifest's `contracts.tools` field — declared in `openclaw.plugin.json`.
- The loader exposes capability handlers (`registerTool` / hooks / `registerService`) in `full`, `discovery`, and `tool-discovery` registration modes, and the `tool-discovery` pass is the one that builds the agent's tool-dispatch map. The plugin registers its tools/hooks in all three of those modes (the uvicorn server service is started only in `full`).

Older builds that registered tools only in `full` mode loaded but their tools resolved to "tool not found"; they are not supported.

## Install

```bash
openclaw plugins install @gralkor/openclaw --dangerously-force-unsafe-install
```

(The install-time security scanner flags Gralkor as critical because this plugin spawns a bundled Python server. Inspect `server/` if you'd like to verify there's nothing weird going on.)

Then configure before enabling — the plugin id is `@gralkor/openclaw`, so config keys carry the full scoped name:

```bash
openclaw config set plugins.entries.'"@gralkor/openclaw"'.config.dataDir /path/to/gralkor-data
openclaw config set plugins.entries.'"@gralkor/openclaw"'.config.googleApiKey 'your-key-here'   # or OPENAI/ANTHROPIC/GROQ
openclaw config set plugins.entries.'"@gralkor/openclaw"'.config.agentName 'YourAgent'

openclaw config set --json plugins.allow '["@gralkor/openclaw"]'
openclaw config set plugins.entries.'"@gralkor/openclaw"'.enabled true
openclaw config set --json plugins.entries.'"@gralkor/openclaw"'.hooks.allowConversationAccess true
openclaw config set plugins.slots.memory '@gralkor/openclaw'
```

`hooks.allowConversationAccess: true` is required — without it OpenClaw blocks the plugin's `agent_end` hook and memory capture stops after each turn.

> The `@` and `/` in the plugin id make `openclaw config set`'s bracket parsing brittle; the canonical way to set these keys is a direct write to `openclaw.json` (this is what the `agents` deployment's `init.sh` does). See `agents/agent/init.sh` for the reference flow.

Restart OpenClaw. First boot takes 1–2 min while `uv sync` resolves Graphiti + falkordblite; subsequent starts reuse the venv.

## What this plugin does

Three hooks + four tools, all fed by the embedded Gralkor HTTP server:

- **`before_prompt_build`** — registers the session's group, scans workspace memory files for new content (`MEMORY.md`, `memory/*.md`), and auto-recalls relevant facts which get injected into the prompt.
- **`agent_end`** — posts the just-finished turn to `/capture` as a canonical `[{role, content}]` message list (user → behaviour(s) → assistant). The Gralkor server owns the capture buffer and flushes on idle or on explicit session-end. OpenClaw-specific filtering happens here: harness-internal sub-agent runs (e.g. `sessionKey === "temp:slug-generator"`) and synthetic turns (the `/new`/`/reset` meta-prompt) are skipped, and `Conversation info` / `Sender` `(untrusted metadata)` envelope blocks are stripped from the user message before capture.
- **`session_end`** — posts `/session_end` to flush the session's buffer now instead of waiting for the idle window.
- **`memory_search` tool** — calls the same `POST /recall` path as the `before_prompt_build` hook. There is no separate slow-search endpoint: manual and auto lookups do identical server work.
- **`memory_add` tool** — `POST /tools/memory_add`. Fire-and-forget; the server queues the add for async Graphiti extraction.
- **`memory_build_indices` / `memory_build_communities` tools** — operator-maintenance actions (rebuild graph search indices; run community detection). Not for routine use — the tool descriptions tell the agent not to call them unprompted.

## Session and group identity

- `session_id` is OpenClaw's `sessionKey` — required at every boundary. Hooks and tools throw synchronously if `ctx.sessionKey` is missing or blank; there is no `"default"` bucket. (OpenClaw's argument shape for hooks and tool factories is documented in `OPENCLAW_INTEGRATION_2026-04-02.md`.)
- `group_id` is the sanitised `agentId` (hyphens replaced with underscores — a RediSearch constraint). Per-agent graph partition; agents never see each other's memory.

`before_prompt_build` is the single writer of the `sessionKey → groupId` map. Tools and later hooks look up that map — if `session_not_registered` errors appear, it means the tool fired before `before_prompt_build`, which shouldn't happen under normal OpenClaw flow.

## Configuration

Set under `plugins.entries["@gralkor/openclaw"].config` in `~/.openclaw/openclaw.json`. See `openclaw.plugin.json` for the full schema; the useful knobs are:

- **`agentName`** *(required)* — display name labelling this agent's turns in stored and recalled memory.
- **`dataDir`** *(required)* — writable directory for the Python venv + FalkorDB database.
- **`search.maxResults`** — cap on facts returned by the `memory_search` tool.
- **`llm` / `embedder`** — provider + model override (defaults: Gemini).
- **`googleApiKey` / `openaiApiKey` / `anthropicApiKey` / `groqApiKey`** — one is required.
- **`interpretMaxOutputTokens`** — output-token budget for the server's interpret pipeline on each recall (unset → server default of 2000).
- **`test`** *(default: false)* — verbose server-side logging.

## Testing

Unit tests use `GralkorInMemoryClient` from the embedded `src/gralkor/testing.ts` — real behaviour, no network, no Python. Full suite runs via `pnpm test` (typecheck + vitest unit + Python pytest under `server/`).

## Development

```bash
pnpm install
pnpm run build
pnpm run test
openclaw plugins install -l .   # link this local checkout
```

## License

MIT.
