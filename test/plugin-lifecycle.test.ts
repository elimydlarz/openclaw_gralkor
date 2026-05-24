import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ServerManager } from "../src/gralkor/index.js";
import { registerServerService } from "../src/register.js";
import * as manifest from "../src/index.js";
import { makeApi, makeConfig, type TestApi } from "./helpers.js";

const gralkorTsMocks = vi.hoisted(() => ({
  createServerManager: vi.fn<[], ServerManager>(),
  waitForHealth: vi.fn(async () => {}),
  GralkorHttpClient: vi.fn(function (this: object) {
    Object.assign(this, {});
  }),
  GRALKOR_URL: "http://127.0.0.1:4000",
}));

vi.mock("../src/gralkor/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/gralkor/index.js")>();
  return {
    ...actual,
    createServerManager: gralkorTsMocks.createServerManager,
    waitForHealth: gralkorTsMocks.waitForHealth,
    GralkorHttpClient: gralkorTsMocks.GralkorHttpClient,
    GRALKOR_URL: gralkorTsMocks.GRALKOR_URL,
  };
});

describe("plugin manifest exports", () => {
  it("id is the npm package name '@gralkor/openclaw'", () => {
    expect(manifest.id).toBe("@gralkor/openclaw");
  });

  it("kind is 'memory'", () => {
    expect(manifest.kind).toBe("memory");
  });

  it("tools lists the four tool names", () => {
    expect(manifest.tools).toEqual([
      "memory_search",
      "memory_add",
      "memory_build_indices",
      "memory_build_communities",
    ]);
  });

  it("openclaw.plugin.json declares contracts.tools listing the four memory tools (OpenClaw 2026.5.7+ loader gates registration on this field)", () => {
    const pluginJsonPath = join(__dirname, "..", "openclaw.plugin.json");
    const pluginJson = JSON.parse(readFileSync(pluginJsonPath, "utf8"));
    expect(pluginJson.contracts?.tools).toEqual([
      "memory_search",
      "memory_add",
      "memory_build_indices",
      "memory_build_communities",
    ]);
  });

  it("openclaw.plugin.json version equals package.json version (publish-npm.sh syncs them)", () => {
    const root = join(__dirname, "..");
    const pluginJson = JSON.parse(readFileSync(join(root, "openclaw.plugin.json"), "utf8"));
    const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    expect(pluginJson.version).toBe(packageJson.version);
  });

  it("configSchema declares the expected top-level properties", () => {
    const props = manifest.configSchema.properties as Record<string, unknown>;
    expect(manifest.configSchema.type).toBe("object");
    for (const key of [
      "dataDir",
      "workspaceDir",
      "search",
      "test",
      "googleApiKey",
      "openaiApiKey",
      "anthropicApiKey",
      "groqApiKey",
    ]) {
      expect(props).toHaveProperty(key);
    }
  });
});

describe("registerServerService (plugin-lifecycle tree)", () => {
  let manager: ServerManager;
  let startSpy: ReturnType<typeof vi.fn>;
  let stopSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    manifest.resetRegistrationForTests();
    startSpy = vi.fn(async () => {});
    stopSpy = vi.fn(async () => {});
    manager = {
      start: startSpy,
      stop: stopSpy,
      isRunning: vi.fn(() => false),
    };
    gralkorTsMocks.createServerManager.mockReset();
    gralkorTsMocks.createServerManager.mockReturnValue(manager);
    gralkorTsMocks.waitForHealth.mockClear();
  });

  describe("when register() is called", () => {
    it("does not start the manager itself — the OpenClaw 2026.5.7 host drives lifecycle via service.start", async () => {
      const api = makeApi();
      const config = makeConfig();

      registerServerService(api, config, "1.1.2-test", "test/repo");

      // Yield so any stray microtasks would run.
      await Promise.resolve();
      await Promise.resolve();

      expect(startSpy).not.toHaveBeenCalled();
    });

    it("registers a gralkor-server service whose start() boots the manager", async () => {
      const api = makeApi();
      const config = makeConfig();

      registerServerService(api, config, "1.1.2-test", "test/repo");

      expect(api.registered).toHaveLength(1);
      expect(api.registered[0].id).toBe("gralkor-server");
      expect(typeof api.registered[0].stop).toBe("function");

      await api.registered[0].start();
      expect(startSpy).toHaveBeenCalledTimes(1);
    });

    it("invoking service.start twice still only spawns one manager — boot is single-shot per host call", async () => {
      const api = makeApi();
      const config = makeConfig();

      registerServerService(api, config, "1.1.2-test", "test/repo");

      // Each call to startPluginServices invokes service.start once. The
      // plugin must not fire its own start — only the host's start drives
      // boot, and the host calls it exactly once per registered service.
      await api.registered[0].start();

      expect(startSpy).toHaveBeenCalledTimes(1);
    });

    it("throws immediately if dataDir is missing", () => {
      const api = makeApi();
      const config = makeConfig({ dataDir: undefined });

      expect(() => registerServerService(api, config, "1.1.2-test", "test/repo")).toThrow(
        /dataDir is required/,
      );
      expect(startSpy).not.toHaveBeenCalled();
    });

    it("forwards wheelRepo through to createServerManager (the URL the runtime downloads the falkordblite wheel from)", () => {
      const api = makeApi();
      const config = makeConfig();

      registerServerService(api, config, "1.1.2-test", "elimydlarz/openclaw_gralkor");

      expect(gralkorTsMocks.createServerManager).toHaveBeenCalledTimes(1);
      const opts = gralkorTsMocks.createServerManager.mock.calls[0]?.[0] as {
        wheelRepo: string;
        version: string;
      };
      expect(opts.wheelRepo).toBe("elimydlarz/openclaw_gralkor");
      expect(opts.version).toBe("1.1.2-test");
    });
  });
});

