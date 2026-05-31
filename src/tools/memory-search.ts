import type { GralkorClient, Result } from "../gralkor/index.js";

export interface MemorySearchArgs {
  query: string;
  groupId: string;
  sessionKey: string;
  agentName: string;
  /** Max facts to interpret. Forwarded as max_results. Omit to use the server default. */
  maxResults?: number;
}

/**
 * The `memory_search` ReAct tool. Calls `GralkorClient.recall` — the
 * same path the `before_prompt_build` hook uses for auto-recall. There
 * is no separate manual-search endpoint.
 *
 * The groupId is derived from the tool ctx's agentId at the register
 * boundary, exactly as recall derives it — so search hits the right
 * partition regardless of whether before_prompt_build ran first in this
 * process.
 *
 * Returns the recalled memory block (the server always wraps a block;
 * "no facts" and "no relevant facts" both collapse to a
 * `"No relevant memories found."` body inside the same envelope), and
 * surfaces client errors otherwise.
 */
export async function runMemorySearch(
  client: GralkorClient,
  args: MemorySearchArgs,
): Promise<Result<string>> {
  return client.recall(
    args.groupId,
    args.sessionKey,
    args.query,
    args.agentName,
    args.maxResults,
  );
}
