import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  GralkorHttpClient,
  GRALKOR_URL,
  validateOntologyConfig,
} from "@susu-eng/gralkor-ts";
import {
  resolveConfig,
  defaultConfig,
  resolveProviders,
  type GralkorPluginConfig,
} from "./config.js";
import type { MemoryPluginApi } from "./types.js";
import {
  registerTools,
  registerHooks,
  registerServerService,
} from "./register.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pluginDir = join(__dirname, ".."); // dist/ → plugin root

let version = "unknown";
try {
  version =
    JSON.parse(readFileSync(join(pluginDir, "package.json"), "utf-8"))
      .version ?? "unknown";
} catch {
  /* not critical */
}

let configLogged = false;
let serverManagerStarted = false;

export const id = "openclaw-gralkor";
export const name = "Gralkor Memory (OpenClaw)";
export const description =
  "Persistent, temporally-aware memory via Graphiti knowledge graphs and FalkorDB";
export const kind = "memory" as const;

export const tools = [
  "memory_search",
  "memory_add",
  "memory_build_indices",
  "memory_build_communities",
];

export const configSchema = {
  type: "object" as const,
  properties: {
    autoCapture: {
      type: "object" as const,
      properties: {
        enabled: {
          type: "boolean" as const,
          default: defaultConfig.autoCapture.enabled,
        },
      },
    },
    autoRecall: {
      type: "object" as const,
      properties: {
        enabled: {
          type: "boolean" as const,
          default: defaultConfig.autoRecall.enabled,
        },
        maxResults: {
          type: "number" as const,
          default: defaultConfig.autoRecall.maxResults,
        },
      },
    },
    search: {
      type: "object" as const,
      properties: {
        maxResults: {
          type: "number" as const,
          default: defaultConfig.search.maxResults,
        },
        maxEntityResults: {
          type: "number" as const,
          default: defaultConfig.search.maxEntityResults,
        },
      },
    },
    dataDir: {
      type: "string" as const,
      description:
        "Required. Directory for persistent backend data (venv, FalkorDB database). Operator must set this path.",
    },
    workspaceDir: {
      type: "string" as const,
      description:
        "Native memory workspace root. Scanned at startup for MD files to index into the graph. Defaults to ~/.openclaw/workspace.",
    },
    test: {
      type: "boolean" as const,
      default: false,
      description:
        "Enable test mode — logs full episode bodies and search results for debugging.",
    },
    googleApiKey: {
      type: "string" as const,
      description: "Google API key for Gemini LLM and embeddings",
    },
    openaiApiKey: {
      type: "string" as const,
      description:
        "OpenAI API key; also needed for embeddings with Anthropic/Groq providers",
    },
    anthropicApiKey: {
      type: "string" as const,
      description: "Anthropic API key for Claude-based LLM extraction",
    },
    groqApiKey: {
      type: "string" as const,
      description: "Groq API key for Groq-hosted LLM extraction",
    },
  },
};

export function register(api: MemoryPluginApi): void {
  try {
    const config = resolveConfig(
      (api.pluginConfig ?? {}) as Partial<GralkorPluginConfig>,
    );
    validateOntologyConfig(config.ontology);

    if (!configLogged) {
      configLogged = true;
      console.log(`[gralkor] boot: plugin loaded (v${version})`);
      if (config.test) {
        console.log(
          `[gralkor] raw pluginConfig: ${JSON.stringify(api.pluginConfig)}`,
        );
      }
      const { llmProvider, llmModel, embedderProvider, embedderModel } =
        resolveProviders(config);
      const ontologySummary = config.ontology
        ? `${Object.keys(config.ontology.entities ?? {}).length} entities, ${Object.keys(config.ontology.edges ?? {}).length} edges`
        : "none";
      console.log(
        `[gralkor] config:` +
          ` llm=${llmProvider}/${llmModel}` +
          ` embedder=${embedderProvider}/${embedderModel}` +
          ` ontology=${ontologySummary}` +
          ` autoCapture=${config.autoCapture.enabled}` +
          ` autoRecall=${config.autoRecall.enabled} maxResults=${config.autoRecall.maxResults}` +
          ` test=${config.test}` +
          ` dataDir=${config.dataDir ?? "default"}`,
      );
    }

    const client = new GralkorHttpClient({ baseUrl: GRALKOR_URL });

    registerTools(api, client);
    registerHooks(api, client, config);

    if (!serverManagerStarted) {
      serverManagerStarted = true;
      registerServerService(api, config, version);
    }
  } catch (err) {
    console.error(
      `[gralkor] boot: register() failed:`,
      err instanceof Error ? err.message : err,
    );
    throw err;
  }
}

export default { id, name, description, kind, configSchema, register };
