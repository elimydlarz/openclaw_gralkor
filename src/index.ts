import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  GralkorHttpClient,
  GRALKOR_URL,
  validateOntologyConfig,
  waitForHealth,
} from "@susu-eng/gralkor-ts";
import {
  resolveConfig,
  defaultConfig,
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

const REGISTERED = Symbol.for("@susu-eng/openclaw-gralkor:registered");
type RegisteredSlot = { [REGISTERED]?: boolean };

export function resetRegistrationForTests(): void {
  (globalThis as RegisteredSlot)[REGISTERED] = false;
}

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
  if (api.registrationMode && api.registrationMode !== "full") return;

  const slot = globalThis as RegisteredSlot;
  if (slot[REGISTERED]) return;

  try {
    const config = resolveConfig(
      (api.pluginConfig ?? {}) as Partial<GralkorPluginConfig>,
    );
    validateOntologyConfig(config.ontology);

    console.log(`[gralkor] boot: plugin loaded (v${version})`);
    if (config.test) {
      console.log(
        `[gralkor] raw pluginConfig: ${JSON.stringify(api.pluginConfig)}`,
      );
    }
    const llmSummary = config.llm
      ? `${config.llm.provider}/${config.llm.model}`
      : "server-default";
    const embedderSummary = config.embedder
      ? `${config.embedder.provider}/${config.embedder.model}`
      : "server-default";
    const ontologySummary = config.ontology
      ? `${Object.keys(config.ontology.entities ?? {}).length} entities, ${Object.keys(config.ontology.edges ?? {}).length} edges`
      : "none";
    console.log(
      `[gralkor] config:` +
        ` llm=${llmSummary}` +
        ` embedder=${embedderSummary}` +
        ` ontology=${ontologySummary}` +
        ` autoCapture=${config.autoCapture.enabled}` +
        ` autoRecall=${config.autoRecall.enabled} maxResults=${config.autoRecall.maxResults}` +
        ` test=${config.test}` +
        ` dataDir=${config.dataDir ?? "default"}`,
    );

    const externalUrl = process.env.EXTERNAL_GRALKOR_URL;
    const baseUrl = externalUrl ?? GRALKOR_URL;
    const client = new GralkorHttpClient({ baseUrl });

    registerTools(api, client, config);
    registerHooks(api, client, config);

    if (externalUrl) {
      console.log(
        `[gralkor] thin-client mode: pointing at ${externalUrl} (no local server spawn)`,
      );
      void waitForHealth(client, { timeoutMs: 120_000, backoffMs: 500 }).catch(
        (err) => {
          console.error(
            "[gralkor] thin-client: waitForHealth failed:",
            err instanceof Error ? err.message : err,
          );
        },
      );
    } else {
      registerServerService(api, config, version);
    }

    slot[REGISTERED] = true;
  } catch (err) {
    console.error(
      `[gralkor] boot: register() failed:`,
      err instanceof Error ? err.message : err,
    );
    throw err;
  }
}

export default { id, name, description, kind, configSchema, register };
