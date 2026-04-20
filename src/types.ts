/**
 * OpenClaw plugin API surface used by this plugin.
 *
 * OpenClaw doesn't export types, so we define the subset we use here.
 * Keep in sync with the OpenClaw plugin contract.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

export interface PluginApiBase {
  pluginConfig?: Record<string, unknown>;
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
}

export interface MemoryPluginApi extends PluginApiBase {
  registerTool(
    tool: { name: string; description: string; parameters: unknown; execute: AnyFn },
    opts?: { optional?: boolean },
  ): void;
  registerTool(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    factory: (ctx: any) => any | any[] | null,
    opts?: { names?: string[] },
  ): void;
}
