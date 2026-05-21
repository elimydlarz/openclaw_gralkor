import type { Message } from "@susulabs/gralkor-ts";

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
 * Reduce an OpenClaw `agent_end` message list to the canonical Gralkor
 * `Message[]` shape that `/capture` accepts.
 *
 * Conventions:
 * - The **trailing** user message becomes a `"user"` Message (its earlier
 *   peers belong to past turns already captured).
 * - The **final** assistant message becomes a `"assistant"` Message.
 * - Each intermediate message between the trailing user and final assistant
 *   (thinking blocks, tool calls, tool results, intermediate assistant text)
 *   becomes a `"behaviour"` Message rendered as a string the server's
 *   distillation LLM can read.
 *
 * Returns `null` if the ctx doesn't contain both a user message and a final
 * assistant message — the hook skips capture in that case.
 *
 * The leading `Conversation info`/`Sender (untrusted metadata)` JSON blocks
 * that OpenClaw prepends to channel-inbound user messages are stripped here
 * before the user message is emitted, so harness scaffolding never reaches
 * the graph.
 */
export function ctxToMessages(messages: MessageEntry[]): Message[] | null {
  if (messages.length === 0) return null;

  const lastUserIdx = findLastIndex(messages, (m) => m.role === "user");
  if (lastUserIdx === -1) return null;

  let lastAssistantIdx = -1;
  for (let i = messages.length - 1; i > lastUserIdx; i--) {
    if (messages[i].role === "assistant") {
      lastAssistantIdx = i;
      break;
    }
  }
  if (lastAssistantIdx === -1) return null;

  const userText = stripInboundMetadataBlocks(textFromContent(messages[lastUserIdx].content));
  const assistantText = textFromContent(messages[lastAssistantIdx].content);

  const out: Message[] = [{ role: "user", content: userText }];

  for (let i = lastUserIdx + 1; i < lastAssistantIdx; i++) {
    const rendered = renderBehaviour(messages[i]);
    if (rendered !== null) out.push({ role: "behaviour", content: rendered });
  }

  out.push({ role: "assistant", content: assistantText });
  return out;
}

function findLastIndex<T>(arr: T[], pred: (item: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (pred(arr[i])) return i;
  }
  return -1;
}

export function textFromContent(content: string | ContentBlock[]): string {
  if (typeof content === "string") return content;
  return content
    .filter((b) => b.type === "text" || b.type === "output_text")
    .map((b) => b.text ?? "")
    .join("");
}

const ANSI_RE = /\x1B\[[0-?]*[ -/]*[@-~]/g;
const MAX_BEHAVIOUR_BODY_CHARS = 500;

function cleanBody(text: string): string {
  const stripped = text.replace(ANSI_RE, "").trim();
  if (stripped.length <= MAX_BEHAVIOUR_BODY_CHARS) return stripped;
  return `${stripped.slice(0, MAX_BEHAVIOUR_BODY_CHARS)}… [truncated]`;
}

/**
 * Render a single intermediate ctx message as a `"behaviour"` Message body.
 * Returns `null` for entries with no useful content (so the caller can drop
 * them entirely rather than emit empty behaviour messages).
 */
function renderBehaviour(entry: MessageEntry): string | null {
  if (entry.role === "toolResult") {
    const body = cleanBody(textFromContent(entry.content));
    return body === "" ? null : `toolResult: ${body}`;
  }

  if (typeof entry.content === "string") {
    const trimmed = entry.content.trim();
    return trimmed === "" ? null : `${entry.role}: ${trimmed}`;
  }

  const parts: string[] = [];
  for (const block of entry.content) {
    const rendered = renderBlock(block);
    if (rendered !== null) parts.push(rendered);
  }
  if (parts.length === 0) return null;
  return parts.join("\n");
}

function renderBlock(block: ContentBlock): string | null {
  if (block.type === "thinking" && typeof block.thinking === "string") {
    const t = block.thinking.trim();
    return t === "" ? null : `thought: ${t}`;
  }
  if ((block.type === "text" || block.type === "output_text") && typeof block.text === "string") {
    const body = cleanBody(block.text);
    return body === "" ? null : `text: ${body}`;
  }
  if (block.type === "toolCall" || block.type === "toolUse" || block.type === "tool_use") {
    const name = typeof block.name === "string" ? block.name : "tool";
    const argsField =
      "arguments" in block ? block.arguments : "input" in block ? block.input : undefined;
    const argsStr = argsField === undefined ? "" : JSON.stringify(argsField);
    return `tool ${name}${argsStr ? ` ← ${argsStr}` : ""}`;
  }
  if (block.type === "toolResult" || block.type === "tool_result") {
    const text = typeof block.text === "string" ? block.text : JSON.stringify(block);
    return `tool result → ${cleanBody(text)}`;
  }
  return null;
}

const INBOUND_METADATA_BLOCK =
  /^(?:(?:Conversation info|Sender) \(untrusted metadata\):[ \t]*\n```json\n[\s\S]*?\n```[ \t]*\n*)+/;

function stripInboundMetadataBlocks(text: string): string {
  return text.replace(INBOUND_METADATA_BLOCK, "");
}
