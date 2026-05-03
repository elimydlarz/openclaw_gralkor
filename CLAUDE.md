# openclaw_gralkor

OpenClaw plugin that adapts [Gralkor](https://github.com/elimydlarz/gralkor) — a Graphiti + FalkorDB memory server — into the OpenClaw plugin lifecycle. Wires three hooks (auto-recall, auto-capture, session-end), exposes two tools (`memory_search`, `memory_add`) — both the auto-recall hook and the `memory_search` tool call the single `GralkorClient.recall` path (no separate slow-search endpoint), and spawns the Python server under OpenClaw's managed-service lifecycle.

## Mental Model

- **`@susu-eng/gralkor-ts` dep** owns the HTTP client, the Python-subprocess manager, and the boot-readiness helper. This plugin is pure harness glue on top of that adapter.
- **Server-side ownership.** The Python server owns capture buffering (session-keyed append + explicit session_end flush + lifespan-shutdown flush + retries), per-turn behaviour distillation, and recall-result interpretation. None of that exists client-side here. The plugin posts turns; the server does the thinking. Session lifetime is the harness's responsibility — the server has no idle-flush policy.
- **Per-turn capture.** Each `agent_end` invocation is one turn. The plugin extracts `{user_query, assistant_answer, events}` from the OpenClaw context and `POST /capture`s it. Multiple turns for the same session accumulate in the server's capture buffer; OpenClaw fires `session_end` on idle-rollover (next message after the freshness window expires) or explicit reset (`/new`, `/reset`), and the `session_end` hook here drives `POST /session_end` to flush.
- **Harness-specific filtering lives here.** The Gralkor server is harness-agnostic — it stores what it receives. This adapter is the only layer that knows OpenClaw's conventions, so it's responsible for (a) skipping `agent_end` events that come from harness-internal sub-agent runs (e.g. `sessionKey === "temp:slug-generator"`, whose prompt embeds an inline dump of the real conversation) and synthetic turns (session-reset meta-prompt starting with `"A new session was started via /new or /reset"`), and (b) stripping harness scaffolding from real user content (`Conversation info (untrusted metadata):` and `Sender (untrusted metadata):` ```json envelope blocks) before it reaches `user_query`. Filter rules are sourced from OpenClaw (`src/hooks/llm-slug-generator.ts`, `src/auto-reply/reply/session-reset-prompt.ts`) — keep them pinned to those files.
- **Session identity.** `session_id` is OpenClaw's `sessionKey` — required. Missing/blank sessionKey fails loudly; there is no `"default"` bucket. `group_id` is the sanitised `agentId` — per-agent graph partition; agents never see each other's memory. Mapping lives in a module-level Map so concurrent plugin reloads within one process share it.
- **Mode-gated register().** OpenClaw calls `register(api)` once per `api.registrationMode` it cares about — `"cli-metadata"` to enumerate CLI commands, `"setup-only"` / `"setup-runtime"` for lifecycle phases, `"full"` for actual activation (see OpenClaw's `src/plugins/loader.ts` and the SDK's `defineChannelPluginEntry` in `src/plugin-sdk/core.ts`). This plugin only does work in `"full"`; every other mode returns immediately. Within `"full"`, a `globalThis[Symbol.for("@susu-eng/openclaw-gralkor:registered")]` flag is the backstop in case `"full"` is delivered more than once.
- **Recall is best-effort; capture / session_end still fail-fast.** `before_prompt_build` logs a warning and returns `{ ok: {} }` if recall fails — memory-unavailable should not turn into a user-visible turn failure, and the Vertex-upstream retries live at the google-genai SDK (see `gralkor/TEST_TREES.md › Retry ownership`). `agent_end` and `session_end` still surface Gralkor HTTP errors from `gralkor-ts`'s `GralkorHttpClient` so OpenClaw decides — server-unreachable during capture is a distinct failure class that should not be silently swallowed.
- **Native indexer.** `before_prompt_build` fires a fire-and-forget scan of the workspace (`MEMORY.md` + `memory/*.md`) and calls `memoryAdd` for new content. Marker-based idempotence keeps re-runs cheap.

## Dependencies

- **`@susu-eng/gralkor-ts`** — the adapter. Provides `GralkorHttpClient`, `GralkorInMemoryClient` (tests), `waitForHealth`, `createServerManager`, `sanitizeGroupId`.
- **`openclaw`** — the host plugin API. Peer dep.

## Test Trees

### before_prompt_build hook

```
before_prompt_build
  when the hook fires with a sessionKey
    then the session's groupId is registered in the session map (sanitised from agentId)
    then the native indexer is fired fire-and-forget (scans workspace/MEMORY.md + workspace/memory/*.md)
  when autoRecall is enabled and a user query can be extracted from the trailing messages
    then GralkorClient.recall is called with (groupId, sessionId, query, autoRecall.maxResults)
    when recall returns { ok: block }
      then block is injected into the prompt as prependContext
    if recall returns { error: _ }
      then the hook logs a warning via console.warn naming the error and returns { ok: {} } — the turn continues without memory context under the retry-ownership doctrine (Vertex-upstream retries live at the google-genai SDK; see `gralkor/TEST_TREES.md › Retry ownership`)
  when autoRecall is disabled
    then recall is not called
  when no user query can be extracted (empty/system-only trailing messages)
    then recall is not called
```

### agent_end hook

```
agent_end
  when autoCapture is disabled
    then capture is not called
  when autoCapture is enabled and messages are present
    then ctx is converted via ctxToMessages to a canonical [%{role, content}] sequence
      ordered user → behaviour(s) → assistant
    then GralkorClient.capture(sessionId, groupId, messages) is called with that sequence
    when capture returns { ok: true }
      then the hook completes silently (server owns buffering + flush)
    if capture returns { error: _ }
      then the hook lets the error surface
  when messages are empty
    then capture is not called
  when ctx.sessionKey is "temp:slug-generator" (OpenClaw's transient slug-generator sub-agent)
    then capture is not called (harness-internal run, not a real user turn)
  when the canonical user message starts with the OpenClaw session-reset meta-prompt ("A new session was started via /new or /reset")
    then capture is not called (synthetic greeting turn, not real user content)
  when the hook fires with a sessionKey that isn't registered in the session map
    then the hook returns session_not_registered (safety net — before_prompt_build should have registered it)
```

### session_end hook

```
session_end
  when the hook fires with a registered sessionKey
    then GralkorClient.endSession(sessionId) is called
    when endSession returns { ok: true }
      then the hook completes silently (server handles the flush async)
    if endSession returns { error: _ }
      then the hook lets the error surface
  when the hook fires with an unregistered sessionKey
    then endSession is not called (nothing to flush)
```

### ctxToMessages

```
ctxToMessages
  when the ctx has a trailing user message and a final assistant message
    then the first message in the result is the trailing user content as %{role: "user"}
    and the last message is the final assistant content as %{role: "assistant"}
    and each intermediate ctx entry is rendered as a %{role: "behaviour"} message in order,
      with content shaped for the server's distillation LLM (e.g. "thought: …", "tool NAME ← …",
      "toolResult: …")
    when an intermediate entry has no useful content
      then no behaviour message is emitted for it
  when the ctx has no trailing user message
    then ctxToMessages returns null (signalling skip-capture to the hook)
  when the ctx has no final assistant message
    then ctxToMessages returns null
  when the ctx is empty
    then ctxToMessages returns null
  when the user content has a leading "Conversation info (untrusted metadata):" ```json block (OpenClaw channel-envelope scaffolding)
    then the block is stripped from the user message content
  when the user content has a leading "Sender (untrusted metadata):" ```json block
    then the block is stripped from the user message content
  when both metadata blocks precede the user text
    then both are stripped in sequence and the user message holds the clean remainder
  when both blocks precede the user text in reverse order (Sender then Conversation info)
    then both are stripped and the user message holds the clean remainder (order-insensitive)
  when a metadata-shaped block appears mid-content after real user text
    then nothing is stripped (only leading blocks are harness scaffolding)
  when the user content does not start with a metadata block
    then the user message content is returned unchanged
  when the assistant content contains metadata-looking text
    then the assistant message is not modified (stripping applies only to the user message)
```

### session-map

```
session-map
  setSessionGroup / getSessionGroup
    when setSessionGroup(sessionKey, agentId) is called
      then sessionKey is mapped to sanitizeGroupId(agentId) in a module-level Map
    when setSessionGroup is called twice for the same sessionKey
      then the second value overwrites the first
    when getSessionGroup(sessionKey) is called and the sessionKey was previously set
      then the sanitised groupId is returned
    when getSessionGroup(sessionKey) is called and the sessionKey was never set
      then null is returned (caller surfaces session_not_registered)
  requireSessionKey
    when requireSessionKey is called with a non-blank string
      then it returns the string unchanged
    when requireSessionKey is called with undefined
      then it throws with "Gralkor requires a non-blank session_id"
    when requireSessionKey is called with null
      then it throws with "Gralkor requires a non-blank session_id"
    when requireSessionKey is called with an empty string
      then it throws with "Gralkor requires a non-blank session_id"
```

### memory_search tool

```
memory_search tool
  when the tool is invoked with a query and a registered sessionKey
    then GralkorClient.recall(groupId, sessionId, query, search.maxResults) is called
    when the client returns { ok: block }
      then the tool result is block
    if the client returns { error: _ }
      then the tool surfaces the error
  when the sessionKey is present but not registered in the session map
    then the tool returns "session_not_registered"
```

### memory_add tool

```
memory_add tool
  when the tool is invoked with content and a registered sessionKey
    then GralkorClient.memoryAdd(groupId, content, sourceDescription) is called
    when the client returns { ok: true }
      then the tool returns a success message (server queues for async ingest)
    if the client returns { error: _ }
      then the tool surfaces the error
  when sourceDescription is omitted
    then null is passed to the client (server defaults to "manual")
  when the sessionKey is present but not registered in the session map
    then the tool returns "session_not_registered"
```

### memory_build_indices tool

```
memory_build_indices tool
  when the tool is invoked
    then GralkorClient.buildIndices is called (no arguments — operates on the whole graph)
    when the client returns { ok: { status } }
      then the tool result reports success with the status string
    if the client returns { error: _ }
      then the tool surfaces the error
```

### memory_build_communities tool

```
memory_build_communities tool
  when the tool is invoked with a registered sessionKey
    then GralkorClient.buildCommunities is called with the groupId for the current session
    when the client returns { ok: { communities, edges } }
      then the tool result reports the community and edge counts
    if the client returns { error: _ }
      then the tool surfaces the error
  when the sessionKey is present but not registered in the session map
    then the tool returns "session_not_registered"
```

### native-indexer

```
native-indexer
  when runNativeIndexer(client, workspaceDir, groupId) fires
    when workspaceDir does not exist
      then the indexer skips silently
    when workspaceDir contains MEMORY.md or memory/*.md
      then each file is scanned for a marker at EOF
      when the file has no marker
        then the entire content is sent via GralkorClient.memoryAdd (groupId, content, source=<filename>)
        and the marker is appended to the file
      when the file has a marker at the end
        then the file is skipped (no client call)
      when the file has a marker mid-file
        then only the content after the marker is sent
        and the marker is moved to the new EOF
      when GralkorClient.memoryAdd returns { error: _ }
        then the marker is not moved (the file is left unchanged)
  when any individual file fails
    then the indexer logs the error and continues with the remaining files
```

### registration-contract

```
registration-contract
  each hook and tool invokes requireSessionKey(ctx.sessionKey) at its boundary before any work
    — OpenClaw dispatches hooks as `handler(event, ctx)`, tool factories as `factory(ctx)`,
      and tool `execute` (via pi-agent-core's AgentTool) as `(toolCallId, params, signal, onUpdate)` —
      the model-supplied params arrive as the *second* argument; binding them as the first
      silently coerces them to the toolCallId string and drops every model-supplied field
      (see OPENCLAW_INTEGRATION_2026-04-02.md)
    when before_prompt_build fires with a ctx that has no sessionKey (undefined or blank)
      then the hook throws synchronously before recall, native-index, or session registration
    when agent_end fires with a ctx that has no sessionKey
      then the hook throws synchronously before capture
    when session_end fires with a ctx that has no sessionKey
      then the hook throws synchronously before endSession
    when memory_search.execute runs and the tool-registration ctx lacks a sessionKey
      then execute throws synchronously before any client call
    when memory_add.execute runs and the tool-registration ctx lacks a sessionKey
      then execute throws synchronously before any client call
    when memory_build_communities.execute runs and the tool-registration ctx lacks a sessionKey
      then execute throws synchronously before any client call
  memory_build_indices is the one exception — it is a whole-graph admin operation
    when memory_build_indices.execute runs with a tool-registration ctx that has no sessionKey
      then execute proceeds without requireSessionKey (no per-session scope)
  model-supplied params reach the client through the real dispatch signature
    — execute is invoked as `(toolCallId, params, signal, onUpdate)`; tests must call
      `tool.execute("call-id", { ... })` so a wrapper that reads `args.x` from the first
      positional arg fails loudly instead of silently dropping `x`
    when memory_search.execute is invoked with a registered sessionKey and {query} as params
      then GralkorClient.recall is called with that exact query and the configured search.maxResults cap
    when memory_add.execute is invoked with a registered sessionKey and {content, source_description} as params
      then GralkorClient.memoryAdd is called with that exact content and source description
    when memory_add.execute is invoked without source_description
      then GralkorClient.memoryAdd is called with sourceDescription = null
```

### config

```
config
  resolveConfig
    when resolveConfig is called with an empty object
      then the result equals defaultConfig — autoCapture/autoRecall/search defaults are applied
        and llm / embedder are left undefined so the Python server applies its own defaults
        (single source of truth — the plugin never duplicates server-side provider/model defaults)
    when resolveConfig is called with partial overrides
      then provided fields override defaults and unspecified fields keep their defaults
    when resolveConfig is called with an llm or embedder ModelConfig
      then it is passed through unchanged for `createServerManager` to write into config.yaml
    when resolveConfig is called with api-key fields
      then the keys are passed through unchanged (trimming happens later in buildSecretEnv)
  buildSecretEnv
    when buildSecretEnv is called with no api keys set
      then it returns an empty object
    when buildSecretEnv is called with each provider key set
      then it maps googleApiKey → GOOGLE_API_KEY, openaiApiKey → OPENAI_API_KEY, anthropicApiKey → ANTHROPIC_API_KEY, groqApiKey → GROQ_API_KEY
    when an api-key value has surrounding whitespace
      then the whitespace is trimmed
    when only some api keys are set
      then only those keys appear in the env dict (no empty values)
```

### plugin lifecycle

```
plugin-lifecycle
  plugin manifest exports
    when src/index.ts is imported
      then id is "openclaw-gralkor"
      then kind is "memory"
      then tools lists the four tool names (memory_search, memory_add, memory_build_indices, memory_build_communities)
      then configSchema declares the expected top-level properties (dataDir, workspaceDir, autoCapture, autoRecall, search, test, and the four apiKey fields)
  when register() is called with api.registrationMode set to anything other than "full" (e.g. "cli-metadata", "setup-only", "setup-runtime")
    then register() returns immediately as a no-op — OpenClaw is enumerating CLI commands or running a non-activation lifecycle phase, not asking us to boot. This plugin exposes no CLI commands, so non-full modes have nothing to register.
  when register() is called with api.registrationMode === "full" (or absent, for hosts that predate the field) for the first time in the process AND EXTERNAL_GRALKOR_URL is unset
    then the Python server manager is constructed via gralkor-ts and manager.start() is fired fire-and-forget (self-start) — OpenClaw does not call api.registerService().start for memory-kind plugins, so relying on that alone leaves uvicorn unspawned and every hook fails with "fetch failed"
    then api.registerService({id: "gralkor-server", start, stop}) is registered so OpenClaw has a handle for graceful shutdown (stop on SIGTERM)
    then GralkorHttpClient is constructed with baseUrl = GRALKOR_URL (loopback default)
    then the three hooks (before_prompt_build, agent_end, session_end) are registered with OpenClaw
    then one tool factory is registered with OpenClaw, exposing four tool definitions: memory_search, memory_add, memory_build_indices, memory_build_communities
    then a process-wide "registered" flag is set on globalThis (under Symbol.for("@susu-eng/openclaw-gralkor:registered")) as a backstop in case "full" is delivered more than once (e.g. a registry rebuild within one process)
  when register() is called in "full" mode and the process-wide flag is already set
    then register() returns immediately as a no-op — no second server manager, no second start(), no second hook/tool/service binding
    then the hooks, tools, and service bound on the first call remain in force for the process lifetime
  when register() is called in "full" mode with missing dataDir AND EXTERNAL_GRALKOR_URL is unset
    then registerServerService throws synchronously before any service is registered (fail-fast on config misuse) — the process-wide flag is NOT set, so a later register() with a fixed config can succeed
  when register() is called in "full" mode with EXTERNAL_GRALKOR_URL set in the environment
    then createServerManager is NOT called (no local Python spawn; an externally-managed gralkor server is the source of memory)
    then GralkorHttpClient is constructed with baseUrl = EXTERNAL_GRALKOR_URL
    then waitForHealth is fired fire-and-forget against that URL (so the register pipeline is not blocked by remote-readiness)
    then api.registerService is NOT called (no manager to gracefully stop)
    then the three hooks (before_prompt_build, agent_end, session_end) are registered with OpenClaw against the remote-pointing client
    then one tool factory is registered with OpenClaw against the remote-pointing client, exposing four tool definitions: memory_search, memory_add, memory_build_indices, memory_build_communities
    then dataDir is ignored — it configures only the local-spawn path's venv + falkordblite location, which thin-client mode does not use; whether it is set or unset, present or absent, has no effect
  when the process receives SIGTERM
    then no client-side flush is needed — the Python server's lifespan shutdown handles buffer flushes
```

## Testing

Unit tests run against `GralkorInMemoryClient` from `@susu-eng/gralkor-ts/testing`. No real network, no real Python. Import in tests:

```ts
import { GralkorInMemoryClient } from "@susu-eng/gralkor-ts/testing";
```

Call `reset()` in `setup`, configure canned responses with `setResponse()`, inspect call arrays after.

```bash
pnpm test          # typecheck + unit
pnpm run test:unit
```

## Building & Deploying

- `pnpm run publish:npm -- patch|minor|major|current` — bumps `package.json` + `openclaw.plugin.json`, builds, publishes to npm, tags `v${version}`.
- `pnpm run publish:clawhub -- <level>` — publishes to clawhub. Uses `.clawhubignore` to gate what ships.
- `pnpm run publish:all -- <level>` — both in sequence.

The Python server is not shipped from this repo — it ships inside `@susu-eng/gralkor-ts`, which this plugin depends on. `gralkor-ts` bundles a copy of the monorepo's `server/` at its own build time, and `createServerManager()` resolves `bundledServerDir()` to that copy. `openclaw plugins install @susu-eng/openclaw-gralkor` therefore pulls the server transitively via the gralkor-ts dependency.
