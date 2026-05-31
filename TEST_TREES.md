# Test Trees — @gralkor/openclaw

These trees are the contract between intent and implementation. Each top-level name is a behaviour; nested `when`/`then` clauses are the spec. Tests in `test/` (TypeScript via vitest) and `server/tests/` (Python via pytest) mirror these one-to-one.

Never modify silently. If implementation has drifted, decide explicitly: update the trees (and tests) to match, or pare the implementation back.

## Canonical turn shape

```
canonical-message
  a captured turn is a list of messages with:
    role ∈ {"user", "assistant", "behaviour"}
    content: str (opaque — adapters render harness-internal events however they like)
  the pipeline never branches on content interior structure — only on
    role (for distillation labels and interpretation context). Anything to strip or rewrite
    (gralkor-memory envelopes, system-line artefacts, etc.) is an adapter concern and lives
    in the harness's adapter, not here.
```

## OpenClaw plugin — hooks and tools

```
before_prompt_build hook (src: src/hooks/before-prompt-build.ts; unit: test/hooks/before-prompt-build.test.ts)
  when the hook fires with a sessionKey
    then the native indexer is fired fire-and-forget (scans workspace/MEMORY.md + workspace/memory/*.md)
  when event.prompt is non-empty (this is the current turn's user input; OpenClaw's SDK splits prompt from conversation history)
    then GralkorClient.recall is called with (groupId = sanitizeGroupId(agentId), sessionId, event.prompt.trim(), pluginConfig.agentName)
    when recall returns { ok: block }
      then block is injected into the prompt as prependContext
    if recall returns { error: _ }
      then the hook logs a warning via console.warn naming the error and returns { ok: {} } — the turn continues without memory context under the retry-ownership doctrine
  when event.prompt is empty or whitespace-only
    then recall is not called
```

```
agent_end hook (src: src/hooks/agent-end.ts; unit: test/hooks/agent-end.test.ts)
  when messages are present
    then ctx is converted via ctxToMessages to a canonical [%{role, content}] sequence
      ordered user → behaviour(s) → assistant
    then GralkorClient.capture(sessionId, groupId = sanitizeGroupId(agentId), pluginConfig.agentName, messages) is called with that sequence
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
```

```
session_end hook (src: src/hooks/session-end.ts; unit: test/hooks/session-end.test.ts)
  when the hook fires
    then GralkorClient.endSession(sessionId) is called (the server is the authority on whether there is anything to flush — an unbuffered session is a 204 no-op there)
    when endSession returns { ok: true }
      then the hook completes silently (server handles the flush async)
    if endSession returns { error: _ }
      then the hook lets the error surface
```

```
ctxToMessages (src: src/ctx-to-messages.ts; unit: test/ctx-to-messages.test.ts)
  when the ctx has a trailing user message and a final assistant message
    then the first message in the result is the trailing user content as %{role: "user"}
    and the last message is the final assistant content as %{role: "assistant"}
    and each intermediate ctx entry is rendered as a %{role: "behaviour"} message in order,
      with content shaped for the server's distillation LLM:
        - reasoning content block → "thought: …"
        - text / output_text content block → "text: …"
        - toolCall / toolUse / tool_use content block → "tool NAME ← {json-args}"
          (codex emits "toolCall"; anthropic-style "toolUse"/"tool_use" also accepted)
        - toolResult / tool_result content block → "tool result → …"
        - entry with role="toolResult" (codex shape: tool output arrives at message-role level
          with text blocks inside) → "toolResult: …" (single line, role wins over inner block type)
      with body cleanup applied to "text:", "toolResult:", and "tool result →":
        - ANSI SGR escape sequences stripped (terminal stdout shouldn't reach the graph)
        - body capped at 500 chars; oversized bodies end with "… [truncated]"
      ("thought:" and tool-call argument JSON are not capped — reasoning summaries are short
      and function args are bounded by the model's own emission size)
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

```
require-session-key (src: src/session-key.ts; unit: test/session-key.test.ts)
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

```
memory_search tool (src: src/tools/memory-search.ts; unit: test/tools/memory-search.test.ts)
  (the groupId is derived from the tool ctx's agentId at the register boundary — see registration-contract)
  when runMemorySearch is called with a groupId, sessionKey, and query
    then GralkorClient.recall(groupId, sessionId, query, agentName, maxResults) is called
    when maxResults is configured
      then it is forwarded to the client
    when the client returns { ok: block }
      then the tool result is block
    if the client returns { error: _ }
      then the tool surfaces the error
```

```
memory_add tool (src: src/tools/memory-add.ts; unit: test/tools/memory-add.test.ts)
  (the groupId is derived from the tool ctx's agentId at the register boundary — see registration-contract)
  when runMemoryAdd is called with a groupId and content
    then GralkorClient.memoryAdd(groupId, content, sourceDescription) is called
    when the client returns { ok: true }
      then the tool returns { ok: true } (server queues for async ingest)
    if the client returns { error: _ }
      then the tool surfaces the error
  when sourceDescription is omitted
    then null is passed to the client (server defaults to "manual")
```

```
memory_build_indices tool (src: src/tools/memory-build-indices.ts; unit: test/tools/memory-build-indices.test.ts)
  when the tool is invoked
    then GralkorClient.buildIndices is called (no arguments — operates on the whole graph)
    when the client returns { ok: { status } }
      then the tool result reports success with the status string
    if the client returns { error: _ }
      then the tool surfaces the error
```

