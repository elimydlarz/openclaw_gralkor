import { describe, it, expect, beforeEach } from "vitest";
import { GralkorInMemoryClient } from "../../src/gralkor/testing.js";
import { runMemoryAdd } from "../../src/tools/memory-add.js";

describe("memory_add tool", () => {
  let client: GralkorInMemoryClient;

  beforeEach(() => {
    client = new GralkorInMemoryClient();
  });

  it("calls GralkorClient.memoryAdd with groupId + content + sourceDescription", async () => {
    client.setResponse("memoryAdd", { ok: true });

    const result = await runMemoryAdd(client, {
      groupId: "user_1",
      content: "Eli prefers tea",
      sourceDescription: "observation",
    });

    expect(result).toEqual({ ok: true });
    expect(client.adds).toEqual([["user_1", "Eli prefers tea", "observation"]]);
  });

  it("passes null sourceDescription when not provided", async () => {
    client.setResponse("memoryAdd", { ok: true });

    await runMemoryAdd(client, { groupId: "user_1", content: "x" });

    expect(client.adds).toEqual([["user_1", "x", null]]);
  });

  it("surfaces client errors without falling back", async () => {
    client.setResponse("memoryAdd", { error: "boom" });

    const result = await runMemoryAdd(client, { groupId: "user_1", content: "x" });

    expect(result).toEqual({ error: "boom" });
  });
});
