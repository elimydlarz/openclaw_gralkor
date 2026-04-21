import { vi } from "vitest";
import type { GralkorPluginConfig } from "../src/config.js";
import type { MemoryPluginApi } from "../src/types.js";

/**
 * OpenClaw dispatches hooks as `handler(event, ctx)` — see
 * OPENCLAW_INTEGRATION_2026-04-02.md. The fake mirrors that shape so
 * tests exercise the real boundary contract, not a collapsed one-arg
 * fiction.
 */
export type HookHandler = (event: unknown, ctx: unknown) => Promise<unknown>;

export type TestApi = MemoryPluginApi & {
  registered: { id: string; start: () => unknown; stop: () => unknown }[];
  handlers: Map<string, HookHandler>;
  toolFactories: ((ctx: unknown) => unknown)[];
};

export function makeApi(): TestApi {
  const registered: { id: string; start: () => unknown; stop: () => unknown }[] = [];
  const handlers = new Map<string, HookHandler>();
  const toolFactories: ((ctx: unknown) => unknown)[] = [];
  return {
    on: vi.fn((event: string, handler: HookHandler) => {
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
