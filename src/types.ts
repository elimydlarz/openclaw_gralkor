/**
 * OpenClaw plugin API surface used by this plugin.
 *
 * OpenClaw doesn't export types, so we define the subset we use here.
 * Keep in sync with the OpenClaw plugin contract.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

export type RegistrationMode =
  | "full"
  | "discovery"
  | "tool-discovery"
  | "setup-only"
  | "setup-runtime"
  | "cli-metadata";

export interface MemoryPluginApi {
  pluginConfig?: Record<string, unknown>;
  registrationMode?: RegistrationMode;
  on(event: string, handler: AnyFn): void;
  registerService(service: {
    id: string;
    start: () => void | Promise<void>;
    stop: () => void | Promise<void>;
  }): void;
  registerCli(
    registrar: (ctx: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      program: any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      config: any;
      workspaceDir?: string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      logger: any;
    }) => void | Promise<void>,
    opts?: { commands?: string[] },
  ): void;
  registerTool(
    tool: { name: string; description: string; parameters: unknown; execute: AnyFn },
    opts?: { optional?: boolean },
  ): void;
  registerTool(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    factory: (ctx: any) => any | any[] | null,
    opts?: { names?: string[] },
  ): void;
  /**
   * Declare this plugin as the active memory capability. OpenClaw 2026.5.x
   * routes the `plugins.slots.memory` slot owner through this surface — once
   * called, `openclaw plugins info` reports `Shape: memory capability`. All
   * fields are optional; an empty object is enough for slot ownership.
   *
   * `promptBuilder` is invoked synchronously during system-prompt assembly
   * with `{ availableTools, citationsMode }` and returns static lines (no
   * session/query context — recall is agent-driven via `memory_search`).
   * `flushPlanResolver` is invoked synchronously at compaction time; return
   * `null` to opt out of OpenClaw's compaction-flush turn (we capture per
   * agent_end hook, so the flush turn would be redundant).
   */
  registerMemoryCapability?(capability: {
    promptBuilder?: (params: {
      availableTools?: readonly string[];
      citationsMode?: string;
    }) => readonly string[];
    flushPlanResolver?: (params: {
      cfg?: unknown;
      nowMs?: number;
    }) => Record<string, unknown> | null;
  }): void;
}
