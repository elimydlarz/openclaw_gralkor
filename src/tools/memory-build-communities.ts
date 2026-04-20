import type { GralkorClient, Result } from "@susu-eng/gralkor-ts";
import { getSessionGroup } from "../session-map.js";

export interface MemoryBuildCommunitiesArgs {
  sessionKey: string;
}

/**
 * The `memory_build_communities` admin tool. Thin wrapper around
 * `GralkorClient.buildCommunities`. Runs Graphiti's community detection
 * over the session's group partition — expensive-ish but improves search
 * quality by clustering related entities.
 *
 * Per-group rather than whole-graph, so the session must be registered
 * (via `before_prompt_build`) before this can fire. Returns
 * `session_not_registered` rather than silently routing to `"default"`.
 */
export async function runMemoryBuildCommunities(
  client: GralkorClient,
  args: MemoryBuildCommunitiesArgs,
): Promise<Result<{ communities: number; edges: number }>> {
  const groupId = getSessionGroup(args.sessionKey);
  if (groupId === null) return { error: "session_not_registered" };

  return client.buildCommunities(groupId);
}
