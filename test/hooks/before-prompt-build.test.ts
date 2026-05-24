import { describe, it, expect, beforeEach } from "vitest";
import { GralkorInMemoryClient } from "../../src/gralkor/testing.js";
import { runBeforePromptBuild } from "../../src/hooks/before-prompt-build.js";
import {
  getSessionGroup,
  resetSessionMap,
} from "../../src/session-map.js";

describe("before_prompt_build hook", () => {
  let client: GralkorInMemoryClient;

  beforeEach(() => {
    client = new GralkorInMemoryClient();
    resetSessionMap();
  });

  describe("session registration", () => {
    it("registers the session's groupId (sanitised agentId)", async () => {
      client.setResponse("recall", { ok: "<gralkor-memory>x</gralkor-memory>" });

      await runBeforePromptBuild(client, {
        sessionKey: "sess-1",
        agentId: "user-with-hyphens",
        agentName: "TestAgent",
        prompt: "anything",
      });

      expect(getSessionGroup("sess-1")).toBe("user_with_hyphens");
    });
  });

  describe("when ctx.prompt is non-empty", () => {
    it("calls recall with sanitised groupId + sessionKey + prompt + agentName", async () => {
      client.setResponse("recall", { ok: "<gralkor-memory>x</gralkor-memory>" });

      await runBeforePromptBuild(client, {
        sessionKey: "sess-1",
        agentId: "user-1",
        agentName: "TestAgent",
        prompt: "what do you know about me?",
      });

      expect(client.recalls).toEqual([
        ["user_1", "sess-1", "what do you know about me?", "TestAgent", undefined],
      ]);
    });

    it("returns prependContext when recall returns { ok: block }", async () => {
      client.setResponse("recall", {
        ok: "<gralkor-memory>known fact</gralkor-memory>",
      });

      const result = await runBeforePromptBuild(client, {
        sessionKey: "sess-1",
        agentId: "user-1",
        agentName: "TestAgent",
        prompt: "what do you know about me?",
      });

      expect(result).toEqual({
        ok: { prependContext: "<gralkor-memory>known fact</gralkor-memory>" },
      });
    });

    it("logs a warning and continues without context on recall failure", async () => {
      client.setResponse("recall", { error: "gralkor_down" });

      const warnings: unknown[][] = [];
      const originalWarn = console.warn;
      console.warn = (...args: unknown[]) => {
        warnings.push(args);
      };

      try {
        const result = await runBeforePromptBuild(client, {
          sessionKey: "sess-1",
          agentId: "user-1",
          agentName: "TestAgent",
          prompt: "what do you know about me?",
        });

        expect(result).toEqual({ ok: {} });
      } finally {
        console.warn = originalWarn;
      }

      expect(warnings.length).toBe(1);
      const message = String(warnings[0][0] ?? "");
      expect(message).toContain("[openclaw_gralkor] recall failed");
      expect(warnings[0][1]).toBe("gralkor_down");
    });
  });

  describe("when ctx.prompt is empty or whitespace", () => {
    it("still registers the session but skips recall when prompt is empty", async () => {
      const result = await runBeforePromptBuild(client, {
        sessionKey: "sess-1",
        agentId: "user-1",
        agentName: "TestAgent",
        prompt: "",
      });

      expect(result).toEqual({ ok: {} });
      expect(client.recalls).toEqual([]);
      expect(getSessionGroup("sess-1")).toBe("user_1");
    });

    it("skips recall when prompt is whitespace-only", async () => {
      await runBeforePromptBuild(client, {
        sessionKey: "sess-1",
        agentId: "user-1",
        agentName: "TestAgent",
        prompt: "   \n  ",
      });

      expect(client.recalls).toEqual([]);
    });
  });
});
