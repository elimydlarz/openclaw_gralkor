import { describe, it, expect, beforeEach } from "vitest";
import { GralkorInMemoryClient } from "../../src/gralkor/testing.js";
import { runMemorySearch } from "../../src/tools/memory-search.js";

describe("memory_search tool", () => {
  let client: GralkorInMemoryClient;

  beforeEach(() => {
    client = new GralkorInMemoryClient();
  });

  it("calls GralkorClient.recall with the given groupId + sessionKey + query", async () => {
    client.setResponse("recall", { ok: "Facts:\n- tea" });

    const result = await runMemorySearch(client, {
      query: "preferences",
      groupId: "user_1",
      sessionKey: "sess-1",
      agentName: "TestAgent",
    });

    expect(result).toEqual({ ok: "Facts:\n- tea" });
    expect(client.recalls).toEqual([["user_1", "sess-1", "preferences", "TestAgent", undefined]]);
  });

  it("forwards maxResults to the client when configured", async () => {
    client.setResponse("recall", { ok: "ok" });

    await runMemorySearch(client, {
      query: "preferences",
      groupId: "user_1",
      sessionKey: "sess-1",
      agentName: "TestAgent",
      maxResults: 7,
    });

    expect(client.recalls).toEqual([["user_1", "sess-1", "preferences", "TestAgent", 7]]);
  });

  it("surfaces client errors without falling back", async () => {
    client.setResponse("recall", { error: "boom" });

    const result = await runMemorySearch(client, {
      query: "q",
      groupId: "user_1",
      sessionKey: "sess-1",
      agentName: "TestAgent",
    });

    expect(result).toEqual({ error: "boom" });
  });
});
