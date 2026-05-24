import {
  type ModelConfig,
  type OntologyConfig,
  validateOntologyConfig as libValidate,
} from "./gralkor/index.js";

export interface GralkorPluginConfig {
  agentName: string;
  search: { maxResults: number };
  llm?: ModelConfig;
  embedder?: ModelConfig;
  ontology?: OntologyConfig;
  dataDir?: string;
  workspaceDir?: string;
  test?: boolean;
  googleApiKey?: string;
  openaiApiKey?: string;
  anthropicApiKey?: string;
  groqApiKey?: string;
  /**
   * Output-token budget for the server's interpret pipeline on every recall.
   * Unset → server applies its own default (2000). Raise for wide-recall
   * workloads where the default truncates and surfaces as
   * InterpretParseFailed in the server logs. Must be a positive integer.
   */
  interpretMaxOutputTokens?: number;
}

export const defaultConfig = {
  search: { maxResults: 20 },
} as const;

export function resolveConfig(
  raw: Partial<GralkorPluginConfig> = {},
): GralkorPluginConfig {
  const agentName = raw.agentName;
  if (typeof agentName !== "string" || agentName.trim() === "") {
    throw new Error(
      "openclaw-gralkor pluginConfig.agentName is required (non-blank string); got " +
        JSON.stringify(agentName),
    );
  }

  if (raw.interpretMaxOutputTokens !== undefined) {
    const v = raw.interpretMaxOutputTokens;
    if (typeof v !== "number" || !Number.isInteger(v) || v <= 0) {
      throw new Error(
        "openclaw-gralkor pluginConfig.interpretMaxOutputTokens must be a positive integer, got " +
          JSON.stringify(v),
      );
    }
  }

  return {
    agentName,
    search: {
      maxResults: raw.search?.maxResults ?? defaultConfig.search.maxResults,
    },
    llm: raw.llm,
    embedder: raw.embedder,
    ontology: raw.ontology,
    dataDir: raw.dataDir,
    workspaceDir: raw.workspaceDir,
    test: raw.test ?? false,
    googleApiKey: raw.googleApiKey,
    openaiApiKey: raw.openaiApiKey,
    anthropicApiKey: raw.anthropicApiKey,
    groqApiKey: raw.groqApiKey,
    interpretMaxOutputTokens: raw.interpretMaxOutputTokens,
  };
}

export function buildSecretEnv(config: GralkorPluginConfig): Record<string, string> {
  const env: Record<string, string> = {};
  if (config.googleApiKey) env.GOOGLE_API_KEY = config.googleApiKey.trim();
  if (config.openaiApiKey) env.OPENAI_API_KEY = config.openaiApiKey.trim();
  if (config.anthropicApiKey) env.ANTHROPIC_API_KEY = config.anthropicApiKey.trim();
  if (config.groqApiKey) env.GROQ_API_KEY = config.groqApiKey.trim();
  return env;
}

export const validateOntologyConfig = libValidate;