describe("parseGithubRepoSlug (plugin-lifecycle tree)", () => {
  it("parses owner/repo from a git+ssh URL with .git suffix", () => {
    expect(
      manifest.parseGithubRepoSlug("git+ssh://git@github.com/elimydlarz/openclaw_gralkor.git"),
    ).toBe("elimydlarz/openclaw_gralkor");
  });

  it("parses owner/repo from a git+https URL with .git suffix", () => {
    expect(
      manifest.parseGithubRepoSlug("git+https://github.com/elimydlarz/openclaw_gralkor.git"),
    ).toBe("elimydlarz/openclaw_gralkor");
  });

  it("parses owner/repo from a bare https URL without .git suffix", () => {
    expect(
      manifest.parseGithubRepoSlug("https://github.com/elimydlarz/openclaw_gralkor"),
    ).toBe("elimydlarz/openclaw_gralkor");
  });

  it("throws when the URL is not a github.com URL", () => {
    expect(() => manifest.parseGithubRepoSlug("https://gitlab.com/foo/bar.git")).toThrow(
      /github\.com/,
    );
  });

  it("throws when the URL is empty (package.json missing repository.url)", () => {
    expect(() => manifest.parseGithubRepoSlug("")).toThrow();
  });

  it("matches what this repo's own package.json declares — runtime and publish derive wheelRepo from the same field", () => {
    const root = join(__dirname, "..");
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      repository: { url: string };
    };
    expect(manifest.parseGithubRepoSlug(pkg.repository.url)).toBe("elimydlarz/openclaw_gralkor");
  });
});

