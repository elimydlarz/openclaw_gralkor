# @susu-eng/openclaw-gralkor

OpenClaw memory plugin powered by [Gralkor](https://github.com/elimydlarz/gralkor) — a temporally-aware knowledge-graph memory service (Graphiti + FalkorDB). This package is the OpenClaw harness that supervises the Gralkor Python server, wires its HTTP API into OpenClaw hooks, and exposes `memory_search` and `memory_add` as tools.

For non-OpenClaw uses see [`@susu-eng/gralkor-ts`](https://www.npmjs.com/package/@susu-eng/gralkor-ts) (the underlying TypeScript adapter this plugin builds on) or the [Gralkor monorepo](https://github.com/elimydlarz/gralkor).

## Install

```bash
openclaw plugins install @susu-eng/openclaw-gralkor --dangerously-force-unsafe-install
```

(The install-time security scanner flags Gralkor as critical because of the embedded Python server. Inspect the source if you'd like to verify there's nothing weird going on.)

Then configure before enabling:

```bash
openclaw config set plugins.entries.gralkor.config.dataDir /path/to/gralkor-data
openclaw config set plugins.entries.gralkor.config.googleApiKey 'your-key-here'   # or OPENAI/ANTHROPIC/GROQ

openclaw config set --json plugins.allow '["gralkor"]'
openclaw config set plugins.entries.gralkor.enabled true
openclaw config set plugins.slots.memory gralkor
openclaw config set --json tools.alsoAllow '["gralkor"]'
```

Restart OpenClaw. First boot takes 1–2 min while `uv sync` resolves Graphiti + falkordblite; subsequent starts reuse the venv.

## What this plugin does

Three hooks + two tools, all fed by the Gralkor HTTP API:

- **`before_prompt_build`** — registers the session's group, scans workspace memory files for new content (`MEMORY.md`, `memory/*.md`), and auto-recalls relevant facts which get injected into the prompt.
- **`agent_end`** — posts the just-finished turn to `/capture`. The Gralkor server owns the capture buffer and flushes on idle (default 5 min) or on explicit session-end.
- **`session_end`** — posts `/session_end` to flush the session's buffer now instead of waiting for the idle window.
- **`memory_search` tool** — `POST /tools/memory_search`. The server does a slow-mode graph search + LLM interpretation and returns a single text blob.
- **`memory_add` tool** — `POST /tools/memory_add`. Fire-and-forget; the server queues the add for async Graphiti extraction.

Compared to previous versions of this plugin: the client-side debouncer, flush retry loop, SIGTERM handler, transcript distillation, and LLM interpretation are all **gone**. Those behaviours moved server-side — this plugin is now a thin lifecycle harness on top of `@susu-eng/gralkor-ts`.

## Session and group identity

- `session_id` is OpenClaw's `sessionKey` (falling back to `agentId`, then `"default"`).
- `group_id` is the sanitised `agentId` (hyphens replaced with underscores — a RediSearch constraint). Per-agent graph partition; agents never see each other's memory.

`before_prompt_build` is the single writer of the `sessionKey → groupId` map. Tools and later hooks look up that map — if `session_not_registered` errors appear, it means the tool fired before `before_prompt_build`, which shouldn't happen under normal OpenClaw flow.

## Configuration

Set under `plugins.entries.gralkor.config` in `~/.openclaw/openclaw.json`. See `openclaw.plugin.json` for the full schema; the useful knobs are:

- **`dataDir`** *(required)* — writable directory for the Python venv + FalkorDB database.
- **`autoCapture.enabled`** *(default: true)* — post `/capture` at the end of every agent run.
- **`autoRecall.enabled`** *(default: true)* — call `/recall` at prompt-build time.
- **`autoRecall.maxResults`** *(default: 10)* — cap on facts injected.
- **`search.maxResults` / `search.maxEntityResults`** — cap on `memory_search` results.
- **`llm` / `embedder`** — provider + model override (defaults: Gemini).
- **`googleApiKey` / `openaiApiKey` / `anthropicApiKey` / `groqApiKey`** — one is required.
- **`test`** *(default: false)* — verbose server-side logging.

## Testing

Unit tests use `GralkorInMemoryClient` from `@susu-eng/gralkor-ts/testing` — real behaviour, no network, no Python. Full suite in 43 tests via `pnpm test`.

## Development

```bash
pnpm install
pnpm run build
pnpm run test
openclaw plugins install -l .   # link this local checkout
```

## License

MIT.
