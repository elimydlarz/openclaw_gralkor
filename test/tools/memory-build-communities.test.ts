import { describe, it, expect, beforeEach } from "vitest";
import { GralkorInMemoryClient } from "../../src/gralkor/testing.js";
import { runMemoryBuildCommunities } from "../../src/tools/memory-build-communities.js";

describe("memory_build_communities tool", () => {
  let client: GralkorInMemoryClient;

  beforeEach(() => {
    client = new GralkorInMemoryClient();
  });

  it("calls GralkorClient.buildCommunities with the given groupId", async () => {
    client.setResponse("buildCommunities", { ok: { communities: 3, edges: 17 } });

    const result = await runMemoryBuildCommunities(client, { groupId: "user_1" });

    expect(result).toEqual({ ok: { communities: 3, edges: 17 } });
    expect(client.communitiesBuilds).toEqual([["user_1"]]);
  });

  it("surfaces client errors without falling back", async () => {
    client.setResponse("buildCommunities", { error: "gralkor_down" });

    const result = await runMemoryBuildCommunities(client, { groupId: "user_1" });

    expect(result).toEqual({ error: "gralkor_down" });
  });
});
