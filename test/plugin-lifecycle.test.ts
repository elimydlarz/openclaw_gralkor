import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ServerManager } from "@susulabs/gralkor-ts";
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

vi.mock("@susulabs/gralkor-ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@susulabs/gralkor-ts")>();
  return {
    ...actual,
    createServerManager: gralkorTsMocks.createServerManager,
    waitForHealth: gralkorTsMocks.waitForHealth,
    GralkorHttpClient: gralkorTsMocks.GralkorHttpClient,
    GRALKOR_URL: gralkorTsMocks.GRALKOR_URL,
  };
});

describe("plugin manifest exports", () => {
  it("id is 'openclaw-gralkor'", () => {
    expect(manifest.id).toBe("openclaw-gralkor");
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
    it("fires manager.start() fire-and-forget immediately (self-start)", async () => {
      const api = makeApi();
      const config = makeConfig();

      registerServerService(api, config, "1.1.2-test");

      // Yield so any microtasks queued by fire-and-forget can run.
      await Promise.resolve();
      await Promise.resolve();

      expect(startSpy).toHaveBeenCalledTimes(1);
    });

    it("also registers a gralkor-server service for graceful shutdown", () => {
      const api = makeApi();
      const config = makeConfig();

      registerServerService(api, config, "1.1.2-test");

      expect(api.registered).toHaveLength(1);
      expect(api.registered[0].id).toBe("gralkor-server");
      expect(typeof api.registered[0].stop).toBe("function");
    });

    it("does not await start() — returns synchronously so OpenClaw's register pipeline is not blocked", () => {
      const api = makeApi();
      const config = makeConfig();

      let resolved = false;
      startSpy.mockImplementation(
        () =>
          new Promise<void>((r) => {
            setTimeout(() => {
              resolved = true;
              r();
            }, 5_000);
          }),
      );

      registerServerService(api, config, "1.1.2-test");

      expect(resolved).toBe(false);
    });

    it("throws immediately if dataDir is missing", () => {
      const api = makeApi();
      const config = makeConfig({ dataDir: undefined });

      expect(() => registerServerService(api, config, "1.1.2-test")).toThrow(
        /dataDir is required/,
      );
      expect(startSpy).not.toHaveBeenCalled();
    });
  });
});

describe("register() idempotence (plugin-lifecycle tree)", () => {
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

  it("first call constructs the manager, starts it, and binds hooks/tools/service", async () => {
    const api = apiWithConfig();

    manifest.register(api);
    await Promise.resolve();
    await Promise.resolve();

    expect(gralkorTsMocks.createServerManager).toHaveBeenCalledTimes(1);
    expect(startSpy).toHaveBeenCalledTimes(1);
    expect(api.registered).toHaveLength(1);
    expect(api.handlers.size).toBe(3);
    expect(api.toolFactories).toHaveLength(1);
  });

  it("second-and-subsequent calls are no-ops — no second manager, no second start, no second bind", async () => {
    const apiA = apiWithConfig();
    const apiB = apiWithConfig();
    const apiC = apiWithConfig();

    manifest.register(apiA);
    manifest.register(apiB);
    manifest.register(apiC);
    await Promise.resolve();
    await Promise.resolve();

    expect(gralkorTsMocks.createServerManager).toHaveBeenCalledTimes(1);
    expect(startSpy).toHaveBeenCalledTimes(1);
    expect(apiA.registered).toHaveLength(1);
    expect(apiB.registered).toHaveLength(0);
    expect(apiC.registered).toHaveLength(0);
    expect(apiB.handlers.size).toBe(0);
    expect(apiC.toolFactories).toHaveLength(0);
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

  it("a failed first call (missing dataDir) leaves the flag unset so a later valid call still registers", async () => {
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

