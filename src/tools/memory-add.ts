import type { GralkorClient, Result } from "@susu-eng/gralkor-ts";
import { getSessionGroup } from "../session-map.js";

export interface MemoryAddArgs {
  sessionKey: string;
  content: string;
  sourceDescription?: string;
}

/**
 * The `memory_add` ReAct tool. Thin wrapper around
 * `GralkorClient.memoryAdd`. The server queues the add for async ingest
 * (Graphiti entity/edge extraction is slow) so the client side returns
 * as soon as the HTTP 2xx comes back; that's what `{ ok: true }` means
 * here.
 */
export async function runMemoryAdd(
  client: GralkorClient,
  args: MemoryAddArgs,
): Promise<Result<true>> {
  const groupId = getSessionGroup(args.sessionKey);
  if (groupId === null) return { error: "session_not_registered" };

  return client.memoryAdd(groupId, args.content, args.sourceDescription ?? null);
}
