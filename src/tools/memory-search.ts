import type { GralkorClient, Result } from "@susu-eng/gralkor-ts";
import { getSessionGroup } from "../session-map.js";

export interface MemorySearchArgs {
  query: string;
  sessionKey: string;
  /** Max facts to interpret. Forwarded as max_results. Omit to use the server default. */
  maxResults?: number;
}

/**
 * The `memory_search` ReAct tool. Calls `GralkorClient.recall` — the
 * same path the `before_prompt_build` hook uses for auto-recall. There
 * is no separate manual-search endpoint.
 *
 * Returns the recalled memory block (the server always wraps a block;
 * "no facts" and "no relevant facts" both collapse to a
 * `"No relevant memories found."` body inside the same envelope), and
 * surfaces session-map / client errors otherwise.
 */
export async function runMemorySearch(
  client: GralkorClient,
  args: MemorySearchArgs,
): Promise<Result<string>> {
  const groupId = getSessionGroup(args.sessionKey);
  if (groupId === null) return { error: "session_not_registered" };

  return client.recall(groupId, args.sessionKey, args.query, args.maxResults);
}
