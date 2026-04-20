import type { GralkorClient, Result } from "@susu-eng/gralkor-ts";
import type { MessageEntry } from "../ctx-to-turn.js";
import { setSessionGroup } from "../session-map.js";

export interface BeforePromptBuildCtx {
  sessionKey: string;
  agentId: string;
  messages: MessageEntry[];
  autoRecall: boolean;
}

export interface BeforePromptBuildOutput {
  prependContext?: string;
}

/**
 * `before_prompt_build` hook: OpenClaw fires this just before assembling
 * the prompt. Two responsibilities:
 *
 * 1. **Register the session → group mapping** (unconditionally) so
 *    `agent_end`, `session_end`, and the `memory_*` tools can find the
 *    groupId later.
 * 2. **Auto-recall** (if enabled and a query can be extracted): ask
 *    Gralkor for relevant memory and inject it into the prompt via
 *    `prependContext`.
 *
 * "Query" is the trailing user message's text — the thing this turn is
 * actually about. Earlier user messages belong to past turns already
 * captured.
 */
export async function runBeforePromptBuild(
  client: GralkorClient,
  ctx: BeforePromptBuildCtx,
): Promise<Result<BeforePromptBuildOutput>> {
  setSessionGroup(ctx.sessionKey, ctx.agentId);

  if (!ctx.autoRecall) return { ok: {} };

  const query = trailingUserText(ctx.messages);
  if (query === null) return { ok: {} };

  // getSessionGroup would return the just-set value; use it for clarity.
  const groupId = ctx.agentId.replace(/-/g, "_");

  const recalled = await client.recall(groupId, ctx.sessionKey, query);
  if ("error" in recalled) return { error: recalled.error };

  if (recalled.ok === null) return { ok: {} };
  return { ok: { prependContext: recalled.ok } };
}

function trailingUserText(messages: MessageEntry[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      const c = messages[i].content;
      const text = typeof c === "string" ? c : textFromBlocks(c);
      return text.length > 0 ? text : null;
    }
  }
  return null;
}

function textFromBlocks(
  blocks: { type: string; text?: string }[],
): string {
  return blocks
    .filter((b) => b.type === "text" || b.type === "output_text")
    .map((b) => b.text ?? "")
    .join("");
}
