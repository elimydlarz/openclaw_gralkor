import type { GralkorClient, Result } from "../gralkor/index.js";

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
 * The server is the authority on whether there is anything to flush — a
 * session_end for a session it never buffered is a 204 no-op there — so
 * this hook always forwards rather than guessing at server-side state.
 */
export async function runSessionEnd(
  client: GralkorClient,
  ctx: SessionEndCtx,
): Promise<Result<true>> {
  return client.endSession(ctx.sessionKey);
}
