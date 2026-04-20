import { describe, it, expect, beforeEach } from "vitest";
import { GralkorInMemoryClient } from "@susu-eng/gralkor-ts/testing";
import { runSessionEnd } from "../../src/hooks/session-end.js";
import { setSessionGroup, resetSessionMap } from "../../src/session-map.js";

describe("session_end hook", () => {
  let client: GralkorInMemoryClient;

  beforeEach(() => {
    client = new GralkorInMemoryClient();
    resetSessionMap();
  });

  it("calls GralkorClient.endSession for a registered sessionKey", async () => {
    setSessionGroup("sess-1", "user-1");
    client.setResponse("endSession", { ok: true });

    const result = await runSessionEnd(client, { sessionKey: "sess-1" });

    expect(result).toEqual({ ok: true });
    expect(client.endSessions).toEqual([["sess-1"]]);
  });

  it("returns { ok: true } without calling the client when sessionKey is unregistered (nothing to flush)", async () => {
    const result = await runSessionEnd(client, { sessionKey: "never-seen" });

    expect(result).toEqual({ ok: true });
    expect(client.endSessions).toEqual([]);
  });

  it("surfaces client errors on endSession failure", async () => {
    setSessionGroup("sess-1", "user-1");
    client.setResponse("endSession", { error: "gralkor_down" });

    const result = await runSessionEnd(client, { sessionKey: "sess-1" });

    expect(result).toEqual({ error: "gralkor_down" });
  });
});
