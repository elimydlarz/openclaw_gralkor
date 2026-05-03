/**
 * OpenClaw-specific plugin config. Shapes that OpenClaw hands us via
 * `api.pluginConfig` at register() time.
 *
 * The HTTP client + Python server + ontology validation all live in
 * @susu-eng/gralkor-ts now. This file keeps only the plugin-surface
 * knobs — autoCapture / autoRecall / search / provider keys.
 *
 * **Defaults policy.** Provider/model defaults live in the Python server
 * (single source of truth). When `llm` / `embedder` is omitted here we
 * pass `undefined` straight through to `createServerManager` and the
 * server fills in. We do not duplicate the server's defaults client-side.
 */

import {
  type ModelConfig,
  type OntologyConfig,
  validateOntologyConfig as libValidate,
} from "@susu-eng/gralkor-ts";

export interface GralkorPluginConfig {
  autoCapture: { enabled: boolean };
  autoRecall: { enabled: boolean; maxResults: number };
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
}

export const defaultConfig: GralkorPluginConfig = {
  autoCapture: { enabled: true },
  autoRecall: { enabled: true, maxResults: 10 },
  search: { maxResults: 20 },
};

export function resolveConfig(
  raw: Partial<GralkorPluginConfig> = {},
): GralkorPluginConfig {
  return {
    autoCapture: {
      enabled: raw.autoCapture?.enabled ?? defaultConfig.autoCapture.enabled,
    },
    autoRecall: {
      enabled: raw.autoRecall?.enabled ?? defaultConfig.autoRecall.enabled,
      maxResults:
        raw.autoRecall?.maxResults ?? defaultConfig.autoRecall.maxResults,
    },
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
