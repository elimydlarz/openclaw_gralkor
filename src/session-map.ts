import { sanitizeGroupId } from "@susu-eng/gralkor-ts";

/**
 * Module-level session → group map. Shared across all plugin instances
 * in the process — OpenClaw reloads plugins multiple times per event,
 * and a per-instance map would lose state on each reload. Module scope
 * survives reloads within the same Node process.
 */
const sessionGroups = new Map<string, string>();

export function setSessionGroup(sessionKey: string, agentId: string): void {
  sessionGroups.set(sessionKey, sanitizeGroupId(agentId));
}

export function getSessionGroup(sessionKey: string): string | null {
  return sessionGroups.get(sessionKey) ?? null;
}

/**
 * Gralkor requires a non-blank session_id at every boundary. Call this
 * at the top of each hook and inside each tool's execute — there is no
 * "default" bucket and no silent fallback. If OpenClaw dispatches an
 * event without a sessionKey, that's a bug in the caller's lifecycle,
 * not something this plugin masks.
 */
export function requireSessionKey(sessionKey: string | undefined | null): string {
  if (typeof sessionKey !== "string" || sessionKey.length === 0) {
    throw new Error(
      "Gralkor requires a non-blank session_id; OpenClaw did not provide a sessionKey",
    );
  }
  return sessionKey;
}

/** Reset module-level state. Test-only. */
export function resetSessionMap(): void {
  sessionGroups.clear();
}
