import { sanitizeGroupId, type GralkorClient, type Result } from "../gralkor/index.js";
import { setSessionGroup } from "../session-map.js";

export interface BeforePromptBuildCtx {
  sessionKey: string;
  agentId: string;
  agentName: string;
  prompt: string;
}

export interface BeforePromptBuildOutput {
  prependContext?: string;
}

export async function runBeforePromptBuild(
  client: GralkorClient,
  ctx: BeforePromptBuildCtx,
): Promise<Result<BeforePromptBuildOutput>> {
  setSessionGroup(ctx.sessionKey, ctx.agentId);

  const query = ctx.prompt.trim();
  if (query === "") return { ok: {} };

  const recalled = await client.recall(
    sanitizeGroupId(ctx.agentId),
    ctx.sessionKey,
    query,
    ctx.agentName,
  );
  if ("error" in recalled) {
    console.warn(
      "[openclaw_gralkor] recall failed — continuing turn without memory context:",
      recalled.error,
    );
    return { ok: {} };
  }

  return { ok: { prependContext: recalled.ok } };
}
