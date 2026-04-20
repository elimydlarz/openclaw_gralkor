import { describe, it, expect, beforeEach } from "vitest";
import { GralkorInMemoryClient } from "@susu-eng/gralkor-ts/testing";
import { runMemoryBuildCommunities } from "../../src/tools/memory-build-communities.js";
import { setSessionGroup, resetSessionMap } from "../../src/session-map.js";

describe("memory_build_communities tool", () => {
  let client: GralkorInMemoryClient;

  beforeEach(() => {
    client = new GralkorInMemoryClient();
    resetSessionMap();
  });

  it("calls GralkorClient.buildCommunities with the session's groupId", async () => {
    setSessionGroup("sess-1", "user-1");
    client.setResponse("buildCommunities", { ok: { communities: 3, edges: 17 } });

    const result = await runMemoryBuildCommunities(client, { sessionKey: "sess-1" });

    expect(result).toEqual({ ok: { communities: 3, edges: 17 } });
    expect(client.communitiesBuilds).toEqual([["user_1"]]);
  });

  it("returns session_not_registered when the sessionKey is unknown", async () => {
    const result = await runMemoryBuildCommunities(client, {
      sessionKey: "unregistered",
    });

    expect(result).toEqual({ error: "session_not_registered" });
    expect(client.communitiesBuilds).toEqual([]);
  });

  it("surfaces client errors without falling back", async () => {
    setSessionGroup("sess-1", "user-1");
    client.setResponse("buildCommunities", { error: "gralkor_down" });

    const result = await runMemoryBuildCommunities(client, { sessionKey: "sess-1" });

    expect(result).toEqual({ error: "gralkor_down" });
  });
});
