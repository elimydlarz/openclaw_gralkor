import { describe, it, expect } from "vitest";
import {
  DEFAULT_LLM_PROVIDER,
  DEFAULT_LLM_MODEL,
} from "@susu-eng/gralkor-ts";
import { resolveConfig, defaultConfig, buildSecretEnv } from "../src/config.js";

describe("config — resolveConfig", () => {
  it("returns the default config when given an empty object", () => {
    expect(resolveConfig({})).toMatchObject(defaultConfig);
  });

  it("overrides only the fields provided and keeps defaults elsewhere", () => {
    const merged = resolveConfig({
      autoCapture: { enabled: false },
      autoRecall: { enabled: true, maxResults: 3 },
      search: { maxResults: 7, maxEntityResults: 2 },
    });
    expect(merged.autoCapture.enabled).toBe(false);
    expect(merged.autoRecall.maxResults).toBe(3);
    expect(merged.search.maxResults).toBe(7);
    expect(merged.llm).toEqual({
      provider: DEFAULT_LLM_PROVIDER,
      model: DEFAULT_LLM_MODEL,
    });
  });

  it("passes api-key fields through unchanged (trimming happens later in buildSecretEnv)", () => {
    const merged = resolveConfig({
      googleApiKey: "  google-key  ",
      openaiApiKey: "openai-key",
    });
    expect(merged.googleApiKey).toBe("  google-key  ");
    expect(merged.openaiApiKey).toBe("openai-key");
    expect(merged.anthropicApiKey).toBeUndefined();
    expect(merged.groqApiKey).toBeUndefined();
  });
});

describe("config — buildSecretEnv", () => {
  it("returns an empty object when no api keys are set", () => {
    expect(buildSecretEnv(resolveConfig({}))).toEqual({});
  });

  it("maps each provider key to its uppercase env var name", () => {
    const env = buildSecretEnv(
      resolveConfig({
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
      resolveConfig({ googleApiKey: "  padded-key  \n" }),
    );
    expect(env.GOOGLE_API_KEY).toBe("padded-key");
  });

  it("includes only the keys that are set (no empty values)", () => {
    const env = buildSecretEnv(resolveConfig({ openaiApiKey: "solo" }));
    expect(env).toEqual({ OPENAI_API_KEY: "solo" });
  });
});
