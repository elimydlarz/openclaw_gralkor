# OpenClaw Integration Notes

OpenClaw's plugin SDK churns between releases. This file captures the
integration points this plugin relies on, pinned to the OpenClaw version
`agents/` currently deploys. Re-verify every section when that version
bumps — don't trust these notes across upgrades without spot-checking
the referenced files in `node_modules/openclaw`.

- **Last verified OpenClaw version:** `2026.4.2`
- **Pinned by:** `agents/secrets/openclaw.env` → `OPENCLAW_TAG=2026.4.2`
- **Incident this file is meant to prevent:** production hooks throwing
  `Gralkor requires a non-blank session_id; OpenClaw did not provide a
  sessionKey` on every turn, because the plugin was reading `sessionKey`
  from the wrong argument.

## The rule that would have prevented the incident

**Hooks are dispatched as `handler(event, ctx)` — two arguments. Identity
fields (sessionKey, agentId, sessionId, workspaceDir, runId, trigger,
channelId) live on `ctx`. The `event` carries only the hook-specific
payload.**

A single-argument handler silently ignores `ctx`, and every identity
field read from the first arg comes back `undefined`.

## The argument contract

### Hook dispatch

OpenClaw's runtime calls every hook as:

```js
handler(event, ctx)
```

Source of truth (pinned version, may shift on upgrade — re-check the
paths before trusting them):

- `node_modules/openclaw/dist/pi-embedded-*.js` —
  `hookRunner.runBeforePromptBuild({ prompt, messages }, ctx)`,
  `hookRunner.runAgentEnd({ messages, success, error, durationMs }, ctx)`
- `node_modules/openclaw/dist/hook-runner-global-*.js` — generic
  `runModifyingHook(name, event, ctx, …)` and `runVoidHook(name, event, ctx)`
  dispatchers used by every hook
- `node_modules/openclaw/dist/plugin-sdk/src/plugins/types.d.ts` —
  `PluginHookHandlerMap` declaring every `(event, ctx)` handler signature

### `ctx` shape (`PluginHookAgentContext`)

For agent-run hooks (`before_prompt_build`, `before_agent_start`,
`before_agent_reply`, `llm_input`, `llm_output`, `agent_end`,
`before_compaction`, `after_compaction`, `before_reset`):

```ts
type PluginHookAgentContext = {
  runId?: string;
  agentId?: string;
  sessionKey?: string;        // ← identity lives here
  sessionId?: string;
  workspaceDir?: string;
  messageProvider?: string;
  trigger?: string;           // "user" | "heartbeat" | "cron" | "memory"
  channelId?: string;         // "telegram" | "discord" | …
};
```

Session lifecycle hooks (`session_start`, `session_end`) use a different
`PluginHookSessionContext`. Subagent, message, tool, dispatch, install,
and gateway hooks each have their own `ctx` type. When touching a new
hook, read its signature in `types.d.ts` before coding against it — do
not assume a shape.

### `event` shapes in use by this plugin

```ts
PluginHookBeforePromptBuildEvent = { prompt: string; messages: unknown[] }
PluginHookAgentEndEvent         = { messages: unknown[]; success: boolean;
                                    error?: string; durationMs?: number }
PluginHookSessionEndEvent       = { sessionId: string; sessionKey?: string;
                                    messageCount: number; durationMs?: number }
```

Note: `PluginHookSessionEndEvent` coincidentally carries `sessionKey?`
on the event too. **Do not rely on that.** Read identity fields from
`ctx` everywhere — it is the uniform boundary contract, and the
optional field on this one event can go away without warning.

### Tool factory dispatch

OpenClaw calls tool factories as:

```js
factory(ctx)
```

— single argument. `ctx` is `OpenClawPluginToolContext` (`types.d.ts`
line ~87). It also carries `sessionKey`, `sessionId`, `agentId`,
`workspaceDir`, `messageChannel`, and trust fields (`requesterSenderId`,
`isOwner`). Tool factories in this plugin already use the correct
single-arg shape; see `src/register.ts` → `registerTools`.

### Tool `execute` dispatch

Inside each tool, `execute(args)` receives only the LLM-provided
arguments. Identity fields must be captured from the factory `ctx` in
the factory closure, not read from `args`. The factory `ctx` is
"trusted" (runtime-supplied); `args` is "untrusted" (LLM-supplied).

## How this plugin applies the rule

- `src/register.ts` → `registerHooks` — every `api.on(name, handler)`
  uses a `(event, ctx)` handler and calls
  `requireSessionKey(ctx.sessionKey)` at the top. `agentId`,
  `workspaceDir` also come from `ctx`. `messages` comes from `event`.
- `src/register.ts` → `registerTools` — single-arg factory; captures
  `ctx.sessionKey` into the factory closure and each tool's `execute`
  calls `requireSessionKey(rawSessionKey)` before any client call.
- `src/session-map.ts` → `requireSessionKey` — single chokepoint for
  the blank/undefined check; fails loudly rather than falling back to
  a `"default"` bucket.

## How the tests enforce the rule

- `test/helpers.ts` — the `makeApi().on` fake stores
  `(event, ctx) => Promise<unknown>` handlers, mirroring OpenClaw's
  dispatch signature. A one-arg fake would hide the whole class of bug
  this file documents.
- `test/registration-contract.test.ts` — invokes each hook handler as
  `handler(event, ctx)` and asserts that a missing or blank
  `ctx.sessionKey` throws before any client call.

When adding a new OpenClaw hook or tool, match those patterns or the
boundary check is defeated.

## Checklist when bumping OpenClaw

1. Update `agents/secrets/openclaw.env` → `OPENCLAW_TAG`.
2. Re-read `node_modules/openclaw/dist/plugin-sdk/src/plugins/types.d.ts`
   for every hook this plugin registers (`before_prompt_build`,
   `agent_end`, `session_end`) and every event shape it touches.
   Confirm the `(event, ctx)` split hasn't shifted fields between the
   two arguments.
3. Confirm `PluginHookAgentContext` still has `sessionKey`, `agentId`,
   `workspaceDir`. If any renamed, update `src/register.ts` and the
   `HookCtx` type there.
4. Confirm `OpenClawPluginToolContext` still has `sessionKey`. If
   renamed, update the `registerTools` factory.
5. Run `pnpm test` — the registration-contract suite is the canary
   for this whole file.
6. Update **Last verified OpenClaw version** above and commit.
