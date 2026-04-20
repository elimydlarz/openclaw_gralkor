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
});
