import { describe, it, expect, beforeEach } from "vitest";
import { GralkorInMemoryClient } from "../../src/gralkor/testing.js";
import { runMemorySearch } from "../../src/tools/memory-search.js";
import { setSessionGroup, resetSessionMap } from "../../src/session-map.js";

describe("memory_search tool", () => {
  let client: GralkorInMemoryClient;

  beforeEach(() => {
    client = new GralkorInMemoryClient();
    resetSessionMap();
  });

  it("calls GralkorClient.recall with registered groupId + sessionKey + query", async () => {
    setSessionGroup("sess-1", "user-1");
    client.setResponse("recall", { ok: "Facts:\n- tea" });

    const result = await runMemorySearch(client, {
      query: "preferences",
      sessionKey: "sess-1",
      agentName: "TestAgent",
    });

    expect(result).toEqual({ ok: "Facts:\n- tea" });
    expect(client.recalls).toEqual([["user_1", "sess-1", "preferences", "TestAgent", undefined]]);
  });

  it("forwards maxResults to the client when configured", async () => {
    setSessionGroup("sess-1", "user-1");
    client.setResponse("recall", { ok: "ok" });

    await runMemorySearch(client, {
      query: "preferences",
      sessionKey: "sess-1",
      agentName: "TestAgent",
      maxResults: 7,
    });

    expect(client.recalls).toEqual([["user_1", "sess-1", "preferences", "TestAgent", 7]]);
  });

  it("surfaces client errors without falling back", async () => {
    setSessionGroup("sess-1", "user-1");
    client.setResponse("recall", { error: "boom" });

    const result = await runMemorySearch(client, {
      query: "q",
      sessionKey: "sess-1",
      agentName: "TestAgent",
    });

    expect(result).toEqual({ error: "boom" });
  });

  it("returns an explicit error when the session's groupId is not registered", async () => {
    const result = await runMemorySearch(client, {
      query: "q",
      sessionKey: "unregistered",
      agentName: "TestAgent",
    });

    expect(result).toEqual({ error: "session_not_registered" });
    expect(client.recalls).toEqual([]);
  });
});
