import { describe, it, expect, beforeEach } from "vitest";
import { GralkorInMemoryClient } from "../../src/gralkor/testing.js";
import { runAgentEnd } from "../../src/hooks/agent-end.js";
import type { MessageEntry } from "../../src/ctx-to-messages.js";

describe("agent_end hook", () => {
  let client: GralkorInMemoryClient;

  const okMessages: MessageEntry[] = [
    { role: "user", content: "hello" },
    { role: "assistant", content: [{ type: "text", text: "hi" }] },
  ];

  beforeEach(() => {
    client = new GralkorInMemoryClient();
  });

  it("calls GralkorClient.capture with a canonical Message[] when ctx is valid", async () => {
    client.setResponse("capture", { ok: true });

    const result = await runAgentEnd(client, {
      sessionKey: "sess-1",
      groupId: "user_1",
      agentName: "TestAgent",
      messages: okMessages,
    });

    expect(result).toEqual({ ok: true });
    expect(client.captures).toHaveLength(1);
    const [sessionId, groupId, agentName, messages] = client.captures[0];
    expect(sessionId).toBe("sess-1");
    expect(groupId).toBe("user_1");
    expect(agentName).toBe("TestAgent");
    expect(messages).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ]);
  });

  it("renders intermediate ctx entries as behaviour messages between the user and assistant", async () => {
    client.setResponse("capture", { ok: true });

    await runAgentEnd(client, {
      sessionKey: "sess-1",
      groupId: "user_1",
      agentName: "TestAgent",
      messages: [
        { role: "user", content: "what's the weather?" },
        { role: "assistant", content: [{ type: "thinking", thinking: "let me check" }] },
        { role: "assistant", content: [{ type: "toolUse", name: "weather", input: { city: "sf" } }] },
        { role: "toolResult", content: "sunny" },
        { role: "assistant", content: [{ type: "text", text: "it's sunny" }] },
      ],
    });

    const [, , , messages] = client.captures[0];
    expect(messages).toEqual([
      { role: "user", content: "what's the weather?" },
      { role: "behaviour", content: "thought: let me check" },
      { role: "behaviour", content: 'tool weather ← {"city":"sf"}' },
      { role: "behaviour", content: "toolResult: sunny" },
      { role: "assistant", content: "it's sunny" },
    ]);
  });

  it("skips capture when messages are empty", async () => {
    const result = await runAgentEnd(client, {
      sessionKey: "sess-1",
      groupId: "user_1",
      agentName: "TestAgent",
      messages: [],
    });

    expect(result).toEqual({ ok: true });
    expect(client.captures).toEqual([]);
  });

  it("skips capture when ctxToMessages yields null (no user or no assistant)", async () => {
    const result = await runAgentEnd(client, {
      sessionKey: "sess-1",
      groupId: "user_1",
      agentName: "TestAgent",
      messages: [{ role: "user", content: "unanswered" }],
    });

    expect(result).toEqual({ ok: true });
    expect(client.captures).toEqual([]);
  });

  it("surfaces client errors on capture failure", async () => {
    client.setResponse("capture", { error: "gralkor_down" });

    const result = await runAgentEnd(client, {
      sessionKey: "sess-1",
      groupId: "user_1",
      agentName: "TestAgent",
      messages: okMessages,
    });

    expect(result).toEqual({ error: "gralkor_down" });
  });

  it("skips capture for OpenClaw's transient slug-generator run (sessionKey = 'temp:slug-generator')", async () => {
    const result = await runAgentEnd(client, {
      sessionKey: "temp:slug-generator",
      groupId: "any_agent",
      agentName: "TestAgent",
      messages: [
        {
          role: "user",
          content:
            "Based on this conversation, generate a short 1-2 word filename slug...",
        },
        { role: "assistant", content: [{ type: "text", text: "bug-fix" }] },
      ],
    });

    expect(result).toEqual({ ok: true });
    expect(client.captures).toEqual([]);
  });

  it("skips capture when the trailing user message is the OpenClaw session-reset meta-prompt", async () => {
    const result = await runAgentEnd(client, {
      sessionKey: "sess-1",
      groupId: "user_1",
      agentName: "TestAgent",
      messages: [
        {
          role: "user",
          content:
            "A new session was started via /new or /reset. Run your Session Startup sequence - read the required files before responding to the user.",
        },
        { role: "assistant", content: [{ type: "text", text: "Hey Eli." }] },
      ],
    });

    expect(result).toEqual({ ok: true });
    expect(client.captures).toEqual([]);
  });
});
