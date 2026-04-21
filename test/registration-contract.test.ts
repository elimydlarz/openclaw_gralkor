import { describe, it, expect, beforeEach } from "vitest";
import type { GralkorClient } from "@susu-eng/gralkor-ts";
import { GralkorInMemoryClient } from "@susu-eng/gralkor-ts/testing";
import { registerHooks, registerTools } from "../src/register.js";
import { resetSessionMap } from "../src/session-map.js";
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
    it(`${event} throws when the event has no sessionKey`, async () => {
      const handler = api.handlers.get(event)!;
      await expect(handler({ agentId: "user-1", messages: [] })).rejects.toThrow(
        /Gralkor requires a non-blank session_id/,
      );
    });

    it(`${event} throws when the event's sessionKey is blank`, async () => {
      const handler = api.handlers.get(event)!;
      await expect(
        handler({ sessionKey: "", agentId: "user-1", messages: [] }),
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
    registerTools(api, client);
  });

  for (const toolName of [
    "memory_search",
    "memory_add",
    "memory_build_communities",
  ] as const) {
    it(`${toolName} execute throws when ctx has no sessionKey`, async () => {
      const factory = api.toolFactories[0];
      const tools = factory({ agentId: "user-1" }) as {
        name: string;
        execute: (args: Record<string, string>) => Promise<unknown>;
      }[];
      const tool = tools.find((t) => t.name === toolName)!;
      await expect(
        tool.execute({ query: "q", content: "c" }),
      ).rejects.toThrow(/Gralkor requires a non-blank session_id/);
    });

    it(`${toolName} execute throws when ctx.sessionKey is blank`, async () => {
      const factory = api.toolFactories[0];
      const tools = factory({ sessionKey: "", agentId: "user-1" }) as {
        name: string;
        execute: (args: Record<string, string>) => Promise<unknown>;
      }[];
      const tool = tools.find((t) => t.name === toolName)!;
      await expect(
        tool.execute({ query: "q", content: "c" }),
      ).rejects.toThrow(/Gralkor requires a non-blank session_id/);
    });
  }

  it("memory_build_indices execute does not require a sessionKey (whole-graph admin)", async () => {
    const factory = api.toolFactories[0];
    const tools = factory({}) as {
      name: string;
      execute: () => Promise<string>;
    }[];
    const tool = tools.find((t) => t.name === "memory_build_indices")!;
    (client as GralkorInMemoryClient).setResponse("buildIndices", {
      ok: { status: "ok" },
    });
    await expect(tool.execute()).resolves.toMatch(/Indices rebuilt/);
  });
});
