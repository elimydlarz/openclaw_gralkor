import { describe, it, expect, beforeEach } from "vitest";
import {
  setSessionGroup,
  getSessionGroup,
  resolveSessionId,
  resetSessionMap,
} from "../src/session-map.js";

describe("session-map", () => {
  beforeEach(() => {
    resetSessionMap();
  });

  describe("setSessionGroup / getSessionGroup", () => {
    it("maps sessionKey to sanitised agentId", () => {
      setSessionGroup("sess-1", "my-hyphen-agent");
      expect(getSessionGroup("sess-1")).toBe("my_hyphen_agent");
    });

    it("returns null for an unknown sessionKey", () => {
      expect(getSessionGroup("never-seen")).toBeNull();
    });

    it("overwrites the previous value on a second setSessionGroup call", () => {
      setSessionGroup("sess-1", "agent-a");
      setSessionGroup("sess-1", "agent-b");
      expect(getSessionGroup("sess-1")).toBe("agent_b");
    });
  });

  describe("resolveSessionId", () => {
    it("prefers sessionKey when present", () => {
      expect(resolveSessionId("sess-1", "agent-1")).toBe("sess-1");
    });

    it("falls back to agentId when sessionKey is absent", () => {
      expect(resolveSessionId(undefined, "agent-1")).toBe("agent-1");
    });

    it("falls back to 'default' when both are absent", () => {
      expect(resolveSessionId(undefined, undefined)).toBe("default");
    });
  });
});