```
memory_build_communities tool (src: src/tools/memory-build-communities.ts; unit: test/tools/memory-build-communities.test.ts)
  (the groupId is derived from the tool ctx's agentId at the register boundary — see registration-contract)
  when runMemoryBuildCommunities is called with a groupId
    then GralkorClient.buildCommunities(groupId) is called
    when the client returns { ok: { communities, edges } }
      then the tool result reports the community and edge counts
    if the client returns { error: _ }
      then the tool surfaces the error
```

```
native-indexer (src: src/native-indexer.ts; unit: test/native-indexer.test.ts)
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

```
registration-contract (src: src/register.ts; unit: test/registration-contract.test.ts)
  each hook and tool invokes requireSessionKey(ctx.sessionKey) at its boundary before any work
    when before_prompt_build fires with a ctx that has no sessionKey (undefined or blank)
      then the hook throws synchronously before recall or native-index
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
  the tool factory derives groupId from its own ctx — no prior before_prompt_build required
    when memory_search.execute is invoked via the real tool factory with a ctx carrying agentId + sessionKey and {query} as params, and no before_prompt_build has run
      then GralkorClient.recall is called with the sanitizeGroupId(agentId)-derived groupId, that exact query, and the configured search.maxResults cap (no "session_not_registered")
    when memory_add.execute is invoked via the real tool factory with a ctx carrying agentId + sessionKey and {content, source_description} as params, and no before_prompt_build has run
      then GralkorClient.memoryAdd is called with the sanitizeGroupId(agentId)-derived groupId, that exact content, and source description (no "session_not_registered")
    when memory_add.execute is invoked without source_description
      then GralkorClient.memoryAdd is called with sourceDescription = null
```

```
config (src: src/config.ts; unit: test/config.test.ts)
  resolveConfig
    when resolveConfig is called without an agentName (or with a blank one)
      then it throws — every consumer must supply the agent's name; there is no fallback to "Assistant"
    when resolveConfig is called with an empty object
      then it throws (agentName is required; same fail-fast as above)
    when resolveConfig is called with a non-blank agentName
      then the result includes agentName verbatim
        and other unspecified fields equal defaultConfig — search defaults are applied
        and llm / embedder are left undefined so the Python server applies its own defaults
        (single source of truth — the plugin never duplicates server-side provider/model defaults)
    when resolveConfig is called with partial overrides (with a non-blank agentName)
      then provided fields override defaults and unspecified fields keep their defaults
    when resolveConfig is called with an llm or embedder ModelConfig
      then it is passed through unchanged for `createServerManager` to write into config.yaml
    when resolveConfig is called with api-key fields
      then the keys are passed through unchanged (trimming happens later in buildSecretEnv)
    when resolveConfig is called without an interpretMaxOutputTokens
      then the result omits interpretMaxOutputTokens — the GralkorHttpClient constructor then omits it from /recall requests and the server falls back to its 2000-token default
    when resolveConfig is called with a positive-integer interpretMaxOutputTokens
      then the value is passed through unchanged for the GralkorHttpClient constructor to forward on every /recall request body
    if interpretMaxOutputTokens is set to a non-positive integer or a non-integer value
      then resolveConfig throws (configuration error surfaces at config-load, not as a downstream HTTP failure)
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

```
plugin-lifecycle (src: src/index.ts; unit: test/plugin-lifecycle.test.ts)
  plugin manifest exports
    when src/index.ts is imported
      then id is "@gralkor/openclaw" (the npm package name)
      then kind is "memory"
      then tools lists the four tool names (memory_search, memory_add, memory_build_indices, memory_build_communities)
      then configSchema declares the expected top-level properties (dataDir, workspaceDir, search, test, the four apiKey fields, and the optional interpretMaxOutputTokens)
  openclaw.plugin.json (the static manifest the OpenClaw 2026.5.7+ loader reads at install time)
    when openclaw.plugin.json is loaded as JSON
      then contracts.tools lists the four tool names (memory_search, memory_add, memory_build_indices, memory_build_communities)
      then version equals package.json version (publish-npm.sh syncs them)
  when register() is called in a metadata-only mode (cli-metadata, setup-only, setup-runtime — modes where OpenClaw exposes no capability handlers on the api)
    then register() returns immediately as a no-op (no tools, hooks, capability, or server service bound, no manager constructed)
  when register() is called in a tool-discovery or discovery mode (OpenClaw's capability-resolution pass that builds the agent's tool-dispatch map — a separate api instance from the full activation pass)
    then one tool factory is registered on this api instance, exposing four tool definitions: memory_search, memory_add, memory_build_indices, memory_build_communities (so the model's memory_search / memory_add calls resolve to an executor instead of "tool not found")
    then the three hooks (before_prompt_build, agent_end, session_end) are registered on this api instance
    then the memory capability is registered (when api.registerMemoryCapability is available) so the pass reports Shape: memory capability
    then no server manager is constructed and api.registerService is not called — the uvicorn singleton belongs to the full activation pass, not a discovery pass
    when dataDir is unset
      then registration still succeeds — dataDir configures the server, which a discovery pass never starts
  when register() is called with api.registrationMode === "full" (or absent, for hosts that predate the field)
    then the three hooks (before_prompt_build, agent_end, session_end) are registered on this api instance
    then one tool factory is registered on this api instance, exposing four tool definitions: memory_search, memory_add, memory_build_indices, memory_build_communities
    then api.registerService({id: "gralkor-server", start, stop}) is registered on this api instance
    then GralkorHttpClient is constructed with baseUrl = GRALKOR_URL (loopback default)
  when register() is called with api.registerMemoryCapability available
    then api.registerMemoryCapability is called with `{ promptBuilder, flushPlanResolver }`
    then the promptBuilder returns static lines (sync) that brief the agent on `memory_search` and `memory_add` usage
    then the flushPlanResolver returns null (sync) — opt out of OpenClaw's compaction-flush turn
  when register() is called and api.registerMemoryCapability is absent (older OpenClaw host)
    then the capability registration is skipped silently
  when register() is called and a server manager has not yet been constructed in this process
    then a fresh server manager is constructed via the embedded gralkor adapter and cached in a module-level slot
    then the manager is constructed with wheelRepo parsed from package.json's repository.url via parseGithubRepoSlug
  when register() is called and a server manager already exists in the module-level slot (e.g. OpenClaw is reloading the plugin in the same process)
    then the cached manager is reused — exactly one uvicorn process per process lifetime, no port-4000 race
  when register() is called in "full" mode with missing dataDir
    then registerServerService throws synchronously before any service is registered (fail-fast on config misuse) and the manager slot is left empty so a later register() with a fixed config can populate it
  when the process receives SIGTERM
    then no client-side flush is needed — the Python server's lifespan shutdown handles buffer flushes
```

