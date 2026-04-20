import { describe, it, expect, beforeEach } from "vitest";
import { GralkorInMemoryClient } from "@susu-eng/gralkor-ts/testing";
import { runMemoryBuildIndices } from "../../src/tools/memory-build-indices.js";

describe("memory_build_indices tool", () => {
  let client: GralkorInMemoryClient;

  beforeEach(() => {
    client = new GralkorInMemoryClient();
  });

  it("calls GralkorClient.buildIndices and returns the status", async () => {
    client.setResponse("buildIndices", { ok: { status: "stored" } });

    const result = await runMemoryBuildIndices(client);

    expect(result).toEqual({ ok: { status: "stored" } });
    expect(client.indicesBuilds).toEqual([[]]);
  });

  it("surfaces client errors without falling back", async () => {
    client.setResponse("buildIndices", { error: "gralkor_down" });

    const result = await runMemoryBuildIndices(client);

    expect(result).toEqual({ error: "gralkor_down" });
  });
});
