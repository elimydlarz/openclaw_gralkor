import type { GralkorClient, Result } from "@susu-eng/gralkor-ts";
import { ctxToTurn, type MessageEntry } from "../ctx-to-turn.js";
import { getSessionGroup } from "../session-map.js";

export interface AgentEndCtx {
  sessionKey: string;
  messages: MessageEntry[];
  autoCapture: boolean;
}

/**
 * OpenClaw's `llm-slug-generator` runs an embedded sub-agent with this fixed
 * `sessionKey` to produce a filename for `/new`/`/reset` memory archival. It
 * fires `agent_end` like any other run; without this guard the sub-agent's
 * prompt (which contains an inline dump of the real conversation) would be
 * captured as if it were a user turn.
 */
const SLUG_GENERATOR_SESSION_KEY = "temp:slug-generator";

/**
 * OpenClaw's session-reset flow replaces the user's `/new` or `/reset` command
 * with a synthetic meta-prompt instructing the agent to run its startup
 * sequence and greet the user. Stable prefix from
 * `openclaw/src/auto-reply/reply/session-reset-prompt.ts`.
 */
const SESSION_RESET_PROMPT_PREFIX = "A new session was started via /new or /reset";

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

  if (ctx.sessionKey === SLUG_GENERATOR_SESSION_KEY) return { ok: true };

  const turn = ctxToTurn(ctx.messages);
  if (turn === null) return { ok: true };

  if (turn.user_query.startsWith(SESSION_RESET_PROMPT_PREFIX)) return { ok: true };

  const groupId = getSessionGroup(ctx.sessionKey);
  if (groupId === null) return { error: "session_not_registered" };

  return client.capture(ctx.sessionKey, groupId, turn);
}