## Embedded Gralkor TS adapter — port + clients

```
ts-client (src: src/gralkor/client.ts; unit: test/gralkor/contract/gralkor-client.contract.ts; integration: test/gralkor/client/http.test.ts and test/gralkor/client/in-memory.test.ts)
  when recall is called with a non-blank string session_id and an agent_name
    when max_results is provided
      then it is forwarded to the backend (HTTP body includes max_results; in-memory recorder captures it)
    when max_results is omitted
      then no max_results is forwarded (server applies its default of 10)
    when the backend returns a memory block
      then { ok: block } is returned
    if the backend fails
      then { error: reason } is returned
  when recall is called with a null session_id and an agent_name
    when max_results is provided
      then it is forwarded to the backend (HTTP body includes max_results; in-memory recorder captures it)
    when max_results is omitted
      then no max_results is forwarded (server applies its default of 10)
    when the backend returns a memory block
      then { ok: block } is returned
    if the backend fails
      then { error: reason } is returned
  when capture(session_id, group_id, agent_name, messages) is called
    messages is an array of canonical {role, content} objects (role ∈ "user" | "assistant" | "behaviour")
    when the backend acknowledges the capture
      then { ok: true } is returned
    if the backend fails
      then { error: reason } is returned
    if agent_name is missing or blank
      then the call throws (port-boundary validation; no backend call is made)
  when endSession(session_id) is called
    when the backend acknowledges the end
      then { ok: true } is returned
    if the backend fails
      then { error: reason } is returned
  when memoryAdd(group_id, content, source_description) is called
    when the backend acknowledges the add
      then { ok: true } is returned
    if the backend fails
      then { error: reason } is returned
  when healthCheck() is called
    when the backend is healthy
      then { ok: true } is returned
    if the backend fails
      then { error: reason } is returned
  when buildIndices() is called
    when the backend acknowledges the rebuild
      then { ok: { status } } is returned
    if the backend fails
      then { error: reason } is returned
  when buildCommunities(group_id) is called
    when the backend returns counts
      then { ok: { communities, edges } } is returned
    if the backend fails
      then { error: reason } is returned
  agent_name validation
    if recall or capture is called with a missing or blank agent_name
      then the call throws at the port boundary (no backend call is made)
```

```
ts-sanitize-group-id (src: src/gralkor/client.ts; unit: test/gralkor/client.test.ts)
  when the id contains hyphens
    then hyphens are replaced with underscores
  when the id has consecutive hyphens
    then each hyphen is replaced independently
  when the id has no hyphens
    then it is returned unchanged
```

```
ts-client-http (src: src/gralkor/client/http.ts; integration: test/gralkor/client/http.test.ts)
  then no Authorization header is attached to any request
  if Gralkor responds with a non-2xx status
    then { error: { kind: "http_status", status, body } } is returned
  when recall is called with a non-blank string session_id
    then the session_id field is included in the HTTP body
  when recall is called with a null session_id
    then the session_id field is omitted from the HTTP body
  interpret output budget
    when the constructor is given an interpretMaxOutputTokens option
      then every recall request body includes interpret_max_output_tokens with that value (so the server uses it as the output_token_budget for interpret_facts)
    when the constructor is given no interpretMaxOutputTokens option
      then the recall request body omits interpret_max_output_tokens — the server applies its default (2000)
    if interpretMaxOutputTokens is set to a non-positive integer or a non-integer value
      then the constructor throws (configuration error surfaces at wiring, not as a downstream HTTP failure)
  if capture is called with a blank string session_id
    then the call throws
  if capture is called with a null session_id
    then the call throws
  if endSession is called with a blank string session_id
    then the call throws
  if endSession is called with a null session_id
    then the call throws
  (retry + per-endpoint timeout behaviour is described in ts-client-timeouts)
  runs the shared ts-client port contract (via test/gralkor/contract/gralkor-client.contract.ts)
```

