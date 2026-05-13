import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  GralkorHttpClient,
  GRALKOR_URL,
  validateOntologyConfig,
} from "@susulabs/gralkor-ts";
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

const pkgJson = JSON.parse(
  readFileSync(join(pluginDir, "package.json"), "utf-8"),
) as { version: string; repository?: { url?: string } };

const version: string = pkgJson.version;

/**
 * Parse a GitHub `owner/repo` slug from a package.json `repository.url` field.
 * The slug is passed to `createServerManager` as `wheelRepo` and to the
 * `falkordblite` wheel URL the server-manager downloads at boot — the same
 * slug the publish script (`scripts/publish-clawhub.sh`) uploads to via
 * `gh release upload`. Deriving both sides from one source (this field)
 * keeps publish and runtime in lockstep.
 */
export function parseGithubRepoSlug(repositoryUrl: string): string {
  const match = repositoryUrl.match(/github\.com[:/]([^/]+)\/([^/.]+?)(?:\.git)?$/);
  if (!match) {
    throw new Error(
      `Cannot parse GitHub owner/repo from repository.url=${JSON.stringify(repositoryUrl)} — expected a github.com URL`,
    );
  }
  return `${match[1]}/${match[2]}`;
}

const wheelRepo = parseGithubRepoSlug(pkgJson.repository?.url ?? "");

const REGISTERED = Symbol.for("@susulabs/gralkor:registered");
type RegisteredSlot = { [REGISTERED]?: boolean };

export function resetRegistrationForTests(): void {
  (globalThis as RegisteredSlot)[REGISTERED] = false;
}

export const id = "@susulabs/gralkor";
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
  required: ["agentName"] as const,
  properties: {
    agentName: {
      type: "string" as const,
      minLength: 1,
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
        ` test=${config.test}` +
        ` dataDir=${config.dataDir ?? "default"}`,
    );

    const client = new GralkorHttpClient({ baseUrl: GRALKOR_URL });

    registerTools(api, client, config);
    registerHooks(api, client, config);
    registerServerService(api, config, version, wheelRepo);

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
