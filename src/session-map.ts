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
 * Derive the Gralkor session_id the server should see for this OpenClaw
 * invocation. OpenClaw's sessionKey is the natural choice when present
 * (one per conversation). When absent, agentId is the next-best unique
 * identifier — it at least keeps different agents from colliding. Only
 * when neither is present do we fall back to the shared "default" bucket,
 * and callers should treat that as a degenerate case.
 */
export function resolveSessionId(
  sessionKey: string | undefined,
  agentId: string | undefined,
): string {
  if (sessionKey) return sessionKey;
  if (agentId) return agentId;
  return "default";
}

/** Reset module-level state. Test-only. */
export function resetSessionMap(): void {
  sessionGroups.clear();
}
