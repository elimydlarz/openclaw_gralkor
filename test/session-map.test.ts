import { describe, it, expect, beforeEach } from "vitest";
import {
  setSessionGroup,
  getSessionGroup,
  requireSessionKey,
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

  describe("requireSessionKey", () => {
    it("returns the sessionKey when it is a non-blank string", () => {
      expect(requireSessionKey("sess-1")).toBe("sess-1");
    });

    it("throws when sessionKey is undefined", () => {
      expect(() => requireSessionKey(undefined)).toThrow(
        /Gralkor requires a non-blank session_id/,
      );
    });

    it("throws when sessionKey is null", () => {
      expect(() => requireSessionKey(null)).toThrow(
        /Gralkor requires a non-blank session_id/,
      );
    });

    it("throws when sessionKey is the empty string", () => {
      expect(() => requireSessionKey("")).toThrow(
        /Gralkor requires a non-blank session_id/,
      );
    });
  });
});
