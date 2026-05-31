import { describe, it, expect } from "vitest";
import { requireSessionKey } from "../src/session-key.js";

describe("require-session-key", () => {
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
