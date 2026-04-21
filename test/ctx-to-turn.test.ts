import { describe, it, expect } from "vitest";
import { ctxToTurn, type MessageEntry } from "../src/ctx-to-turn.js";

describe("ctxToTurn", () => {
  it("returns a single Turn built from the trailing user query + final assistant answer + intermediate events", () => {
    const messages: MessageEntry[] = [
      { role: "user", content: "what's the weather?" },
      { role: "assistant", content: [{ type: "thinking", thinking: "let me check" }] },
      {
        role: "assistant",
        content: [{ type: "toolUse", name: "weather", input: { city: "sf" } }],
      },
      { role: "toolResult", content: "sunny" },
      { role: "assistant", content: [{ type: "text", text: "it's sunny" }] },
    ];

    const turn = ctxToTurn(messages);

    expect(turn).not.toBeNull();
    expect(turn!.user_query).toBe("what's the weather?");
    expect(turn!.assistant_answer).toBe("it's sunny");
    expect(turn!.events).toHaveLength(3);
  });

  it("returns null when there is no user message", () => {
    const messages: MessageEntry[] = [
      { role: "assistant", content: [{ type: "text", text: "hi" }] },
    ];
    expect(ctxToTurn(messages)).toBeNull();
  });

  it("returns null when there is no final assistant message", () => {
    const messages: MessageEntry[] = [{ role: "user", content: "hello" }];
    expect(ctxToTurn(messages)).toBeNull();
  });

  it("returns null for an empty ctx", () => {
    expect(ctxToTurn([])).toBeNull();
  });

  it("uses the trailing user message when earlier user messages exist", () => {
    const messages: MessageEntry[] = [
      { role: "user", content: "first" },
      { role: "assistant", content: [{ type: "text", text: "ok" }] },
      { role: "user", content: "second" },
      { role: "assistant", content: [{ type: "text", text: "done" }] },
    ];

    const turn = ctxToTurn(messages);
    expect(turn!.user_query).toBe("second");
    expect(turn!.assistant_answer).toBe("done");
  });

  it("extracts string content from both string and block forms", () => {
    const messages: MessageEntry[] = [
      { role: "user", content: [{ type: "text", text: "via blocks" }] },
      { role: "assistant", content: "plain string" },
    ];

    const turn = ctxToTurn(messages);
    expect(turn!.user_query).toBe("via blocks");
    expect(turn!.assistant_answer).toBe("plain string");
  });

  it("strips a leading 'Conversation info (untrusted metadata)' json block from user_query", () => {
    const messages: MessageEntry[] = [
      {
        role: "user",
        content:
          'Conversation info (untrusted metadata):\n```json\n{"message_id":"3991"}\n```\nGralkor status?',
      },
      { role: "assistant", content: [{ type: "text", text: "all good" }] },
    ];

    const turn = ctxToTurn(messages);
    expect(turn!.user_query).toBe("Gralkor status?");
  });

  it("strips a leading 'Sender (untrusted metadata)' json block from user_query", () => {
    const messages: MessageEntry[] = [
      {
        role: "user",
        content:
          'Sender (untrusted metadata):\n```json\n{"name":"Alice"}\n```\nhello',
      },
      { role: "assistant", content: [{ type: "text", text: "hi" }] },
    ];

    const turn = ctxToTurn(messages);
    expect(turn!.user_query).toBe("hello");
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

    const turn = ctxToTurn(messages);
    expect(turn!.user_query).toBe("Check again");
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

    const turn = ctxToTurn(messages);
    expect(turn!.user_query).toBe("What's up?");
  });

  it("does not strip metadata-shaped blocks that appear mid-content after real user text", () => {
    const content =
      'Here\'s a real question. Can you parse this?\nConversation info (untrusted metadata):\n```json\n{"message_id":"3991"}\n```\nend.';
    const messages: MessageEntry[] = [
      { role: "user", content },
      { role: "assistant", content: [{ type: "text", text: "sure" }] },
    ];

    const turn = ctxToTurn(messages);
    expect(turn!.user_query).toBe(content);
  });

  it("does not modify assistant_answer even when it contains metadata-looking content", () => {
    const untouched =
      'Conversation info (untrusted metadata):\n```json\n{}\n```\nquoted in response';
    const messages: MessageEntry[] = [
      { role: "user", content: "tell me" },
      { role: "assistant", content: untouched },
    ];

    const turn = ctxToTurn(messages);
    expect(turn!.assistant_answer).toBe(untouched);
  });

  it("leaves user_query untouched when it does not start with a metadata block", () => {
    const messages: MessageEntry[] = [
      { role: "user", content: "just a plain question" },
      { role: "assistant", content: [{ type: "text", text: "sure" }] },
    ];

    const turn = ctxToTurn(messages);
    expect(turn!.user_query).toBe("just a plain question");
  });
});
