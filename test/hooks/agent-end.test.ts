import { describe, it, expect, beforeEach } from "vitest";
import { GralkorInMemoryClient } from "@susu-eng/gralkor-ts/testing";
import { runAgentEnd } from "../../src/hooks/agent-end.js";
import { setSessionGroup, resetSessionMap } from "../../src/session-map.js";
import type { MessageEntry } from "../../src/ctx-to-messages.js";

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

  it("calls GralkorClient.capture with a canonical Message[] when autoCapture is enabled and ctx is valid", async () => {
    setSessionGroup("sess-1", "user-1");
    client.setResponse("capture", { ok: true });

    const result = await runAgentEnd(client, {
      sessionKey: "sess-1",
      messages: okMessages,
      autoCapture: true,
    });

    expect(result).toEqual({ ok: true });
    expect(client.captures).toHaveLength(1);
    const [sessionId, groupId, messages] = client.captures[0];
    expect(sessionId).toBe("sess-1");
    expect(groupId).toBe("user_1");
    expect(messages).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ]);
  });

  it("renders intermediate ctx entries as behaviour messages between the user and assistant", async () => {
    setSessionGroup("sess-1", "user-1");
    client.setResponse("capture", { ok: true });

    await runAgentEnd(client, {
      sessionKey: "sess-1",
      messages: [
        { role: "user", content: "what's the weather?" },
        { role: "assistant", content: [{ type: "thinking", thinking: "let me check" }] },
        { role: "assistant", content: [{ type: "toolUse", name: "weather", input: { city: "sf" } }] },
        { role: "toolResult", content: "sunny" },
        { role: "assistant", content: [{ type: "text", text: "it's sunny" }] },
      ],
      autoCapture: true,
    });

    const [, , messages] = client.captures[0];
    expect(messages).toEqual([
      { role: "user", content: "what's the weather?" },
      { role: "behaviour", content: "thought: let me check" },
      { role: "behaviour", content: 'tool weather ← {"city":"sf"}' },
      { role: "behaviour", content: "toolResult: sunny" },
      { role: "assistant", content: "it's sunny" },
    ]);
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

  it("skips capture when ctxToMessages yields null (no user or no assistant)", async () => {
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

  it("skips capture for OpenClaw's transient slug-generator run (sessionKey = 'temp:slug-generator')", async () => {
    setSessionGroup("temp:slug-generator", "any-agent");

    const result = await runAgentEnd(client, {
      sessionKey: "temp:slug-generator",
      messages: [
        {
          role: "user",
          content:
            "Based on this conversation, generate a short 1-2 word filename slug...",
        },
        { role: "assistant", content: [{ type: "text", text: "bug-fix" }] },
      ],
      autoCapture: true,
    });

    expect(result).toEqual({ ok: true });
    expect(client.captures).toEqual([]);
  });

  it("skips capture when the trailing user message is the OpenClaw session-reset meta-prompt", async () => {
    setSessionGroup("sess-1", "user-1");

    const result = await runAgentEnd(client, {
      sessionKey: "sess-1",
      messages: [
        {
          role: "user",
          content:
            "A new session was started via /new or /reset. Run your Session Startup sequence - read the required files before responding to the user.",
        },
        { role: "assistant", content: [{ type: "text", text: "Hey Eli." }] },
      ],
      autoCapture: true,
    });

    expect(result).toEqual({ ok: true });
    expect(client.captures).toEqual([]);
  });
});
