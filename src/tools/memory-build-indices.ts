import type { GralkorClient, Result } from "@susu-eng/gralkor-ts";

/**
 * The `memory_build_indices` admin tool. Thin wrapper around
 * `GralkorClient.buildIndices`. Rebuilds the Graphiti search indices —
 * idempotent, safe to run any time, but only useful after schema changes
 * or when search behaviour looks stale. Operates across the whole graph
 * (not per-group).
 */
export async function runMemoryBuildIndices(
  client: GralkorClient,
): Promise<Result<{ status: string }>> {
  return client.buildIndices();
}
