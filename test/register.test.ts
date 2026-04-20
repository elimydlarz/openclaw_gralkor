import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ServerManager } from "@susu-eng/gralkor-ts";
import { registerServerService } from "../src/register.js";
import type { GralkorPluginConfig } from "../src/config.js";
import type { MemoryPluginApi } from "../src/types.js";

const gralkorTsMocks = vi.hoisted(() => ({
  createServerManager: vi.fn<[], ServerManager>(),
  waitForHealth: vi.fn(async () => {}),
  GralkorHttpClient: vi.fn(() => ({})),
  GRALKOR_URL: "http://127.0.0.1:4000",
}));

vi.mock("@susu-eng/gralkor-ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@susu-eng/gralkor-ts")>();
  return {
    ...actual,
    createServerManager: gralkorTsMocks.createServerManager,
    waitForHealth: gralkorTsMocks.waitForHealth,
    GralkorHttpClient: gralkorTsMocks.GralkorHttpClient,
    GRALKOR_URL: gralkorTsMocks.GRALKOR_URL,
  };
});

function makeApi(): MemoryPluginApi & {
  registered: { id: string; start: () => unknown; stop: () => unknown }[];
} {
  const registered: { id: string; start: () => unknown; stop: () => unknown }[] = [];
  return {
    on: vi.fn(),
    registerTool: vi.fn(),
    registerCli: vi.fn(),
    registerService: vi.fn((svc) => {
      registered.push(svc);
    }),
    registered,
  } as unknown as MemoryPluginApi & {
    registered: { id: string; start: () => unknown; stop: () => unknown }[];
  };
}

function makeConfig(overrides: Partial<GralkorPluginConfig> = {}): GralkorPluginConfig {
  return {
    dataDir: "/tmp/fake-gralkor",
    autoCapture: { enabled: true },
    autoRecall: { enabled: true, maxResults: 10 },
    search: { maxResults: 20, maxEntityResults: 10 },
    test: false,
    ...overrides,
  } as GralkorPluginConfig;
}

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
