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
