import type { GralkorClient, Result } from "../gralkor/index.js";

export interface MemoryAddArgs {
  groupId: string;
  content: string;
  sourceDescription?: string;
}

/**
 * The `memory_add` ReAct tool. Thin wrapper around
 * `GralkorClient.memoryAdd`. The groupId is derived from the tool ctx's
 * agentId at the register boundary. The server queues the add for async
 * ingest (Graphiti entity/edge extraction is slow) so the client side
 * returns as soon as the HTTP 2xx comes back; that's what `{ ok: true }`
 * means here.
 */
export async function runMemoryAdd(
  client: GralkorClient,
  args: MemoryAddArgs,
): Promise<Result<true>> {
  return client.memoryAdd(args.groupId, args.content, args.sourceDescription ?? null);
}
