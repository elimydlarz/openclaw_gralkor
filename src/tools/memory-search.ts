import type { GralkorClient, Result } from "@susu-eng/gralkor-ts";
import { getSessionGroup } from "../session-map.js";

export interface MemorySearchArgs {
  query: string;
  sessionKey: string;
  /** Max facts to interpret. Forwarded as max_results. Omit to use the server default. */
  maxResults?: number;
  /** Max entity summaries to interpret. Forwarded as max_entity_results. Omit to use the server default. */
  maxEntityResults?: number;
}

/**
 * The `memory_search` ReAct tool. Thin wrapper around
 * `GralkorClient.memorySearch` — server does the interpretation, so the
 * tool result is the server's `text` field verbatim.
 *
 * Fail-fast on unregistered sessions: the session map must have been
 * populated by `before_prompt_build` before any tool fires. If it hasn't,
 * we surface `session_not_registered` rather than silently routing to
 * the `"default"` group (which would mix memories across agents).
 */
export async function runMemorySearch(
  client: GralkorClient,
  args: MemorySearchArgs,
): Promise<Result<string>> {
  const groupId = getSessionGroup(args.sessionKey);
  if (groupId === null) return { error: "session_not_registered" };

  return client.memorySearch(
    groupId,
    args.sessionKey,
    args.query,
    args.maxResults,
    args.maxEntityResults,
  );
}
