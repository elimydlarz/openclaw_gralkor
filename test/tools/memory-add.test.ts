import { describe, it, expect, beforeEach } from "vitest";
import { GralkorInMemoryClient } from "@susu-eng/gralkor-ts/testing";
import { runMemoryAdd } from "../../src/tools/memory-add.js";
import { setSessionGroup, resetSessionMap } from "../../src/session-map.js";

describe("memory_add tool", () => {
  let client: GralkorInMemoryClient;

  beforeEach(() => {
    client = new GralkorInMemoryClient();
    resetSessionMap();
  });

  it("calls GralkorClient.memoryAdd with groupId + content + sourceDescription", async () => {
    setSessionGroup("sess-1", "user-1");
    client.setResponse("memoryAdd", { ok: true });

    const result = await runMemoryAdd(client, {
      sessionKey: "sess-1",
      content: "Eli prefers tea",
      sourceDescription: "observation",
    });

    expect(result).toEqual({ ok: true });
    expect(client.adds).toEqual([["user_1", "Eli prefers tea", "observation"]]);
  });

  it("passes null sourceDescription when not provided", async () => {
    setSessionGroup("sess-1", "user-1");
    client.setResponse("memoryAdd", { ok: true });

    await runMemoryAdd(client, { sessionKey: "sess-1", content: "x" });

    expect(client.adds).toEqual([["user_1", "x", null]]);
  });

  it("surfaces client errors without falling back", async () => {
    setSessionGroup("sess-1", "user-1");
    client.setResponse("memoryAdd", { error: "boom" });

    const result = await runMemoryAdd(client, { sessionKey: "sess-1", content: "x" });

    expect(result).toEqual({ error: "boom" });
  });

  it("returns session_not_registered when the sessionKey is unknown", async () => {
    const result = await runMemoryAdd(client, {
      sessionKey: "unregistered",
      content: "x",
    });

    expect(result).toEqual({ error: "session_not_registered" });
    expect(client.adds).toEqual([]);
  });
});
