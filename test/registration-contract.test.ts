import { describe, it, expect, beforeEach } from "vitest";
import type { GralkorClient } from "@susu-eng/gralkor-ts";
import { GralkorInMemoryClient } from "@susu-eng/gralkor-ts/testing";
import { registerHooks, registerTools } from "../src/register.js";
import { resetSessionMap, setSessionGroup } from "../src/session-map.js";
import { makeApi, makeConfig, type TestApi } from "./helpers.js";

describe("registration-contract — hooks invoke requireSessionKey at their boundary", () => {
  let client: GralkorClient;
  let api: TestApi;

  beforeEach(() => {
    resetSessionMap();
    client = new GralkorInMemoryClient();
    api = makeApi();
    registerHooks(api, client, makeConfig());
  });

  for (const event of ["before_prompt_build", "agent_end", "session_end"] as const) {
    it(`${event} throws when ctx has no sessionKey`, async () => {
      const handler = api.handlers.get(event)!;
      await expect(
        handler({ messages: [] }, { agentId: "user-1" }),
      ).rejects.toThrow(/Gralkor requires a non-blank session_id/);
    });

    it(`${event} throws when ctx.sessionKey is blank`, async () => {
      const handler = api.handlers.get(event)!;
      await expect(
        handler({ messages: [] }, { sessionKey: "", agentId: "user-1" }),
      ).rejects.toThrow(/Gralkor requires a non-blank session_id/);
    });
  }
});

describe("registration-contract — tools invoke requireSessionKey at their boundary", () => {
  let client: GralkorClient;
  let api: TestApi;

  beforeEach(() => {
    resetSessionMap();
    client = new GralkorInMemoryClient();
    api = makeApi();
    registerTools(api, client, makeConfig());
  });

  // pi-agent-core's AgentTool.execute is dispatched as
  // `(toolCallId, params, signal, onUpdate)` — model-supplied params arrive
  // as the SECOND argument. Tests here mirror that real call shape; binding
  // params as the first argument silently coerces them to the toolCallId
  // string and drops every model-supplied field.
  type ToolExecute = (
    toolCallId: string,
    args: Record<string, unknown>,
  ) => Promise<unknown>;
  type RegisteredTool = { name: string; execute: ToolExecute };

  for (const toolName of [
    "memory_search",
    "memory_add",
    "memory_build_communities",
  ] as const) {
    it(`${toolName} execute throws when ctx has no sessionKey`, async () => {
      const factory = api.toolFactories[0];
      const tools = factory({ agentId: "user-1" }) as RegisteredTool[];
      const tool = tools.find((t) => t.name === toolName)!;
      await expect(
        tool.execute("call-1", { query: "q", content: "c" }),
      ).rejects.toThrow(/Gralkor requires a non-blank session_id/);
    });

    it(`${toolName} execute throws when ctx.sessionKey is blank`, async () => {
      const factory = api.toolFactories[0];
      const tools = factory({ sessionKey: "", agentId: "user-1" }) as RegisteredTool[];
      const tool = tools.find((t) => t.name === toolName)!;
      await expect(
        tool.execute("call-1", { query: "q", content: "c" }),
      ).rejects.toThrow(/Gralkor requires a non-blank session_id/);
    });
  }

  it("memory_build_indices execute does not require a sessionKey (whole-graph admin)", async () => {
    const factory = api.toolFactories[0];
    const tools = factory({}) as RegisteredTool[];
    const tool = tools.find((t) => t.name === "memory_build_indices")!;
    (client as GralkorInMemoryClient).setResponse("buildIndices", {
      ok: { status: "ok" },
    });
    await expect(tool.execute("call-1", {})).resolves.toMatch(/Indices rebuilt/);
  });
});

describe("registration-contract — model-supplied params reach the client", () => {
  let client: GralkorInMemoryClient;
  let api: TestApi;

  beforeEach(() => {
    resetSessionMap();
    client = new GralkorInMemoryClient();
    api = makeApi();
    setSessionGroup("sess-1", "user-1");
    registerTools(api, client, makeConfig());
  });

  type ToolExecute = (
    toolCallId: string,
    args: Record<string, unknown>,
  ) => Promise<unknown>;
  type RegisteredTool = { name: string; execute: ToolExecute };

  it("memory_search forwards args.query (second positional arg) to GralkorClient.recall", async () => {
    client.setResponse("recall", { ok: "Facts:\n- tea" });
    const factory = api.toolFactories[0];
    const tools = factory({ sessionKey: "sess-1", agentId: "user-1" }) as RegisteredTool[];
    const tool = tools.find((t) => t.name === "memory_search")!;

    await tool.execute("call-1", { query: "preferences" });

    expect(client.recalls).toEqual([["user_1", "sess-1", "preferences", 20]]);
  });

  it("memory_add forwards args.content + args.source_description to GralkorClient.memoryAdd", async () => {
    client.setResponse("memoryAdd", { ok: true });
    const factory = api.toolFactories[0];
    const tools = factory({ sessionKey: "sess-1", agentId: "user-1" }) as RegisteredTool[];
    const tool = tools.find((t) => t.name === "memory_add")!;

    await tool.execute("call-1", {
      content: "Eli prefers tea",
      source_description: "telegram",
    });

    expect(client.adds).toEqual([["user_1", "Eli prefers tea", "telegram"]]);
  });

  it("memory_add passes null sourceDescription when source_description is omitted", async () => {
    client.setResponse("memoryAdd", { ok: true });
    const factory = api.toolFactories[0];
    const tools = factory({ sessionKey: "sess-1", agentId: "user-1" }) as RegisteredTool[];
    const tool = tools.find((t) => t.name === "memory_add")!;

    await tool.execute("call-1", { content: "Eli prefers tea" });

    expect(client.adds).toEqual([["user_1", "Eli prefers tea", null]]);
  });
});
