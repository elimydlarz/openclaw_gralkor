import { describe, it, expect, beforeEach } from "vitest";
import { GralkorInMemoryClient } from "@susu-eng/gralkor-ts/testing";
import { runAgentEnd } from "../../src/hooks/agent-end.js";
import { setSessionGroup, resetSessionMap } from "../../src/session-map.js";
import type { MessageEntry } from "../../src/ctx-to-turn.js";

describe("agent_end hook", () => {
  let client: GralkorInMemoryClient;

  const okMessages: MessageEntry[] = [
    { role: "user", content: "hello" },
    { role: "assistant", content: [{ type: "text", text: "hi" }] },
  ];

  beforeEach(() => {
    client = new GralkorInMemoryClient();
    resetSessionMap();
  });

  it("calls GralkorClient.capture with the Turn when autoCapture is enabled and ctx is valid", async () => {
    setSessionGroup("sess-1", "user-1");
    client.setResponse("capture", { ok: true });

    const result = await runAgentEnd(client, {
      sessionKey: "sess-1",
      messages: okMessages,
      autoCapture: true,
    });

    expect(result).toEqual({ ok: true });
    expect(client.captures).toHaveLength(1);
    const [sessionId, groupId, turn] = client.captures[0];
    expect(sessionId).toBe("sess-1");
    expect(groupId).toBe("user_1");
    expect(turn).toEqual({
      user_query: "hello",
      assistant_answer: "hi",
      events: [],
    });
  });

  it("skips capture when autoCapture is disabled", async () => {
    setSessionGroup("sess-1", "user-1");

    const result = await runAgentEnd(client, {
      sessionKey: "sess-1",
      messages: okMessages,
      autoCapture: false,
    });

    expect(result).toEqual({ ok: true });
    expect(client.captures).toEqual([]);
  });

  it("skips capture when messages are empty", async () => {
    setSessionGroup("sess-1", "user-1");

    const result = await runAgentEnd(client, {
      sessionKey: "sess-1",
      messages: [],
      autoCapture: true,
    });

    expect(result).toEqual({ ok: true });
    expect(client.captures).toEqual([]);
  });

  it("skips capture when ctxToTurn yields null (no user or no assistant)", async () => {
    setSessionGroup("sess-1", "user-1");

    const result = await runAgentEnd(client, {
      sessionKey: "sess-1",
      messages: [{ role: "user", content: "unanswered" }],
      autoCapture: true,
    });

    expect(result).toEqual({ ok: true });
    expect(client.captures).toEqual([]);
  });

  it("surfaces client errors on capture failure", async () => {
    setSessionGroup("sess-1", "user-1");
    client.setResponse("capture", { error: "gralkor_down" });

    const result = await runAgentEnd(client, {
      sessionKey: "sess-1",
      messages: okMessages,
      autoCapture: true,
    });

    expect(result).toEqual({ error: "gralkor_down" });
  });

  it("returns session_not_registered when groupId is missing (safety net — before_prompt_build should have registered)", async () => {
    client.setResponse("capture", { ok: true });

    const result = await runAgentEnd(client, {
      sessionKey: "unregistered",
      messages: okMessages,
      autoCapture: true,
    });

    expect(result).toEqual({ error: "session_not_registered" });
    expect(client.captures).toEqual([]);
  });
});
