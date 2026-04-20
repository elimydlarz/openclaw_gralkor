import { readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { GralkorClient } from "@susu-eng/gralkor-ts";

export const GRALKOR_MARKER = "<!-- GRALKOR:INDEXED -->";

export interface DiscoveredFile {
  absPath: string;
  relPath: string;
  groupId: string;
}

/**
 * Discover native OpenClaw memory files under workspaceDir.
 *
 * Paths scanned:
 *   {workspaceDir}/MEMORY.md       → groupId (provided by caller)
 *   {workspaceDir}/memory/*.md     → groupId (provided by caller)
 *
 * The caller (before_prompt_build) knows the agentId and thus the correct
 * group — no routing logic needed here.
 */
export async function discoverFiles(
  workspaceDir: string,
  groupId: string,
): Promise<DiscoveredFile[]> {
  if (!existsSync(workspaceDir)) return [];

  const files: DiscoveredFile[] = [];

  const rootMemory = join(workspaceDir, "MEMORY.md");
  if (existsSync(rootMemory)) {
    files.push({ absPath: rootMemory, relPath: "MEMORY.md", groupId });
  }

  const memoryDir = join(workspaceDir, "memory");
  if (existsSync(memoryDir)) {
    try {
      const entries = await readdir(memoryDir);
      for (const entry of entries.sort()) {
        if (entry.endsWith(".md")) {
          files.push({
            absPath: join(memoryDir, entry),
            relPath: `memory/${entry}`,
            groupId,
          });
        }
      }
    } catch {
      /* ignore */
    }
  }

  return files;
}

/**
 * Index a single native memory file into the graph via the Gralkor client.
 *
 * Marker semantics:
 *   - No marker: ingest entire content, append marker at EOF.
 *   - Marker at EOF: skip (nothing new).
 *   - Marker mid-file: ingest content after marker, move marker to EOF.
 *
 * If the memoryAdd call fails, the file is NOT modified — next run will
 * retry. Returns true if content was ingested, false if skipped, and
 * propagates client errors as thrown exceptions so the caller can decide
 * per-file whether to continue.
 */
export async function indexFile(
  client: GralkorClient,
  file: DiscoveredFile,
): Promise<boolean> {
  const raw = await readFile(file.absPath, "utf8");
  const markerPos = raw.indexOf(GRALKOR_MARKER);

  const newContent =
    markerPos === -1
      ? raw.trim()
      : raw.slice(markerPos + GRALKOR_MARKER.length).trim();
  const prefix =
    markerPos === -1 ? raw.trimEnd() : raw.slice(0, markerPos).trimEnd();

  if (!newContent) return false;

  const result = await client.memoryAdd(file.groupId, newContent, file.relPath);
  if ("error" in result) {
    throw new Error(
      `memoryAdd failed for ${file.relPath}: ${JSON.stringify(result.error)}`,
    );
  }

  const body = markerPos === -1 ? prefix : `${prefix}\n${newContent}`;
  await writeFile(file.absPath, `${body}\n${GRALKOR_MARKER}\n`);
  return true;
}

/**
 * Scan the workspace for native memory files and index any new content
 * into the graph. Fire-and-forget safe — per-file errors are caught and
 * logged; the loop continues.
 *
 * Called from before_prompt_build on each session start. Already-indexed
 * files (marker at EOF) cost only a disk read + string search, so
 * calling every session is cheap.
 */
export async function runNativeIndexer(
  client: GralkorClient,
  workspaceDir: string,
  groupId: string,
): Promise<void> {
  if (!existsSync(workspaceDir)) {
    console.log(
      `[gralkor] native-index: workspaceDir not found (${workspaceDir}) — skipping`,
    );
    return;
  }

  const files = await discoverFiles(workspaceDir, groupId);
  if (files.length === 0) return;

  let indexed = 0;
  for (const file of files) {
    try {
      const ingested = await indexFile(client, file);
      if (ingested) {
        indexed++;
        console.log(
          `[gralkor] native-index: indexed ${file.relPath} → ${file.groupId}`,
        );
      }
    } catch (err) {
      console.log(
        `[gralkor] native-index: error on ${file.relPath} — ${
          err instanceof Error ? err.message : err
        }`,
      );
    }
  }

  if (indexed > 0) {
    console.log(`[gralkor] native-index: done — ${indexed} file(s) ingested`);
  }
}
