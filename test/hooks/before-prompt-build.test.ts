import { describe, it, expect, beforeEach } from "vitest";
import { GralkorInMemoryClient } from "@susu-eng/gralkor-ts/testing";
import { runBeforePromptBuild } from "../../src/hooks/before-prompt-build.js";
import {
  getSessionGroup,
  resetSessionMap,
} from "../../src/session-map.js";
import type { MessageEntry } from "../../src/ctx-to-turn.js";

describe("before_prompt_build hook", () => {
  let client: GralkorInMemoryClient;

  const userQ: MessageEntry[] = [
    { role: "user", content: "what do you know about me?" },
  ];

  beforeEach(() => {
    client = new GralkorInMemoryClient();
    resetSessionMap();
  });

  describe("session registration", () => {
    it("registers the session's groupId (sanitised agentId)", async () => {
      client.setResponse("recall", { ok: null });

      await runBeforePromptBuild(client, {
        sessionKey: "sess-1",
        agentId: "user-with-hyphens",
        messages: userQ,
        autoRecall: true,
      });

      expect(getSessionGroup("sess-1")).toBe("user_with_hyphens");
    });
  });

  describe("when autoRecall is enabled and a query exists", () => {
    it("calls recall with sanitised groupId + sessionKey + query", async () => {
      client.setResponse("recall", { ok: null });

      await runBeforePromptBuild(client, {
        sessionKey: "sess-1",
        agentId: "user-1",
        messages: userQ,
        autoRecall: true,
      });

      expect(client.recalls).toEqual([
        ["user_1", "sess-1", "what do you know about me?"],
      ]);
    });

    it("returns prependContext when recall returns { ok: block }", async () => {
      client.setResponse("recall", {
        ok: "<gralkor-memory>known fact</gralkor-memory>",
      });

      const result = await runBeforePromptBuild(client, {
        sessionKey: "sess-1",
        agentId: "user-1",
        messages: userQ,
        autoRecall: true,
      });

      expect(result).toEqual({
        ok: { prependContext: "<gralkor-memory>known fact</gralkor-memory>" },
      });
    });

    it("returns ok with no prependContext when recall returns { ok: null }", async () => {
      client.setResponse("recall", { ok: null });

      const result = await runBeforePromptBuild(client, {
        sessionKey: "sess-1",
        agentId: "user-1",
        messages: userQ,
        autoRecall: true,
      });

      expect(result).toEqual({ ok: {} });
    });

    it("surfaces client errors on recall failure", async () => {
      client.setResponse("recall", { error: "gralkor_down" });

      const result = await runBeforePromptBuild(client, {
        sessionKey: "sess-1",
        agentId: "user-1",
        messages: userQ,
        autoRecall: true,
      });

      expect(result).toEqual({ error: "gralkor_down" });
    });
  });

  describe("when autoRecall is disabled", () => {
    it("still registers the session but skips recall", async () => {
      const result = await runBeforePromptBuild(client, {
        sessionKey: "sess-1",
        agentId: "user-1",
        messages: userQ,
        autoRecall: false,
      });

      expect(result).toEqual({ ok: {} });
      expect(client.recalls).toEqual([]);
      expect(getSessionGroup("sess-1")).toBe("user_1");
    });
  });

  describe("when no user query can be extracted", () => {
    it("still registers the session but skips recall", async () => {
      const result = await runBeforePromptBuild(client, {
        sessionKey: "sess-1",
        agentId: "user-1",
        messages: [], // no user message
        autoRecall: true,
      });

      expect(result).toEqual({ ok: {} });
      expect(client.recalls).toEqual([]);
      expect(getSessionGroup("sess-1")).toBe("user_1");
    });

    it("uses the trailing user message when earlier ones exist", async () => {
      client.setResponse("recall", { ok: null });

      await runBeforePromptBuild(client, {
        sessionKey: "sess-1",
        agentId: "user-1",
        messages: [
          { role: "user", content: "first" },
          { role: "assistant", content: [{ type: "text", text: "ok" }] },
          { role: "user", content: "second" },
        ],
        autoRecall: true,
      });

      expect(client.recalls[0][2]).toBe("second");
    });
  });
});
