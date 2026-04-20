import type { GralkorClient, Result } from "@susu-eng/gralkor-ts";
import { ctxToTurn, type MessageEntry } from "../ctx-to-turn.js";
import { getSessionGroup } from "../session-map.js";

export interface AgentEndCtx {
  sessionKey: string;
  messages: MessageEntry[];
  autoCapture: boolean;
}

/**
 * `agent_end` hook: OpenClaw fires this at the end of an agent run.
 *
 * In the old architecture this handler buffered the messages client-side
 * via a keyed debouncer and later flushed them as a whole-session episode.
 * In the Python-server-heavy architecture, the server owns the capture
 * buffer — so all this hook does is extract the just-finished turn and
 * POST it to `/capture`. The server appends to its session-keyed buffer
 * and flushes on idle (or on explicit `session_end`).
 *
 * Skipped when:
 *   - autoCapture is off,
 *   - ctx has no messages,
 *   - ctx doesn't contain both a user message and a final assistant
 *     message (nothing coherent to capture).
 */
export async function runAgentEnd(
  client: GralkorClient,
  ctx: AgentEndCtx,
): Promise<Result<true>> {
  if (!ctx.autoCapture) return { ok: true };
  if (ctx.messages.length === 0) return { ok: true };

  const turn = ctxToTurn(ctx.messages);
  if (turn === null) return { ok: true };

  const groupId = getSessionGroup(ctx.sessionKey);
  if (groupId === null) return { error: "session_not_registered" };

  return client.capture(ctx.sessionKey, groupId, turn);
}
