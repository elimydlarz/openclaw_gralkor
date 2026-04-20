# openclaw_gralkor

OpenClaw plugin that adapts [Gralkor](https://github.com/elimydlarz/gralkor) — a Graphiti + FalkorDB memory server — into the OpenClaw plugin lifecycle. Wires three hooks (auto-recall, auto-capture, session-end), exposes two tools (`memory_search`, `memory_add`), and spawns the Python server under OpenClaw's managed-service lifecycle.

## Mental Model

- **`@susu-eng/gralkor-ts` dep** owns the HTTP client, the Python-subprocess manager, and the boot-readiness helper. This plugin is pure harness glue on top of that adapter.
- **Server-side ownership.** The Python server owns capture buffering (session-keyed append + idle flush + session_end flush + retries), per-turn behaviour distillation, and recall-result interpretation. None of that exists client-side here. The plugin posts turns; the server does the thinking.
- **Per-turn capture.** Each `agent_end` invocation is one turn. The plugin extracts `{user_query, assistant_answer, events}` from the OpenClaw context and `POST /capture`s it. Multiple turns for the same session accumulate in the server's capture buffer; the server flushes on idle or on explicit `POST /session_end`.
- **Session identity.** `session_id` is derived from OpenClaw's `sessionKey` (falling back to `agentId`, then `"default"`). `group_id` is the sanitised `agentId` — per-agent graph partition; agents never see each other's memory. Mapping lives in a module-level Map so concurrent plugin reloads within one process share it.
- **Fail-fast.** Gralkor HTTP errors surface as `{ error }` from `gralkor-ts`'s `GralkorHttpClient`. The hooks let them propagate; OpenClaw decides.
- **Native indexer.** `before_prompt_build` fires a fire-and-forget scan of the workspace (`MEMORY.md` + `memory/*.md`) and calls `memoryAdd` for new content. Marker-based idempotence keeps re-runs cheap.

## Dependencies

- **`@susu-eng/gralkor-ts`** — the adapter. Provides `GralkorHttpClient`, `GralkorInMemoryClient` (tests), `waitForHealth`, `createServerManager`, `sanitizeGroupId`.
- **`openclaw`** — the host plugin API. Peer dep.

## Test Trees

### before_prompt_build hook

```
before_prompt_build
  when the hook fires
    then the session's groupId is registered in the session map (sanitised from agentId)
    then the native indexer is fired fire-and-forget (scans workspace/MEMORY.md + workspace/memory/*.md)
  when autoRecall is enabled and a user query can be extracted from the trailing messages
    then GralkorClient.recall is called with (groupId, sessionId, query)
    when recall returns { ok: block }
      then block is injected into the prompt as prependContext
    when recall returns { ok: null }
      then no context is injected
    if recall returns { error: _ }
      then the hook lets the error surface (no silent fallback)
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
    then ctx is converted to a single Turn { user_query, assistant_answer, events }
    then GralkorClient.capture(sessionId, groupId, turn) is called
    when capture returns { ok: true }
      then the hook completes silently (server owns buffering + flush)
    if capture returns { error: _ }
      then the hook lets the error surface
  when messages are empty
    then capture is not called
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

### ctxToTurn

```
ctxToTurn
  when the ctx has a trailing user message and a final assistant message
    then user_query is the trailing user message text
    and assistant_answer is the final assistant message text
    and events is the list of intermediate messages (thinking, tool calls, tool results) between them, in order
  when the ctx has no trailing user message
    then ctxToTurn returns null (signalling skip-capture to the hook)
  when the ctx has no final assistant message
    then ctxToTurn returns null
  when the ctx is empty
    then ctxToTurn returns null
```

### session-map

```
session-map
  when setSessionGroup(sessionKey, agentId) is called
    then sessionKey is mapped to sanitizeGroupId(agentId) in a module-level Map
  when getSessionGroup(sessionKey) is called and the sessionKey was previously set
    then the sanitised groupId is returned
  when getSessionGroup(sessionKey) is called and the sessionKey was never set
    then null is returned (caller decides whether to fall back or error)
  when resolveSessionId(sessionKey, agentId) is called
    then sessionKey is used if present
    and agentId is used if sessionKey is absent
    and "default" is used if both are absent
```

### memory_search tool

```
memory_search tool
  when the tool is invoked with a query and session context
    then GralkorClient.memorySearch(groupId, sessionId, query) is called
    when the client returns { ok: text }
      then the tool result is text (server-side interpretation, no client-side LLM)
    if the client returns { error: _ }
      then the tool surfaces the error
  when the session's groupId is not registered
    then the tool returns an explicit "session not registered" error (does not fall back to "default")
```

### memory_add tool

```
memory_add tool
  when the tool is invoked with content and session context
    then GralkorClient.memoryAdd(groupId, content, sourceDescription) is called
    when the client returns { ok: true }
      then the tool returns a success message (server queues for async ingest)
    if the client returns { error: _ }
      then the tool surfaces the error
  when sourceDescription is omitted
    then null is passed to the client (server defaults to "manual")
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
  when the tool is invoked
    then GralkorClient.buildCommunities is called with the groupId for the current session
    when the client returns { ok: { communities, edges } }
      then the tool result reports the community and edge counts
    if the client returns { error: _ }
      then the tool surfaces the error
  when the session's groupId is not registered
    then the tool returns session_not_registered (does not fall back to "default")
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

### plugin lifecycle

```
plugin-lifecycle
  when the plugin loads
    then the Python server manager is started via gralkor-ts (spawns uvicorn on port 4000, polls /health) — gralkor-ts owns the bundled server runtime; this plugin does not ship its own server files
    then register() fires manager.start() fire-and-forget immediately (self-start) — OpenClaw does not call api.registerService().start for memory-kind plugins, so relying on that alone leaves uvicorn unspawned and every hook fails with "fetch failed"
    then api.registerService({id: "gralkor-server", start, stop}) is also registered so OpenClaw has a handle for graceful shutdown (stop on SIGTERM)
    then a module-level Map<sessionKey, groupId> is initialised
    then the three hooks (before_prompt_build, agent_end, session_end) and four tools (memory_search, memory_add, memory_build_indices, memory_build_communities) are registered with OpenClaw
  when the plugin is reloaded in-process (OpenClaw reloads plugins multiple times per event)
    then the module-level Map and the server manager singleton persist across reloads (no duplicate spawn)
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