describe("register() lifecycle (plugin-lifecycle tree)", () => {
  let manager: ServerManager;
  let startSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    manifest.resetRegistrationForTests();
    startSpy = vi.fn(async () => {});
    manager = {
      start: startSpy,
      stop: vi.fn(async () => {}),
      isRunning: vi.fn(() => false),
    };
    gralkorTsMocks.createServerManager.mockReset();
    gralkorTsMocks.createServerManager.mockReturnValue(manager);
  });

  function apiWithConfig(): TestApi {
    const api = makeApi();
    (api as unknown as { pluginConfig: unknown }).pluginConfig = {
      agentName: "TestAgent",
      dataDir: "/tmp/fake-gralkor",
    };
    return api;
  }

  it("a single full-mode call binds hooks/tools/service on the api — but does not start the manager (host-driven via service.start)", async () => {
    const api = apiWithConfig();

    manifest.register(api);
    await Promise.resolve();
    await Promise.resolve();

    expect(gralkorTsMocks.createServerManager).toHaveBeenCalledTimes(1);
    expect(startSpy).not.toHaveBeenCalled();
    expect(api.registered).toHaveLength(1);
    expect(api.handlers.size).toBe(3);
    expect(api.toolFactories).toHaveLength(1);
  });

  it("declares the memory capability so OpenClaw routes the memory slot through this plugin (Shape: memory capability, not non-capability)", async () => {
    const api = apiWithConfig();

    manifest.register(api);
    await Promise.resolve();

    expect(api.capabilities).toHaveLength(1);
    const capability = api.capabilities[0]!;
    expect(typeof capability.promptBuilder).toBe("function");
    expect(typeof capability.flushPlanResolver).toBe("function");
  });

  it("the promptBuilder returns static lines about memory_search / memory_add — no session/query context (sync, no async)", async () => {
    const api = apiWithConfig();
    manifest.register(api);
    await Promise.resolve();

    const lines = api.capabilities[0]!.promptBuilder!({});
    expect(Array.isArray(lines)).toBe(true);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join(" ")).toMatch(/memory_search/);
    expect(lines.join(" ")).toMatch(/memory_add/);
  });

  it("flushPlanResolver returns null — we capture per agent_end, so OpenClaw's compaction-flush turn is redundant", async () => {
    const api = apiWithConfig();
    manifest.register(api);
    await Promise.resolve();

    const plan = api.capabilities[0]!.flushPlanResolver!({});
    expect(plan).toBeNull();
  });

  it("each full-mode reload re-registers the capability — OpenClaw's per-load registry must see it every cycle", async () => {
    const apiA = apiWithConfig();
    const apiB = apiWithConfig();

    manifest.register(apiA);
    manifest.register(apiB);
    await Promise.resolve();

    expect(apiA.capabilities).toHaveLength(1);
    expect(apiB.capabilities).toHaveLength(1);
  });

  it("each full-mode call wires hooks/tools/service onto its own api — OpenClaw hot-reload hands a fresh api with an empty registry per agent run, so every call must re-register", async () => {
    const apiA = apiWithConfig();
    const apiB = apiWithConfig();
    const apiC = apiWithConfig();

    manifest.register(apiA);
    manifest.register(apiB);
    manifest.register(apiC);
    await Promise.resolve();
    await Promise.resolve();

    expect(apiA.handlers.size).toBe(3);
    expect(apiB.handlers.size).toBe(3);
    expect(apiC.handlers.size).toBe(3);

    expect(apiA.toolFactories).toHaveLength(1);
    expect(apiB.toolFactories).toHaveLength(1);
    expect(apiC.toolFactories).toHaveLength(1);

    expect(apiA.registered).toHaveLength(1);
    expect(apiB.registered).toHaveLength(1);
    expect(apiC.registered).toHaveLength(1);
  });

  it("the server manager is a process-singleton — only one uvicorn lifetime regardless of how many times register() runs", async () => {
    manifest.register(apiWithConfig());
    manifest.register(apiWithConfig());
    manifest.register(apiWithConfig());
    await Promise.resolve();
    await Promise.resolve();

    expect(gralkorTsMocks.createServerManager).toHaveBeenCalledTimes(1);
    expect(startSpy).not.toHaveBeenCalled();
  });

  it("returns immediately in non-full modes without constructing a manager or binding hooks/tools", async () => {
    for (const mode of ["cli-metadata", "setup-only", "setup-runtime"] as const) {
      const api = apiWithConfig();
      (api as unknown as { registrationMode: string }).registrationMode = mode;

      manifest.register(api);
      await Promise.resolve();

      expect(gralkorTsMocks.createServerManager, `mode=${mode}`).not.toHaveBeenCalled();
      expect(api.registered, `mode=${mode}`).toHaveLength(0);
      expect(api.handlers.size, `mode=${mode}`).toBe(0);
      expect(api.toolFactories, `mode=${mode}`).toHaveLength(0);
    }

    const full = apiWithConfig();
    (full as unknown as { registrationMode: string }).registrationMode = "full";
    manifest.register(full);
    await Promise.resolve();
    expect(gralkorTsMocks.createServerManager).toHaveBeenCalledTimes(1);
    expect(full.registered).toHaveLength(1);
  });

  it("a failed call (missing dataDir) leaves the manager slot empty so a later valid call still constructs a manager", async () => {
    const broken = makeApi();
    (broken as unknown as { pluginConfig: unknown }).pluginConfig = {
      agentName: "TestAgent",
    };

    expect(() => manifest.register(broken)).toThrow(/dataDir is required/);
    expect(gralkorTsMocks.createServerManager).not.toHaveBeenCalled();

    const recovered = apiWithConfig();
    manifest.register(recovered);
    await Promise.resolve();

    expect(gralkorTsMocks.createServerManager).toHaveBeenCalledTimes(1);
    expect(recovered.registered).toHaveLength(1);
  });
});

