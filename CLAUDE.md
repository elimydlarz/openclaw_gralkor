# openclaw_gralkor

OpenClaw plugin (`@gralkor/openclaw` on npm + ClawHub) that embeds the Gralkor memory adapter and Python FastAPI server. Wires three hooks (auto-recall, auto-capture, session-end), exposes four memory tools (`memory_search`, `memory_add`, `memory_build_indices`, `memory_build_communities`), and spawns the bundled Python server under OpenClaw's managed-service lifecycle. The TypeScript adapter (`GralkorClient`, `GralkorHttpClient`, `GralkorInMemoryClient`, `waitForHealth`, `createServerManager`) and the Python server (`server/`, ~232 pytest tests) used to live in the now-deprecated `@susulabs/gralkor-ts` package; they're embedded here.

**Test trees live in [TEST_TREES.md](TEST_TREES.md)** — the canonical contract between intent and tests. The inline tree blocks below are kept here for narrative flow and will be removed in a follow-up sync; treat TEST_TREES.md as authoritative when they disagree.

## Mental Model

- **`@susulabs/gralkor` dep** owns the HTTP client, the Python-subprocess manager, and the boot-readiness helper. This plugin is pure harness glue on top of that adapter.
- **Server-side ownership.** The Python server owns capture buffering (session-keyed append + explicit session_end flush + lifespan-shutdown flush + retries), per-turn behaviour distillation, and recall-result interpretation. None of that exists client-side here. The plugin posts turns; the server does the thinking. Session lifetime is the harness's responsibility — the server has no idle-flush policy.
- **Per-turn capture.** Each `agent_end` invocation is one turn. The plugin extracts `{user_query, assistant_answer, events}` from the OpenClaw context and `POST /capture`s it. Multiple turns for the same session accumulate in the server's capture buffer; OpenClaw fires `session_end` on idle-rollover (next message after the freshness window expires) or explicit reset (`/new`, `/reset`), and the `session_end` hook here drives `POST /session_end` to flush.
- **Harness-specific filtering lives here.** The Gralkor server is harness-agnostic — it stores what it receives. This adapter is the only layer that knows OpenClaw's conventions, so it's responsible for (a) skipping `agent_end` events that come from harness-internal sub-agent runs (e.g. `sessionKey === "temp:slug-generator"`, whose prompt embeds an inline dump of the real conversation) and synthetic turns (session-reset meta-prompt starting with `"A new session was started via /new or /reset"`), and (b) stripping harness scaffolding from real user content (`Conversation info (untrusted metadata):` and `Sender (untrusted metadata):` ```json envelope blocks) before it reaches `user_query`. Filter rules are sourced from OpenClaw (`src/hooks/llm-slug-generator.ts`, `src/auto-reply/reply/session-reset-prompt.ts`) — keep them pinned to those files.
- **Session identity.** `session_id` is OpenClaw's `sessionKey` — required. Missing/blank sessionKey fails loudly; there is no `"default"` bucket. `group_id` is the sanitised `agentId` — per-agent graph partition; agents never see each other's memory. Every hook and tool derives `group_id` independently from its own `ctx.agentId` (`sanitizeGroupId(agentId ?? sessionKey)`, identical to the recall path) at the register boundary — `OpenClawPluginToolContext` carries `agentId`, so tools need nothing from prior hooks. There is **no** shared session→group map: it was a module-level `Map` written only by `before_prompt_build`, so tool calls landing in a Node process that map had never populated (fresh gateway after a restart, or a turn with no prompt-build pass) failed with `session_not_registered` while recall — which already derived its group inline — worked; deriving from `ctx.agentId` everywhere removed that failure class entirely.
- **Mode-gated register(), gated on capability-handler availability — not on `"full"` alone.** OpenClaw calls `register(api)` once per `api.registrationMode` it cares about. 2026.5.7's loader (`resolvePluginRegistrationCapabilities`) splits these modes by whether it wires real capability handlers (`registerTool` / `on` / `registerService`) onto the `api`: `"full"`, `"discovery"`, and `"tool-discovery"` get them; `"cli-metadata"`, `"setup-only"`, `"setup-runtime"` get noops. The **`"tool-discovery"` pass is the one that builds the agent's tool-dispatch map** — if `register()` early-returns there, `memory_search` / `memory_add` never enter the dispatch map and the model's calls resolve to "tool not found" even though the `"full"` activation pass booted the server and auto-recall fires (Bug A, fixed 2026-05-31). So `register()` runs tool + hook + capability wiring in **all three capability-handler modes** and returns immediately only in the metadata-only modes. The **server service (uvicorn singleton) is gated to `"full"` alone** — a discovery pass must not spawn a uvicorn. **No process-wide registered-flag.** OpenClaw 2026.5.x hot-reloads the plugin module on every agent run (re-imports `dist/index.js`, hands a fresh `api` instance whose registry is empty) — a `globalThis` symbol guard survives reloads and silently blocks re-registration, leaving the new registry with zero hooks/tools (`openclaw plugins info` then reports `hookCount: 0`). Hook and tool wiring must therefore happen on *every* capability-handler call. Server-manager construction is the one piece that must stay singleton (a second `createServerManager` racing on port 4000 spawns a second uvicorn); idempotency for that lives at the manager-construction layer, not at register's entrypoint. **Don't diagnose tool availability from `openclaw plugins info`.** Its `Shape:` and `toolNames`/`Tools:` columns do *not* reflect this plugin's tools: `derivePluginInspectShape` (`status-DEJL5ql6.js`) only counts provider/channel/context-engine *capabilityKinds*, so a hook+tool+`registerMemoryCapability` plugin always renders `Shape: non-capability`; and the introspection path loads via a captured `api` that doesn't even expose `registerTool`/`on`/`registerMemoryCapability`, so `toolNames` is blank regardless of health. Both read identical whether the tools work or not — they were the *misleading* signal in Bug A, not the symptom. The real check is whether the live `tool-discovery` pass registers the tools: drive the installed `dist/index.js` `register()` with `registrationMode: "tool-discovery"` and assert the four tools come back.
- **Recall is harness-injected here, not agentic.** The sibling `jido_gralkor` moved recall under the agent's control (LLM authors a focused `memory_search` query on iteration 1 via `tool_choice` forcing through `Jido.AI.Reasoning.ReAct.RequestTransformer`). OpenClaw's plugin SDK has no equivalent: the `before_prompt_build` result is text-only (`systemPrompt` / `prependContext` / `prependSystemContext` / `appendSystemContext`), `llm_input` / `llm_output` are `void` observation hooks, and no hook returns generation options. The only `tool_choice` references in the SDK live inside the OpenAI realtime WS driver — not plugin-facing. A system-prompt nudge alone is a strictly weaker contract than forcing, so we keep the harness-injected `before_prompt_build` → `prependContext` path for now and accept that the OpenClaw stack and the Jido stack diverge in shape on this point. Revisit if OpenClaw exposes a request-override hook upstream.
- **Recall is best-effort; capture / session_end still fail-fast.** `before_prompt_build` logs a warning and returns `{ ok: {} }` if recall fails — memory-unavailable should not turn into a user-visible turn failure, and the Vertex-upstream retries live at the google-genai SDK (see [`TEST_TREES.md › Retry ownership`](TEST_TREES.md#retry-ownership)). `agent_end` and `session_end` still surface Gralkor HTTP errors from `gralkor-ts`'s `GralkorHttpClient` so OpenClaw decides — server-unreachable during capture is a distinct failure class that should not be silently swallowed.
- **Native indexer.** `before_prompt_build` fires a fire-and-forget scan of the workspace (`MEMORY.md` + `memory/*.md`) and calls `memoryAdd` for new content. Marker-based idempotence keeps re-runs cheap.

## Dependencies

- **`openclaw`** — the host plugin API. Peer dep.

**Embedded Gralkor TS adapter (internal, not a separate npm package).** As of May 2026, the TypeScript Gralkor adapter and the Python FastAPI server live inside this repo:

- `src/gralkor/` — `GralkorClient` port, `GralkorHttpClient`, `GralkorInMemoryClient`, `waitForHealth`, `createServerManager`, `sanitizeGroupId`, config helpers. Imported by the plugin via `./gralkor/index.js` (or relative path) — not from a registry.
- `server/` — the Python FastAPI app (Graphiti + falkordblite); ships directly in the npm tarball via the `files` field. `createServerManager` spawns it as a managed child on the loopback.
- Test contract suite at `test/gralkor/contract/gralkor-client.contract.ts` — both the in-memory twin and the HTTP client must pass it.

The legacy `@susulabs/gralkor-ts` and `@susulabs/gralkor` packages are deprecated and point here.

## Test Trees

See [TEST_TREES.md](TEST_TREES.md) — the canonical contract between intent and tests for this project.

## Testing

Unit tests run against `GralkorInMemoryClient` from the embedded `src/gralkor/testing.ts`. No real network, no real Python. Import in tests via relative path (depth depends on the test's location, e.g. `../src/gralkor/testing.js` from `test/`, `../../src/gralkor/testing.js` from `test/hooks/`).

Call `reset()` in `setup`, configure canned responses with `setResponse()`, inspect call arrays after.

```bash
pnpm test          # typecheck + unit
pnpm run test:unit
```

## Building & Deploying

- `pnpm run publish:npm -- patch|minor|major|current` — bumps `package.json` + `openclaw.plugin.json`, builds, publishes to npm, tags `v${version}`.
- `pnpm run publish:clawhub -- <level>` — publishes to clawhub. Uses `.clawhubignore` to gate what ships.
- `pnpm run publish:all -- <level>` — both in sequence.

The Python server ships directly in this repo at `server/` and is bundled in the npm tarball via the `files` field. `createServerManager()` resolves `bundledServerDir()` to the tarball's `server/` directory. `openclaw plugins install @gralkor/openclaw` therefore pulls the server alongside the TS code in a single package — no external dependency.
