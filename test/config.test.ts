import { describe, it, expect } from "vitest";
import { resolveConfig, defaultConfig, buildSecretEnv } from "../src/config.js";

describe("config — resolveConfig", () => {
  it("throws when agentName is missing or blank", () => {
    expect(() => resolveConfig({ agentName: undefined as unknown as string })).toThrow();
    expect(() => resolveConfig({ agentName: "" })).toThrow();
    expect(() => resolveConfig({ agentName: "   " })).toThrow();
  });

  it("throws when given an empty object (agentName required)", () => {
    expect(() => resolveConfig({})).toThrow();
  });

  it("includes agentName verbatim and other unspecified fields equal defaultConfig", () => {
    const resolved = resolveConfig({ agentName: "TestAgent" });
    expect(resolved.agentName).toBe("TestAgent");
    expect(resolved).toMatchObject(defaultConfig);
  });

  it("leaves llm and embedder undefined by default so the Python server applies its own defaults", () => {
    const resolved = resolveConfig({ agentName: "TestAgent" });
    expect(resolved.llm).toBeUndefined();
    expect(resolved.embedder).toBeUndefined();
  });

  it("passes through llm and embedder ModelConfig values when provided", () => {
    const resolved = resolveConfig({
      agentName: "TestAgent",
      llm: { provider: "anthropic", model: "claude-opus-4" },
      embedder: { provider: "openai", model: "text-embedding-3-small" },
    });
    expect(resolved.llm).toEqual({ provider: "anthropic", model: "claude-opus-4" });
    expect(resolved.embedder).toEqual({ provider: "openai", model: "text-embedding-3-small" });
  });

  it("overrides only the fields provided and keeps defaults elsewhere", () => {
    const merged = resolveConfig({
      agentName: "TestAgent",
      search: { maxResults: 7 },
    });
    expect(merged.search.maxResults).toBe(7);
    expect(merged.llm).toBeUndefined();
  });

  it("passes api-key fields through unchanged (trimming happens later in buildSecretEnv)", () => {
    const merged = resolveConfig({
      agentName: "TestAgent",
      googleApiKey: "  google-key  ",
      openaiApiKey: "openai-key",
    });
    expect(merged.googleApiKey).toBe("  google-key  ");
    expect(merged.openaiApiKey).toBe("openai-key");
    expect(merged.anthropicApiKey).toBeUndefined();
    expect(merged.groqApiKey).toBeUndefined();
  });

  it("omits interpretMaxOutputTokens by default so the server applies its 2000-token default", () => {
    const merged = resolveConfig({ agentName: "TestAgent" });
    expect(merged.interpretMaxOutputTokens).toBeUndefined();
  });

  it("passes a positive-integer interpretMaxOutputTokens through unchanged", () => {
    const merged = resolveConfig({ agentName: "TestAgent", interpretMaxOutputTokens: 4321 });
    expect(merged.interpretMaxOutputTokens).toBe(4321);
  });

  it("throws when interpretMaxOutputTokens is zero or negative", () => {
    expect(() =>
      resolveConfig({ agentName: "TestAgent", interpretMaxOutputTokens: 0 }),
    ).toThrow(/interpretMaxOutputTokens/);
    expect(() =>
      resolveConfig({ agentName: "TestAgent", interpretMaxOutputTokens: -5 }),
    ).toThrow(/interpretMaxOutputTokens/);
  });

  it("throws when interpretMaxOutputTokens is not an integer", () => {
    expect(() =>
      resolveConfig({ agentName: "TestAgent", interpretMaxOutputTokens: 1.5 }),
    ).toThrow(/interpretMaxOutputTokens/);
    expect(() =>
      resolveConfig({
        agentName: "TestAgent",
        interpretMaxOutputTokens: "lots" as unknown as number,
      }),
    ).toThrow(/interpretMaxOutputTokens/);
  });
});

describe("config — buildSecretEnv", () => {
  it("returns an empty object when no api keys are set", () => {
    expect(buildSecretEnv(resolveConfig({ agentName: "TestAgent" }))).toEqual({});
  });

  it("maps each provider key to its uppercase env var name", () => {
    const env = buildSecretEnv(
      resolveConfig({
        agentName: "TestAgent",
        googleApiKey: "g",
        openaiApiKey: "o",
        anthropicApiKey: "a",
        groqApiKey: "q",
      }),
    );
    expect(env).toEqual({
      GOOGLE_API_KEY: "g",
      OPENAI_API_KEY: "o",
      ANTHROPIC_API_KEY: "a",
      GROQ_API_KEY: "q",
    });
  });

  it("trims surrounding whitespace on each api-key value", () => {
    const env = buildSecretEnv(
      resolveConfig({ agentName: "TestAgent", googleApiKey: "  padded-key  \n" }),
    );
    expect(env.GOOGLE_API_KEY).toBe("padded-key");
  });

  it("includes only the keys that are set (no empty values)", () => {
    const env = buildSecretEnv(resolveConfig({ agentName: "TestAgent", openaiApiKey: "solo" }));
    expect(env).toEqual({ OPENAI_API_KEY: "solo" });
  });
});
