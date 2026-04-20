import { describe, it, expect, beforeEach, vi } from "vitest";
import { vol, fs as memfsFs } from "memfs";
import { GralkorInMemoryClient } from "@susu-eng/gralkor-ts/testing";
import { runNativeIndexer, GRALKOR_MARKER } from "../src/native-indexer.js";

vi.mock("node:fs", () => memfsFs);
vi.mock("node:fs/promises", () => ({ default: memfsFs.promises, ...memfsFs.promises }));

describe("native-indexer", () => {
  let client: GralkorInMemoryClient;

  beforeEach(() => {
    vol.reset();
    client = new GralkorInMemoryClient();
    client.setResponse("memoryAdd", { ok: true });
  });

  it("skips silently when workspaceDir does not exist", async () => {
    await runNativeIndexer(client, "/nope", "group_a");
    expect(client.adds).toEqual([]);
  });

  it("ingests a fresh MEMORY.md and appends the marker to the file", async () => {
    vol.fromJSON({
      "/ws/MEMORY.md": "Eli prefers tea.\n",
    });

    await runNativeIndexer(client, "/ws", "group_a");

    expect(client.adds).toEqual([["group_a", "Eli prefers tea.", "MEMORY.md"]]);
    const after = memfsFs.readFileSync("/ws/MEMORY.md", "utf8");
    expect(after.trimEnd().endsWith(GRALKOR_MARKER)).toBe(true);
  });

  it("ingests memory/*.md files in sorted order", async () => {
    vol.fromJSON({
      "/ws/memory/002-b.md": "second",
      "/ws/memory/001-a.md": "first",
    });

    await runNativeIndexer(client, "/ws", "group_a");

    expect(client.adds.map((a) => a[2])).toEqual(["memory/001-a.md", "memory/002-b.md"]);
  });

  it("skips a file whose marker is already at EOF", async () => {
    vol.fromJSON({
      "/ws/MEMORY.md": `Stored content\n${GRALKOR_MARKER}\n`,
    });

    await runNativeIndexer(client, "/ws", "group_a");

    expect(client.adds).toEqual([]);
  });

  it("ingests only content after an existing mid-file marker and moves the marker to EOF", async () => {
    vol.fromJSON({
      "/ws/MEMORY.md": `Old content\n${GRALKOR_MARKER}\nNew content\n`,
    });

    await runNativeIndexer(client, "/ws", "group_a");

    expect(client.adds).toEqual([["group_a", "New content", "MEMORY.md"]]);
    const after = memfsFs.readFileSync("/ws/MEMORY.md", "utf8");
    expect(after.endsWith(`${GRALKOR_MARKER}\n`)).toBe(true);
    expect(after).toContain("Old content");
    expect(after).toContain("New content");
  });

  it("does not move the marker if memoryAdd fails", async () => {
    client.setResponse("memoryAdd", { error: "boom" });
    vol.fromJSON({
      "/ws/MEMORY.md": "unchanged content\n",
    });

    await runNativeIndexer(client, "/ws", "group_a");

    const after = memfsFs.readFileSync("/ws/MEMORY.md", "utf8");
    expect(after).toBe("unchanged content\n");
  });

  it("continues indexing the remaining files when one fails", async () => {
    vol.fromJSON({
      "/ws/memory/bad.md": "should error",
      "/ws/memory/good.md": "should succeed",
    });
    // First call errors, second succeeds
    let call = 0;
    client.setResponse("memoryAdd", { ok: true });
    // Use a runtime override so the first add fails
    const origAdd = client.memoryAdd.bind(client);
    client.memoryAdd = async (g, c, s) => {
      call += 1;
      if (call === 1) return { error: "boom" };
      return origAdd(g, c, s);
    };

    await runNativeIndexer(client, "/ws", "group_a");

    expect(call).toBe(2);
  });
});