```
ts-client-in-memory (src: src/gralkor/client/in-memory.ts; unit: test/gralkor/client/in-memory.test.ts)
  when an operation is called
    then the call is recorded with its arguments for later inspection
  if no response is configured for an operation
    then { error: "not_configured" } is returned
  when reset() is called
    then configured responses and recorded calls are cleared
  runs the shared ts-client port contract (via test/gralkor/contract/gralkor-client.contract.ts)
```

```
ts-connection (src: src/gralkor/connection.ts; unit: test/gralkor/connection.test.ts)
  when waitForHealth(client, opts) is called
    then client.healthCheck() is polled until it resolves ok or the timeout elapses
    if the backend does not respond healthy within the timeout
      then the promise rejects so the caller can decide whether to retry or fail
  after ready
    then no further polling is scheduled — runtime outages surface on the next actual call
```

```
ts-client-timeouts (integration: test/gralkor/client/http.test.ts)
  if the server returns any non-2xx HTTP response
    then the response surfaces as { error: { kind: "http_status", status, body } }
  if the transport fails with any error
    then the failure surfaces immediately
  per-endpoint receive window (milliseconds)
    /health                 2_000
    /recall                12_000   — matches the server's /recall deadline
    /capture                5_000
    /session_end            5_000
    /tools/memory_add      60_000
  admin endpoints have no client-side deadline
    /build-indices and /build-communities scan the whole graph and can run minutes to hours
    ts adapter passes no AbortController timer (timeoutMs: undefined)
```

## Embedded Gralkor TS adapter — server manager and config

