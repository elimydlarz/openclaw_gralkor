import { describe, it, expect } from "vitest";
import { ctxToMessages, type MessageEntry } from "../src/ctx-to-messages.js";

describe("ctxToMessages", () => {
  it("emits a canonical [user, behaviour…, assistant] sequence built from the trailing user query, intermediate events, and final assistant answer", () => {
    const messages: MessageEntry[] = [
      { role: "user", content: "what's the weather?" },
      { role: "assistant", content: [{ type: "thinking", thinking: "let me check" }] },
      { role: "assistant", content: [{ type: "toolUse", name: "weather", input: { city: "sf" } }] },
      { role: "toolResult", content: "sunny" },
      { role: "assistant", content: [{ type: "text", text: "it's sunny" }] },
    ];

    const out = ctxToMessages(messages);

    expect(out).toEqual([
      { role: "user", content: "what's the weather?" },
      { role: "behaviour", content: "thought: let me check" },
      { role: "behaviour", content: 'tool weather ← {"city":"sf"}' },
      { role: "behaviour", content: "toolResult: sunny" },
      { role: "assistant", content: "it's sunny" },
    ]);
  });

  it("returns null when there is no user message", () => {
    const messages: MessageEntry[] = [
      { role: "assistant", content: [{ type: "text", text: "hi" }] },
    ];
    expect(ctxToMessages(messages)).toBeNull();
  });

  it("returns null when there is no final assistant message", () => {
    const messages: MessageEntry[] = [{ role: "user", content: "hello" }];
    expect(ctxToMessages(messages)).toBeNull();
  });

  it("returns null for an empty ctx", () => {
    expect(ctxToMessages([])).toBeNull();
  });

  it("uses the trailing user message when earlier user messages exist", () => {
    const messages: MessageEntry[] = [
      { role: "user", content: "first" },
      { role: "assistant", content: [{ type: "text", text: "ok" }] },
      { role: "user", content: "second" },
      { role: "assistant", content: [{ type: "text", text: "done" }] },
    ];

    const out = ctxToMessages(messages);
    expect(out).toEqual([
      { role: "user", content: "second" },
      { role: "assistant", content: "done" },
    ]);
  });

  it("extracts string content from both string and block forms", () => {
    const messages: MessageEntry[] = [
      { role: "user", content: [{ type: "text", text: "via blocks" }] },
      { role: "assistant", content: "plain string" },
    ];

    const out = ctxToMessages(messages);
    expect(out).toEqual([
      { role: "user", content: "via blocks" },
      { role: "assistant", content: "plain string" },
    ]);
  });

  it("strips a leading 'Conversation info (untrusted metadata)' json block from the user message", () => {
    const messages: MessageEntry[] = [
      {
        role: "user",
        content:
          'Conversation info (untrusted metadata):\n```json\n{"message_id":"3991"}\n```\nGralkor status?',
      },
      { role: "assistant", content: [{ type: "text", text: "all good" }] },
    ];

    const out = ctxToMessages(messages);
    expect(out?.[0]).toEqual({ role: "user", content: "Gralkor status?" });
  });

  it("strips a leading 'Sender (untrusted metadata)' json block from the user message", () => {
    const messages: MessageEntry[] = [
      {
        role: "user",
        content:
          'Sender (untrusted metadata):\n```json\n{"name":"Alice"}\n```\nhello',
      },
      { role: "assistant", content: [{ type: "text", text: "hi" }] },
    ];

    const out = ctxToMessages(messages);
    expect(out?.[0]).toEqual({ role: "user", content: "hello" });
  });

  it("strips both metadata blocks in sequence when both precede the user text", () => {
    const messages: MessageEntry[] = [
      {
        role: "user",
        content:
          'Conversation info (untrusted metadata):\n```json\n{"message_id":"3991"}\n```\nSender (untrusted metadata):\n```json\n{"name":"Eli"}\n```\nCheck again',
      },
      { role: "assistant", content: [{ type: "text", text: "ok" }] },
    ];

    const out = ctxToMessages(messages);
    expect(out?.[0]).toEqual({ role: "user", content: "Check again" });
  });

  it("strips both metadata blocks when they appear in reverse order (Sender then Conversation info)", () => {
    const messages: MessageEntry[] = [
      {
        role: "user",
        content:
          'Sender (untrusted metadata):\n```json\n{"name":"Eli"}\n```\nConversation info (untrusted metadata):\n```json\n{"message_id":"3991"}\n```\nWhat\'s up?',
      },
      { role: "assistant", content: [{ type: "text", text: "hi" }] },
    ];

    const out = ctxToMessages(messages);
    expect(out?.[0]).toEqual({ role: "user", content: "What's up?" });
  });

  it("does not strip metadata-shaped blocks that appear mid-content after real user text", () => {
    const content =
      'Here\'s a real question. Can you parse this?\nConversation info (untrusted metadata):\n```json\n{"message_id":"3991"}\n```\nend.';
    const messages: MessageEntry[] = [
      { role: "user", content },
      { role: "assistant", content: [{ type: "text", text: "sure" }] },
    ];

    const out = ctxToMessages(messages);
    expect(out?.[0]).toEqual({ role: "user", content });
  });

  it("does not modify the assistant message even when it contains metadata-looking content", () => {
    const untouched =
      'Conversation info (untrusted metadata):\n```json\n{}\n```\nquoted in response';
    const messages: MessageEntry[] = [
      { role: "user", content: "tell me" },
      { role: "assistant", content: untouched },
    ];

    const out = ctxToMessages(messages);
    expect(out?.[out.length - 1]).toEqual({ role: "assistant", content: untouched });
  });

  it("leaves the user message untouched when it does not start with a metadata block", () => {
    const messages: MessageEntry[] = [
      { role: "user", content: "just a plain question" },
      { role: "assistant", content: [{ type: "text", text: "sure" }] },
    ];

    const out = ctxToMessages(messages);
    expect(out?.[0]).toEqual({ role: "user", content: "just a plain question" });
  });

  it("renders a codex function_call as a `tool NAME ← {args}` behaviour line", () => {
    const messages: MessageEntry[] = [
      { role: "user", content: "run it" },
      {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "call_abc|fc_xyz",
            name: "exec",
            arguments: { cmd: ["ls", "/tmp"] },
          },
        ],
      },
      { role: "assistant", content: [{ type: "text", text: "done" }] },
    ];

    const out = ctxToMessages(messages);
    expect(out).toEqual([
      { role: "user", content: "run it" },
      { role: "behaviour", content: 'tool exec ← {"cmd":["ls","/tmp"]}' },
      { role: "assistant", content: "done" },
    ]);
  });

  it("renders a `toolResult` role with content blocks as a single `toolResult: …` behaviour line", () => {
    const messages: MessageEntry[] = [
      { role: "user", content: "run it" },
      {
        role: "toolResult",
        content: [{ type: "text", text: "stdout from exec" }],
      },
      { role: "assistant", content: [{ type: "text", text: "ok" }] },
    ];

    const out = ctxToMessages(messages);
    expect(out).toEqual([
      { role: "user", content: "run it" },
      { role: "behaviour", content: "toolResult: stdout from exec" },
      { role: "assistant", content: "ok" },
    ]);
  });

  it("strips ANSI escape sequences from behaviour text", () => {
    const messages: MessageEntry[] = [
      { role: "user", content: "q" },
      {
        role: "toolResult",
        content: [
          {
            type: "text",
            text: "[34mSTEP 1[0m\nplain line",
          },
        ],
      },
      { role: "assistant", content: [{ type: "text", text: "ok" }] },
    ];

    const out = ctxToMessages(messages);
    expect(out?.[1]).toEqual({
      role: "behaviour",
      content: "toolResult: STEP 1\nplain line",
    });
  });

  it("truncates oversized behaviour bodies with a trailing marker", () => {
    const long = "x".repeat(2000);
    const messages: MessageEntry[] = [
      { role: "user", content: "q" },
      { role: "toolResult", content: [{ type: "text", text: long }] },
      { role: "assistant", content: [{ type: "text", text: "ok" }] },
    ];

    const out = ctxToMessages(messages);
    const body = (out?.[1]?.content ?? "") as string;
    expect(body.startsWith("toolResult: ")).toBe(true);
    expect(body.length).toBeLessThan(long.length);
    expect(body.endsWith("… [truncated]")).toBe(true);
  });

  it("emits no behaviour message when an intermediate entry has no useful content", () => {
    const messages: MessageEntry[] = [
      { role: "user", content: "q" },
      { role: "assistant", content: [{ type: "text", text: "" }] },
      { role: "assistant", content: [{ type: "text", text: "ok" }] },
    ];

    const out = ctxToMessages(messages);
    expect(out).toEqual([
      { role: "user", content: "q" },
      { role: "assistant", content: "ok" },
    ]);
  });
});
