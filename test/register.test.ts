import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ServerManager, GralkorClient } from "@susu-eng/gralkor-ts";
import { GralkorInMemoryClient } from "@susu-eng/gralkor-ts/testing";
import {
  registerServerService,
  registerHooks,
  registerTools,
} from "../src/register.js";
import type { GralkorPluginConfig } from "../src/config.js";
import type { MemoryPluginApi } from "../src/types.js";
import { resetSessionMap } from "../src/session-map.js";

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
  handlers: Map<string, (event: unknown) => Promise<unknown>>;
  toolFactories: ((ctx: unknown) => unknown)[];
} {
  const registered: { id: string; start: () => unknown; stop: () => unknown }[] = [];
  const handlers = new Map<string, (event: unknown) => Promise<unknown>>();
  const toolFactories: ((ctx: unknown) => unknown)[] = [];
  return {
    on: vi.fn((event: string, handler: (event: unknown) => Promise<unknown>) => {
      handlers.set(event, handler);
    }),
    registerTool: vi.fn((factory: (ctx: unknown) => unknown) => {
      toolFactories.push(factory);
    }),
    registerCli: vi.fn(),
    registerService: vi.fn((svc) => {
      registered.push(svc);
    }),
    registered,
    handlers,
    toolFactories,
  } as unknown as MemoryPluginApi & {
    registered: { id: string; start: () => unknown; stop: () => unknown }[];
    handlers: Map<string, (event: unknown) => Promise<unknown>>;
    toolFactories: ((ctx: unknown) => unknown)[];
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

describe("registerHooks — sessionKey is required", () => {
  let client: GralkorClient;
  let api: ReturnType<typeof makeApi>;

  beforeEach(() => {
    resetSessionMap();
    client = new GralkorInMemoryClient();
    api = makeApi();
    registerHooks(api, client, makeConfig());
  });

  for (const event of ["before_prompt_build", "agent_end", "session_end"] as const) {
    it(`${event} throws when the event has no sessionKey`, async () => {
      const handler = api.handlers.get(event)!;
      await expect(handler({ agentId: "user-1", messages: [] })).rejects.toThrow(
        /Gralkor requires a non-blank session_id/,
      );
    });

    it(`${event} throws when the event's sessionKey is blank`, async () => {
      const handler = api.handlers.get(event)!;
      await expect(
        handler({ sessionKey: "", agentId: "user-1", messages: [] }),
      ).rejects.toThrow(/Gralkor requires a non-blank session_id/);
    });
  }
});

describe("registerTools — sessionKey is required", () => {
  let client: GralkorClient;
  let api: ReturnType<typeof makeApi>;

  beforeEach(() => {
    resetSessionMap();
    client = new GralkorInMemoryClient();
    api = makeApi();
    registerTools(api, client);
  });

  for (const toolName of [
    "memory_search",
    "memory_add",
    "memory_build_communities",
  ] as const) {
    it(`${toolName} execute throws when ctx has no sessionKey`, async () => {
      const factory = api.toolFactories[0];
      const tools = factory({ agentId: "user-1" }) as {
        name: string;
        execute: (args: Record<string, string>) => Promise<unknown>;
      }[];
      const tool = tools.find((t) => t.name === toolName)!;
      await expect(
        tool.execute({ query: "q", content: "c" }),
      ).rejects.toThrow(/Gralkor requires a non-blank session_id/);
    });

    it(`${toolName} execute throws when ctx.sessionKey is blank`, async () => {
      const factory = api.toolFactories[0];
      const tools = factory({ sessionKey: "", agentId: "user-1" }) as {
        name: string;
        execute: (args: Record<string, string>) => Promise<unknown>;
      }[];
      const tool = tools.find((t) => t.name === toolName)!;
      await expect(
        tool.execute({ query: "q", content: "c" }),
      ).rejects.toThrow(/Gralkor requires a non-blank session_id/);
    });
  }

  it("memory_build_indices execute does not require a sessionKey (whole-graph admin)", async () => {
    const factory = api.toolFactories[0];
    const tools = factory({}) as {
      name: string;
      execute: () => Promise<string>;
    }[];
    const tool = tools.find((t) => t.name === "memory_build_indices")!;
    (client as GralkorInMemoryClient).setResponse("buildIndices", {
      ok: { status: "ok" },
    });
    await expect(tool.execute()).resolves.toMatch(/Indices rebuilt/);
  });
});
