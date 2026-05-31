import { describe, it, expect, beforeEach } from "vitest";
import { GralkorInMemoryClient } from "../../src/gralkor/testing.js";
import { runSessionEnd } from "../../src/hooks/session-end.js";

describe("session_end hook", () => {
  let client: GralkorInMemoryClient;

  beforeEach(() => {
    client = new GralkorInMemoryClient();
  });

  it("calls GralkorClient.endSession when the hook fires", async () => {
    client.setResponse("endSession", { ok: true });

    const result = await runSessionEnd(client, { sessionKey: "sess-1" });

    expect(result).toEqual({ ok: true });
    expect(client.endSessions).toEqual([["sess-1"]]);
  });

  it("surfaces client errors on endSession failure", async () => {
    client.setResponse("endSession", { error: "gralkor_down" });

    const result = await runSessionEnd(client, { sessionKey: "sess-1" });

    expect(result).toEqual({ error: "gralkor_down" });
  });
});
