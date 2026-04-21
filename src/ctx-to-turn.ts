import type { Turn } from "@susu-eng/gralkor-ts";

interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  [key: string]: unknown;
}

export interface MessageEntry {
  role: string;
  content: string | ContentBlock[];
}

/**
 * Reduce an OpenClaw `agent_end` message list to a single `{user_query,
 * assistant_answer, events}` Turn that the Gralkor `/capture` endpoint
 * accepts.
 *
 * Conventions:
 * - The **trailing** user message is the turn's query (earlier user
 *   messages belong to earlier turns, already captured separately).
 * - The **final** assistant message's text content is the answer.
 * - Everything between the trailing user message and the final assistant
 *   message (thinking blocks, tool calls, tool results, intermediate
 *   assistant messages) is the `events` list — passed through verbatim
 *   so the server can distil it without the client needing to understand
 *   provider-specific block shapes.
 *
 * Returns `null` if the ctx doesn't contain both a user message and a
 * final assistant message — the hook skips capture in that case.
 */
export function ctxToTurn(messages: MessageEntry[]): Turn | null {
  if (messages.length === 0) return null;

  const lastUserIdx = findLastIndex(messages, (m) => m.role === "user");
  if (lastUserIdx === -1) return null;

  // Find the last assistant message at or after lastUserIdx.
  let lastAssistantIdx = -1;
  for (let i = messages.length - 1; i > lastUserIdx; i--) {
    if (messages[i].role === "assistant") {
      lastAssistantIdx = i;
      break;
    }
  }
  if (lastAssistantIdx === -1) return null;

  const user_query = stripInboundMetadataBlocks(
    textFromContent(messages[lastUserIdx].content),
  );
  const assistant_answer = textFromContent(messages[lastAssistantIdx].content);

  const events: unknown[] = messages.slice(lastUserIdx + 1, lastAssistantIdx);

  return { user_query, assistant_answer, events };
}

function findLastIndex<T>(arr: T[], pred: (item: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (pred(arr[i])) return i;
  }
  return -1;
}

function textFromContent(content: string | ContentBlock[]): string {
  if (typeof content === "string") return content;
  return content
    .filter((b) => b.type === "text" || b.type === "output_text")
    .map((b) => b.text ?? "")
    .join("");
}

/**
 * OpenClaw prepends `Conversation info (untrusted metadata):` and
 * `Sender (untrusted metadata):` ```json fenced blocks to channel-inbound
 * user messages so the LLM has routing context. Those blocks are harness
 * scaffolding — not semantic user content — so strip them from the text
 * we capture as `user_query`. Order-insensitive; both blocks are removed
 * if present.
 */
const INBOUND_METADATA_BLOCK =
  /^(Conversation info|Sender) \(untrusted metadata\):[ \t]*\n```json\n[\s\S]*?\n```[ \t]*\n*/;

function stripInboundMetadataBlocks(text: string): string {
  let remaining = text;
  while (INBOUND_METADATA_BLOCK.test(remaining)) {
    remaining = remaining.replace(INBOUND_METADATA_BLOCK, "");
  }
  return remaining;
}
