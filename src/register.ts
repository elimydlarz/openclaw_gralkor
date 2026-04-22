import {
  GralkorHttpClient,
  createServerManager,
  sanitizeGroupId,
  waitForHealth,
  GRALKOR_URL,
  type GralkorClient,
  type ServerManager,
} from "@susu-eng/gralkor-ts";
import { buildSecretEnv, type GralkorPluginConfig } from "./config.js";
import type { MemoryPluginApi } from "./types.js";
import { runMemorySearch } from "./tools/memory-search.js";
import { runMemoryAdd } from "./tools/memory-add.js";
import { runMemoryBuildIndices } from "./tools/memory-build-indices.js";
import { runMemoryBuildCommunities } from "./tools/memory-build-communities.js";
import { runBeforePromptBuild } from "./hooks/before-prompt-build.js";
import { runAgentEnd } from "./hooks/agent-end.js";
import { runSessionEnd } from "./hooks/session-end.js";
import { runNativeIndexer } from "./native-indexer.js";
import { requireSessionKey } from "./session-map.js";

export interface RegisterContext {
  api: MemoryPluginApi;
  config: GralkorPluginConfig;
  version: string;
}

export function registerTools(
  api: MemoryPluginApi,
  client: GralkorClient,
  config: GralkorPluginConfig,
): void {
  api.registerTool((ctx) => {
    const rawSessionKey = ctx?.sessionKey;
    return [
      {
        name: "memory_search",
        description:
          "Search long-term memory for relevant context. Use specific, focused queries.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "The search query" },
          },
          required: ["query"],
        },
        execute: async (_toolCallId: string, args: { query: string }) => {
          const r = await runMemorySearch(client, {
            query: args.query,
            sessionKey: requireSessionKey(rawSessionKey),
            maxResults: config.search.maxResults,
            maxEntityResults: config.search.maxEntityResults,
          });
          if ("error" in r) throw new Error(JSON.stringify(r.error));
          return r.ok;
        },
      },
      {
        name: "memory_add",
        description:
          "Store a thought, insight, reflection, or decision in long-term memory.",
        parameters: {
          type: "object",
          properties: {
            content: { type: "string" },
            source_description: { type: "string" },
          },
          required: ["content"],
        },
        execute: async (
          _toolCallId: string,
          args: { content: string; source_description?: string },
        ) => {
          const r = await runMemoryAdd(client, {
            sessionKey: requireSessionKey(rawSessionKey),
            content: args.content,
            sourceDescription: args.source_description,
          });
          if ("error" in r) throw new Error(JSON.stringify(r.error));
          return "Queued for storage.";
        },
      },
      {
        name: "memory_build_indices",
        description:
          "ADMIN — DO NOT CALL unless the user has explicitly asked you to rebuild Gralkor's graph search indices. This is an operator-maintenance action; calling it unprompted wastes time without improving anything the user will notice. Idempotent rebuild of the graph search indices.",
        parameters: { type: "object", properties: {} },
        execute: async () => {
          const r = await runMemoryBuildIndices(client);
          if ("error" in r) throw new Error(JSON.stringify(r.error));
          return `Indices rebuilt (${r.ok.status}).`;
        },
      },
      {
        name: "memory_build_communities",
        description:
          "ADMIN — DO NOT CALL unless the user has explicitly asked you to build Gralkor communities. This is an expensive operator-maintenance action; calling it unprompted wastes time. Runs Graphiti community detection over this agent's memory partition.",
        parameters: { type: "object", properties: {} },
        execute: async () => {
          const r = await runMemoryBuildCommunities(client, {
            sessionKey: requireSessionKey(rawSessionKey),
          });
          if ("error" in r) throw new Error(JSON.stringify(r.error));
          return `Built ${r.ok.communities} communities across ${r.ok.edges} edges.`;
        },
      },
    ];
  });
}

/**
 * OpenClaw dispatches hooks as `handler(event, ctx)`. Identity fields
 * (sessionKey, agentId, sessionId, workspaceDir, …) live on `ctx`; the
 * `event` carries only the hook-specific payload (messages, prompt,
 * durationMs, …). See OPENCLAW_INTEGRATION_2026-04-02.md for the full
 * argument contract.
 */
type HookCtx = {
  sessionKey?: string;
  agentId?: string;
  sessionId?: string;
  workspaceDir?: string;
};

export function registerHooks(
  api: MemoryPluginApi,
  client: GralkorClient,
  config: GralkorPluginConfig,
): void {
  api.on(
    "before_prompt_build",
    async (
      event: { messages?: { role: string; content: unknown }[] },
      ctx: HookCtx,
    ) => {
      const sessionKey = requireSessionKey(ctx.sessionKey);
      const agentId = ctx.agentId ?? sessionKey;

      // Fire-and-forget native indexer — doesn't block the prompt build.
      const workspaceDir = ctx.workspaceDir ?? config.workspaceDir;
      if (workspaceDir) {
        void runNativeIndexer(client, workspaceDir, sanitizeGroupId(agentId)).catch((err) => {
          console.error("[gralkor] native-index error:", err);
        });
      }

      const result = await runBeforePromptBuild(client, {
        sessionKey,
        agentId,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        messages: (event.messages ?? []) as any,
        autoRecall: config.autoRecall.enabled,
        maxResults: config.autoRecall.maxResults,
      });
      if ("error" in result) throw new Error(JSON.stringify(result.error));
      return result.ok;
    },
  );

  api.on(
    "agent_end",
    async (
      event: { messages?: { role: string; content: unknown }[] },
      ctx: HookCtx,
    ) => {
      const sessionKey = requireSessionKey(ctx.sessionKey);
      const result = await runAgentEnd(client, {
        sessionKey,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        messages: (event.messages ?? []) as any,
        autoCapture: config.autoCapture.enabled,
      });
      if ("error" in result) throw new Error(JSON.stringify(result.error));
    },
  );

  api.on("session_end", async (_event: unknown, ctx: HookCtx) => {
    const sessionKey = requireSessionKey(ctx.sessionKey);
    const result = await runSessionEnd(client, { sessionKey });
    if ("error" in result) throw new Error(JSON.stringify(result.error));
  });
}

export function registerServerService(
  api: MemoryPluginApi,
  config: GralkorPluginConfig,
  version: string,
): ServerManager {
  if (!config.dataDir) {
    throw new Error(
      "[gralkor] dataDir is required — set plugins.entries.openclaw-gralkor.config.dataDir",
    );
  }

  // serverDir defaults to the bundled Python server shipped inside
  // @susu-eng/gralkor-ts — no override needed here.
  const manager = createServerManager({
    dataDir: config.dataDir,
    port: 4000,
    version,
    secretEnv: buildSecretEnv(config),
    llmConfig: config.llm,
    embedderConfig: config.embedder,
    ontologyConfig: config.ontology,
    test: config.test,
  });

  api.registerService({
    id: "gralkor-server",
    start: async () => {
      await manager.start();
      const client = new GralkorHttpClient({ baseUrl: GRALKOR_URL });
      await waitForHealth(client, { timeoutMs: 120_000, backoffMs: 500 });
    },
    stop: () => manager.stop(),
  });

  // Self-start. OpenClaw does not call service.start() for memory-kind plugins,
  // so relying on the registerService hook alone leaves uvicorn unspawned and
  // every hook fails with "fetch failed". Fire-and-forget here; errors surface
  // via the server-manager's own logs.
  void manager.start().catch((err) => {
    console.error(
      "[gralkor] boot: self-start failed:",
      err instanceof Error ? err.message : err,
    );
  });

  return manager;
}