```
ts-server-manager (src: src/gralkor/server-manager.ts; unit: test/gralkor/server-manager.test.ts)
  bundledServerDir
    then resolves to the package's top-level `server/` directory (i.e. <pkg>/server/, two directories up from this module's compiled dist/gralkor/server-manager.js)
  construction
    then serverDir defaults to bundledServerDir() (the in-tree server shipped inside @gralkor/openclaw)
    then consumers may override serverDir to point at a development checkout
    then the returned manager starts with isRunning() === false
  wheelDownloadUrl(wheelRepo, version)
    then returns `https://github.com/${wheelRepo}/releases/download/v${version}/falkordblite-0.9.0-py3-none-manylinux_2_36_aarch64.whl`
    (the URL is purely a function of the two consumer-supplied inputs — there is no default repo)
  wheel resolution (on linux/arm64 only — other platforms install falkordblite from PyPI)
    when serverDir/wheels/*.whl exists
      then the bundled wheel(s) are used directly (npm-tarball path)
    when serverDir/wheels is absent and dataDir/wheels/<wheel> already exists from a prior boot
      then that cached wheel is used (no re-download)
    when no wheel is cached
      then wheelDownloadUrl(opts.wheelRepo, opts.version) is fetched and written under dataDir/wheels/
      if the response is not ok
        then start rejects with `bundled wheel download failed: HTTP ${status} ${url}` (the URL is in the error so the publish-site/version mismatch is diagnosable from one line)
  buildConfigYaml (helper written into config.yaml at start time)
    when neither llmConfig nor embedderConfig nor ontologyConfig nor test is supplied
      then returns the empty string — no llm/embedder section is written and the server applies its own defaults (single source of truth in server/main.py)
    when llmConfig is supplied
      then emits an "llm:" block with the passed provider + model
    when llmConfig is omitted
      then no "llm:" block is written (server fills in defaults)
    when embedderConfig is supplied
      then emits an "embedder:" block with the passed provider + model
    when embedderConfig is omitted
      then no "embedder:" block is written (server fills in defaults)
    when test is true
      then appends "test: true"
    when ontologyConfig is supplied
      then appends the serialised ontology block
  serializeOntologyYaml (helper written into config.yaml at start time)
    when the ontology has entities
      then emits an "ontology: entities:" block with description and optional attribute entries
    when the ontology has edges
      then emits an "edges:" block under ontology
    when the ontology has an edgeMap
      then emits an "edgeMap:" block with "EntityA,EntityB" keys and their edge lists
    when the ontology is empty (no entities, edges, or edgeMap)
      then emits just "ontology:\n"
  start idempotence
    when start() is called twice on the same manager
      then the second call returns the same Promise as the first (no second boot, no second spawn)
    when the first start() rejects
      then subsequent start() calls return the same rejected Promise — the manager is single-shot per construction; consumers retry by recreating it
  start
    then before spawning, prior-run orphans are reaped
      when lsof reports any pid listening on the configured port
        then SIGTERM is sent to each pid
        and the port is polled until free (up to 5s)
        if the port is still bound after SIGTERM
          then SIGKILL is sent and the port is polled again (up to 2s)
          if still bound after SIGKILL
            then start rejects with a clear error
      when pgrep -af reports any process whose argv contains "redislite/bin/redis-server"
        then SIGKILL is sent to each pid
    then uv run uvicorn main:app is spawned with cwd = serverDir
    and env includes GOOGLE_API_KEY / ANTHROPIC / OPENAI / GROQ where supplied
    and /health is polled at 500ms intervals until 200 or the boot window expires
    if /health never returns 200 within the boot window
      then start rejects with a timeout error
  stop
    then a stopping flag is set so the exit handler does not respawn
    when the spawned process is ours
      then SIGTERM is sent and we wait up to STOP_GRACE_MS for clean exit
      if the process is still running after the grace window
        then SIGKILL is sent
  child exit handling
    when the spawned process emits "exit" while the stopping flag is false (unexpected death)
      then the same start path is re-run (orphan reap → spawn → health-poll)
      and the timestamp of the unexpected exit is recorded in a rolling 5s window
      if more than 3 unexpected exits land in any 5s window
        then process.exit(1) is called so the next-level supervisor (Docker restart: unless-stopped in agents/) escalates rather than livelocking on an unrecoverable child
    when the spawned process emits "exit" while the stopping flag is true
      then no respawn is attempted
```

```
validateOntologyConfig (src: src/gralkor/config.ts; unit: test/gralkor/config.test.ts)
  when ontology is undefined
    then does not throw
  when ontology is valid
    then does not throw
  when entity name is a reserved graph label
    then rejects Entity, Episodic, Community, Saga
  when entity attribute uses a protected EntityNode field name
    then rejects uuid, name, group_id, labels, created_at, summary, attributes, name_embedding
  when edge attribute uses a protected EntityEdge field name
    then rejects uuid, group_id, source_node_uuid, target_node_uuid, created_at, name, fact, fact_embedding, episodes, expired_at, valid_at, invalid_at, attributes
  when edgeMap key format is invalid
    then rejects (expected "EntityA,EntityB")
  when edgeMap references undeclared entity
    then rejects
  when edgeMap references undeclared edge
    then rejects
```

## Bundled Python server — endpoints

```
POST /recall endpoint (src: server/main.py; unit: server/tests/test_recall.py)
  request shape
    when the request body includes a non-blank session_id
      then body is {session_id, group_id, agent_name, query, …}
    when the request body omits session_id
      then body is {group_id, agent_name, query, …}
    when the request body includes max_results
      then at most that many facts are returned
    when the request body omits max_results
      then the server applies its default (10)
    when the request body includes interpret_max_output_tokens
      then it is forwarded as the output_token_budget to interpret_facts
    when the request body omits interpret_max_output_tokens
      then interpret_facts applies its default (2000)
    then group_id is sanitized (hyphens → underscores) before use
  if the request body includes a blank session_id
    then 422 is returned (Gralkor requires session_id to be a non-blank string or absent)
  if agent_name is missing or blank
    then 422 is returned
  conversation context
    when the request body includes a non-blank session_id and capture_buffer has an entry for it
      then messages are sourced from capture_buffer.turns_for(session_id), flat-walked
      and every Message in every buffered turn is included in order, with its role label
    when the request body includes a non-blank session_id but capture_buffer has no entry for it
      then interpretation runs with an empty conversation context (no error)
    when the request body omits session_id
      then interpretation runs with an empty conversation context (no error)
      and capture_buffer is not consulted
    when two sessions share a group_id
      then each session's recall sees only its own buffered turns
    then the server never strips or rewrites Message content — adapters hand in clean strings
  when called
    then graphiti.search runs against the sanitized group_id
      when search returns no facts
        then memory_block body is "No relevant memories found."
      when search returns facts
        then interpret_facts is called with the session's buffered conversation and the formatted facts
          when interpret_facts returns relevant facts
            then memory_block body is the list of relevant facts
          when interpret_facts returns []
            then memory_block body is "No relevant memories found."
    and memory_block wraps body in <gralkor-memory trust="untrusted">...</gralkor-memory>
    and memory_block includes the further-querying instruction
  /recall deadline
    then /recall completes within a bounded time budget
    if the budget is exhausted before the handler returns
      then in-flight upstream work is cancelled
      and the response is 504 with {"error": "recall deadline expired"}
  observability
    then logs "[gralkor] recall — session:… group:… queryChars:… max:…" at INFO on every call
    then logs "[gralkor] recall result — <N> facts blockChars:… <ms> (search:… interpret:…)" at INFO on every call
      and interpret:… is 0 when interpret_facts was not called (empty facts)
    when test mode is enabled (logger level DEBUG)
      then also logs "[gralkor] [test] recall query: <raw query>" at DEBUG
      and when facts are returned also logs "[gralkor] [test] recall block: <memory block>" at DEBUG
```

```
recall-interpretation (functional: server/tests/test_recall.py)
  when relevant facts are found
    then memory_block lists them, one per line
    and each entry is the original fact verbatim (preserving every timestamp
      parenthetical: '(created …)', '(valid from …)', '(invalid since …)',
      '(expired …)') followed by ' — ' and a one-sentence relevance reason
  when no relevant facts are found
    then memory_block is "No relevant memories found."
```

```
interpret-facts (src: server/pipelines/interpret.py; unit: server/tests/test_interpret.py)
  takes conversation messages, formatted facts, an llm_client, an agent_name, and an output_token_budget
    if agent_name is missing or blank
      then raises
    when output_token_budget is omitted
      then a default of 2000 is applied
    if output_token_budget is non-positive
      then raises
  calls llm_client with the interpretation context (built via build_interpretation_context with the agent_name) and the response_model
    and llm_client is invoked with max_tokens set to output_token_budget (so the LLM is told the hard ceiling, not the legacy hardcoded 500)
    and the interpretation prompt carries a "respond within {output_token_budget} tokens" instruction so the model self-limits the breadth of its answer
    and the response_model (InterpretResult.relevantFacts) carries a Field
      description instructing the LLM to copy each fact line verbatim
      (preserving every timestamp parenthetical, dropping the leading '- ')
      then ' — ' then a one-sentence relevance reason
    when the LLM returns relevant facts
      then returns the list unchanged (one entry per fact: verbatim original
        fact with timestamps + ' — ' + relevance reason)
    when the LLM returns an empty list
      then returns []
    if the LLM response cannot be parsed against InterpretResult (truncation, schema mismatch)
      then raises InterpretParseFailed (a distinct error class; no partial list is returned)
  when llm_client is None
    then raises
```

```
build_interpretation_context (src: server/pipelines/interpret.py; unit: server/tests/test_interpret.py)
  then takes messages, facts_text, and an agent_name
  if agent_name is missing or blank
    then raises (no fallback — every caller knows the agent's name)
  then renders user messages as "User: {content}"
  then renders assistant messages as "{agent_name}: {content}"
  then renders behaviour messages as "{agent_name}: (behaviour: {content})"
  then drops messages with empty cleaned content
  then assembles context as "Conversation context:\n{messages}\n\nMemory facts to interpret:\n{facts}"
  when total char length exceeds budget
    then oldest messages are dropped until context fits
  then does NOT inspect or mutate content beyond whitespace trimming (no XML stripping,
    no system-line filtering — those are adapter concerns)
```

```
POST /distill endpoint (src: server/main.py; unit: server/tests/test_distill_endpoint.py)
  request shape
    then body is {turns: [[{role, content}, …]]} — each turn is a list of canonical Messages
  then calls format_transcript(turns, graphiti.llm_client)
  then response is {"episode_body": string}
  when multiple turns contain behaviour messages
    then distillation runs in parallel (asyncio.gather) — one LLM call per turn
  when a single turn's distillation raises
    then that turn's behaviour line is silently dropped (empty string)
    and surrounding turns still produce output
  when a turn has only user and assistant messages (no behaviour)
    then rendered as "User: …\nAssistant: …" with no behaviour line, no LLM call
```

```
POST /capture endpoint (src: server/main.py; unit: server/tests/test_capture_endpoint.py; integration: server/tests/test_capture_flush_integration.py)
  request shape
    then body is {session_id, group_id, agent_name, messages: [{role, content}, …]}
    then role ∈ {"user", "assistant", "behaviour"}; content is a string the adapter produced
  if session_id is missing or blank
    then 422 is returned (Gralkor requires a non-blank session_id)
  if agent_name is missing or blank
    then 422 is returned
  then appends the message list to capture_buffer keyed by session_id (group_id is sanitized
    and bound to the entry on first append; agent_name is bound on first append)
  then returns 204 No Content (no body)
  then returns immediately (does not call distill synchronously)
  observability
    when test mode is enabled (logger level DEBUG)
      then logs "[gralkor] [test] capture messages: [(role, content), …]" at DEBUG
  flush (_capture_flush in main.py — fires from /session_end and lifespan shutdown only)
    when the distilled episode body is empty
      then does not call add_episode (no log)
    when the episode is added
      then logs "[gralkor] capture flushed — group:… uuid:… bodyChars:… <ms>" at INFO
    when test mode is enabled
      then also logs "[gralkor] [test] capture flush body: <episode_body>" at DEBUG
```

```
POST /session_end endpoint (src: server/main.py; unit: server/tests/test_session_end_endpoint.py)
  request shape
    then body is {session_id}
  when called for a session_id with buffered turns
    then the session's buffered turns are flushed via the registered callback and retry machinery
    and 204 No Content is returned without awaiting the flush completion
  when called for a session_id with no buffered turns
    then 204 No Content is returned and no flush is scheduled
  if session_id is missing or blank
    then 422 is returned
  observability
    then logs "[gralkor] session_end session:… turns:N" at INFO
```

```
capture-buffer (src: server/pipelines/capture_buffer.py; unit: server/tests/test_capture_buffer.py)
  the buffer holds turns until an explicit flush — session lifetime is owned by the consumer;
  the server has no idle-flush policy
  append
    when called for a new session_id
      then an entry is created bound to the supplied group_id, the supplied agent_name, and the turn (list of Messages)
    when called again for the same session_id
      then the new turn is appended to the existing entry and prior turns remain buffered
    when called for multiple session_ids
      then each session_id has an independent entry
    when called for an existing session_id with a different group_id
      then raises (sessions are not re-bindable across groups)
    when called for an existing session_id with a different agent_name
      then raises (same invariant as group_id — sessions are not re-bindable across agent names)
    if agent_name is missing or blank
      then raises
  turns_for(session_id)
    when the session has buffered turns
      then returns list[list[Message]] in append order — each turn is a list of Messages
    when the session has never been appended to (or was just flushed)
      then returns an empty list
  flush(session_id)
    when called for a session_id with buffered turns
      then flush_callback is scheduled with (group_id, agent_name, list[list[Message]]) derived from the entry
      and the call returns without awaiting the scheduled flush
      and the entry is removed from the buffer
      and subsequent turns_for(session_id) calls return []
    when called for a session_id with no entry
      then returns without scheduling any flush
  retry schedule
    when flush_callback raises a 4xx CaptureClientError
      then does not retry and logs "capture dropped (4xx)" (contract error — non-retryable)
    when flush_callback raises an upstream-LLM error
      then does not retry and logs "capture dropped (upstream error)" — retrying at this layer would amplify load on an already-struggling upstream
    when flush_callback raises any other Exception (server-internal: graph write failure, Falkor driver error, internal distill crash)
      then retries at 1s, 2s, 4s (exponential)
    when flush_callback raises a server-internal error after 3 retries
      then logs "capture exhausted" and drops
  flush_all
    when called with pending entries
      then every entry is flushed via the same callback and retry machinery and awaited
    when called with no entries
      then returns immediately
    when one flush fails and another succeeds
      then the successful flush still completes
  lifespan shutdown
    when FastAPI lifespan enters shutdown
      then capture_buffer.flush_all is awaited
```

```
format-transcript (src: server/pipelines/distill.py; unit: server/tests/test_distill.py)
  inputs
    then takes list[list[Message]] (each turn a list of canonical Messages), an llm_client, and an agent_name
    if agent_name is missing or blank
      then raises
  distill input per turn
    when a turn contains a message with role="behaviour"
      then all messages in the turn are rendered with role labels ("User: {content}",
        "{agent_name}: (behaviour: {content})", "{agent_name}: {content}") and passed to
        the distill LLM as the "thinking" prompt
    when a turn has no behaviour messages
      then distillation is skipped for that turn (no LLM call)
  transcript rendering
    when a turn has behaviour and llm_client is available
      then distilled via llm_client into first-person past-tense summary
      and rendered as "{agent_name}: (behaviour: {summary})" before the assistant text for that turn
    when distillation fails for a turn (safe_distill)
      then behaviour line silently dropped, user/assistant text preserved
    when llm_client is None
      then behaviour lines are silently omitted, user/assistant text preserved
    when a turn has no behaviour
      then rendered as "User: {content}\n{agent_name}: {content}" with no behaviour line, no LLM call
  then passes response_model with a single "behaviour" field to generate_response
  then parallel distillation across turns with behaviour via asyncio.gather
```

```
POST /tools/memory_add endpoint (src: server/main.py; unit: server/tests/test_tools.py)
  request shape
    then body is {group_id, content, source_description?}
  then auto-generates name ("manual-add-" + timestamp_ms)
  then auto-generates idempotency_key (uuid4)
  then calls graphiti.add_episode with source=EpisodeType.text on a Graphiti scoped to the sanitized group_id
  then group_id is sanitized before ingestion
  then passes current ontology (entity_types, edge_types, edge_type_map)
  then response is {"status": "stored"}
  when source_description is omitted
    then defaults to "manual"
```

```
POST /build-indices endpoint (src: server/main.py; unit: server/tests/test_tools.py)
  request shape
    then body is {} (no arguments — the operation runs across the whole graph, not a specific group)
  then calls graphiti.build_indices_and_constraints()
  then response is {"status": string}
  (admin-only — the adapter libraries expose this as an explicit call)
```

```
POST /build-communities endpoint (src: server/main.py; unit: server/tests/test_tools.py)
  request shape
    then body is {group_id}
    then group_id is sanitized before use
  then calls graphiti.build_communities on a Graphiti scoped to the sanitized group_id
  then response is {"communities": non_neg_integer, "edges": non_neg_integer} with the counts produced
  (admin-only — expensive per-group operation)
```

## Bundled Python server — operations and configuration

```
/health endpoint (src: server/main.py)
  then responds in constant time — independent of graph size (no MATCH, no counts)
  when the FalkorDB driver answers a cheap probe
    then returns 200
  if the probe raises or times out
    then returns 503 with an error detail
```

```
rate-limit-retry (src: server/main.py; unit: server/tests/test_recall.py)
  server side
    when upstream LLM returns a rate-limit error
      then 429 response includes Retry-After header
    (client-side retry handling is not part of the adapter — the adapter surfaces the 429 as an error and lets consumers decide)
```

```
_graphiti_for (src: server/main.py; unit: server/tests/test_graphiti_for.py)
  when called with a group_id
    then returns a Graphiti scoped to that group_id
  when called twice with the same group_id
    then returns the same instance both times
  when called with different group_ids
    then returns different instances
```

```
downstream-error-handling (src: server/main.py; unit: server/tests/test_downstream_error_handling.py)
  server side
    when downstream LLM raises an error
      when status is 4xx
        when status is 429
          then handled by rate-limit-retry (not this handler)
        when status is 400
          when message indicates a credential failure (e.g. "API key expired")
            then returns 503 with {"error": "provider error", "detail": "<message>"}
          otherwise
            then returns 500 with {"error": "provider error", "detail": "<message>"}
        when status is 401 or 403
          then returns 503 with {"error": "provider error", "detail": "<message>"}
        when status is 404 or 422
          then returns 500 with {"error": "provider error", "detail": "<message>"}
        when status is any other 4xx
          then returns 502 with {"error": "provider error", "detail": "<message>"}
      when status is 5xx
        then returns 502 with {"error": "provider error", "detail": "<message>"}
      when no recognizable status code
        then propagates as 500
```

```
server-warmup-on-boot (src: server/main.py; unit: server/tests/test_lifespan.py)
  during lifespan startup, after the index check and before yielding to accept traffic
    then graphiti.search is invoked once with a throwaway query and group_id
    then interpret_facts is invoked once with an empty conversation and a throwaway facts_text (LLM client warmup)
    then logs "[gralkor] warmup — search:… interpret:… <total>ms" at INFO
  if any warmup call raises
    then the exception is caught and logged at :warning as "[gralkor] warmup failed (non-fatal): <reason>"
    and boot proceeds — warmup is best-effort
```

```
upstream-idle-survival (src: server/main.py; unit: server/tests/test_upstream_idle_survival.py)
  applies to every server-side call into a Gemini-backed graphiti helper
    (embedder, LLM, reranker) — exercised by /recall, /distill flush,
    /capture flush, /build-indices, /build-communities
  when an endpoint is called after the server has been idle long enough for
    its pooled upstream connection to have gone away
    then the endpoint still responds within its normal latency envelope
```

```
server-config-defaults (src: server/main.py; unit: server/tests/test_lifespan.py)
  when config omits llm.provider
    then _build_llm_client uses DEFAULT_LLM_PROVIDER ("gemini")
  when config omits llm.model and provider is gemini
    then _build_llm_client uses DEFAULT_LLM_MODEL ("gemini-3.1-flash-lite")
  when config omits llm.model and provider is not gemini
    then no model is forced (delegates to graphiti-core provider defaults)
  when config omits embedder.provider
    then _build_embedder uses DEFAULT_EMBEDDER_PROVIDER ("gemini")
  when config omits embedder.model and provider is gemini
    then _build_embedder uses DEFAULT_EMBEDDER_MODEL ("gemini-embedding-2-preview")
  when config sets llm.provider / llm.model explicitly
    then those values take precedence over the defaults
```

```
server-falkordb-bootstrap (src: server/main.py; contract: server/tests/test_redislite_resume_trap.py; unit: server/tests/test_lifespan.py)
  when the FastAPI lifespan enters startup in embedded mode
    then `${FALKORDB_DATA_DIR}/gralkor.db.settings` is removed if present, immediately before constructing AsyncFalkorDB
      (redislite resume-cache trap — under uvicorn-respawn-without-container-restart the previous server's PID becomes a zombie that PID 1 doesn't reap, `kill -0` keeps returning true, and reconnecting to the dead socket raises `ConnectionError` on every retry)
    then AsyncFalkorDB(`${FALKORDB_DATA_DIR}/gralkor.db`) is called, forking a fresh redis-server child for this lifespan
```

```
cross-encoder-selection (src: server/main.py; unit: server/tests/test_cross_encoder.py)
  when llm provider is gemini
    then uses GeminiRerankerClient
  when llm provider is not gemini and OPENAI_API_KEY is set
    then uses OpenAIRerankerClient
  when llm provider is not gemini and OPENAI_API_KEY is not set
    then cross_encoder is None
```

## Retry ownership

```
retry-ownership (stack-wide invariant; unit: none — other tree nodes in this file cite this section)
  then exactly one layer retries any given failure class
  then layers above the owner derive their timeout from that layer's worst case
  then no two layers retry the same class
  failure class: upstream LLM rate-limit (HTTP 429 from the configured provider)
    owner: /recall on the server
      then the first 429 during /recall is absorbed by one retry before surfacing
    then no other endpoint or call site retries this class — 429 surfaces immediately
    then no layer above the owner retries this class
  failure class: upstream LLM other (HTTP 408, 500, 502, 503, 504)
    no owner — surfaces through the server's downstream-error-handling envelope
  failure class: LLM malformed output (structured-output parse failures, refusal)
    owner: graphiti's GeminiClient
      then 2 attempts; the error text is appended to the next prompt
    then no layer above retries this class
  failure class: client ↔ server transport (TCP reset, socket closed, connect timeout between adapter and Gralkor server)
    no owner — the failure surfaces immediately to the plugin
  failure class: server-internal / runtime-internal (graph write failure, FalkorDB driver error, internal distill crash)
    owner for the capture chain: server-side capture_buffer (1s / 2s / 4s exponential)
    for all other chains: no owner — the failure surfaces immediately
  failure class: consumer-budget expired (the outermost timeout at the consumer)
    owner: the consumer (OpenClaw turn budget)
      then returns to the user; logs at :warn; does not retry
```

## Distribution

```
publish-openclaw-gralkor (src: scripts/publish-npm.sh + scripts/publish-clawhub.sh; unit: none)
  when pnpm run publish:all <level> succeeds
    then version is bumped in package.json
    and openclaw.plugin.json version is synced
    and the npm tarball is published to @gralkor/openclaw
    and the ClawHub package is published to @gralkor/openclaw with a GitHub release containing the arm64 wheel
    and a git tag v${version} is created (push manually)
  when the publish process fails partway
    then version-file rollback fires (package.json and openclaw.plugin.json restored to pre-bump)
    and the GitHub release / wheel upload may persist; recovery is `pnpm run publish:<the-other-side> current`
  when level is current
    then version is not incremented
    and the publish still runs against the existing version
  when the ClawHub publish exceeds the 20 MB upload limit
    then it rejects with "invalid multi-part form: 'stream size exceeded limit'" — the wheel must be excluded via .clawhubignore (it ships separately on GitHub Releases and is fetched at runtime by createServerManager's wheel-resolution path)
```
