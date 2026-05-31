import type { GralkorClient, Result } from "../gralkor/index.js";

export interface MemoryBuildCommunitiesArgs {
  groupId: string;
}

/**
 * The `memory_build_communities` admin tool. Thin wrapper around
 * `GralkorClient.buildCommunities`. Runs Graphiti's community detection
 * over the agent's group partition — expensive-ish but improves search
 * quality by clustering related entities.
 *
 * Per-group rather than whole-graph; the groupId is derived from the
 * tool ctx's agentId at the register boundary.
 */
export async function runMemoryBuildCommunities(
  client: GralkorClient,
  args: MemoryBuildCommunitiesArgs,
): Promise<Result<{ communities: number; edges: number }>> {
  return client.buildCommunities(args.groupId);
}
