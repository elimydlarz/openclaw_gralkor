import { vi } from "vitest";
import type { GralkorPluginConfig } from "../src/config.js";
import type { MemoryPluginApi } from "../src/types.js";

export type TestApi = MemoryPluginApi & {
  registered: { id: string; start: () => unknown; stop: () => unknown }[];
  handlers: Map<string, (event: unknown) => Promise<unknown>>;
  toolFactories: ((ctx: unknown) => unknown)[];
};

export function makeApi(): TestApi {
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
  } as unknown as TestApi;
}

export function makeConfig(
  overrides: Partial<GralkorPluginConfig> = {},
): GralkorPluginConfig {
  return {
    dataDir: "/tmp/fake-gralkor",
    autoCapture: { enabled: true },
    autoRecall: { enabled: true, maxResults: 10 },
    search: { maxResults: 20, maxEntityResults: 10 },
    test: false,
    ...overrides,
  } as GralkorPluginConfig;
}
