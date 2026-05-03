import type { GralkorClient, Result } from "@susu-eng/gralkor-ts";
import { getSessionGroup } from "../session-map.js";

export interface SessionEndCtx {
  sessionKey: string;
}

/**
 * `session_end` hook: an OpenClaw-owned signal that a conversation is
 * over. We forward it to Gralkor's `/session_end` endpoint so the
 * server flushes that session's capture buffer immediately rather than
 * waiting for lifespan shutdown. Server handles the graph write async
 * and returns 204, so this call is effectively fire-and-forget from a
 * latency standpoint.
 *
 * If the sessionKey was never seen by `before_prompt_build` (e.g.
 * session_end fires on a fresh process with no prior activity), there
 * is nothing to flush — skip the HTTP call and return ok.
 */
export async function runSessionEnd(
  client: GralkorClient,
  ctx: SessionEndCtx,
): Promise<Result<true>> {
  if (getSessionGroup(ctx.sessionKey) === null) return { ok: true };
  return client.endSession(ctx.sessionKey);
}
