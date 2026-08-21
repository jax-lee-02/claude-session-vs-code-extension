import * as fs from "fs";
import * as readline from "readline";
import * as vscode from "vscode";
import { extractText, isDisplayableUserPrompt, isRecord } from "./content";
import { isNormalizedPathWithin, isPathWithin, normalizeFsPath, normalizedDepthBelow } from "./pathUtils";
import { chooseSessionTitleRaw, toNonEmptySingleLine } from "./title";
import { ParsedSession } from "./types";

export async function parseTranscriptFile(
  transcriptPath: string,
  log: (msg: string) => void
): Promise<ParsedSession | null> {
  const stream = fs.createReadStream(transcriptPath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let sessionId: string | undefined;
  let cwd: string | undefined;
  let firstPromptRaw: string | undefined;
  let firstUserRaw: string | undefined;
  let latestExplicitTitle: string | undefined;

  try {
    for await (const line of rl) {
      if (!line.trim()) {
        continue;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch (error) {
        log(`[discovery] malformed JSON in ${transcriptPath}: ${String(error)}`);
        continue;
      }

      if (!isRecord(parsed)) {
        continue;
      }

      if (!sessionId && typeof parsed.sessionId === "string" && parsed.sessionId.trim() !== "") {
        sessionId = parsed.sessionId;
      }

      if (!cwd && typeof parsed.cwd === "string" && parsed.cwd.trim() !== "") {
        cwd = parsed.cwd;
      }

      if (parsed.type === "custom-title") {
        const customTitle = toNonEmptySingleLine(parsed.customTitle);
        if (customTitle) {
          latestExplicitTitle = customTitle;
        }
      }

      if (parsed.type === "agent-name") {
        const agentName = toNonEmptySingleLine(parsed.agentName);
        if (agentName) {
          latestExplicitTitle = agentName;
        }
      }

      if (parsed.type === "user" && parsed.message?.role === "user") {
        const text = extractText(parsed.message.content);
        if (text.trim()) {
          if (!firstUserRaw) {
            firstUserRaw = text;
          }
          if (!firstPromptRaw && isDisplayableUserPrompt(text)) {
            firstPromptRaw = text;
          }
        }
      }
    }
  } finally {
    rl.close();
    stream.close();
  }

  if (!sessionId || !cwd) {
    return null;
  }

  return {
    sessionId,
    cwd,
    titleSourceRaw:
      chooseSessionTitleRaw({
        latestExplicitTitle,
        firstPromptRaw,
        firstUserRaw
      }) ?? ""
  };
}

export function matchWorkspace(
  sessionCwd: string,
  workspaceFolders: readonly vscode.WorkspaceFolder[]
): vscode.WorkspaceFolder | undefined {
  const normalizedCwd = normalizeFsPath(sessionCwd);
  const matching = workspaceFolders
    .filter((folder) => isPathWithin(normalizedCwd, normalizeFsPath(folder.uri.fsPath)))
    .sort((a, b) => b.uri.fsPath.length - a.uri.fsPath.length);

  return matching[0];
}

export interface NormalizedWorkspaceFolder {
  readonly folder: vscode.WorkspaceFolder;
  readonly normalizedPath: string;
  /** Per-folder depth limit; undefined falls back to the value passed to matchWorkspacePrecomputed. */
  readonly maxDepth?: number;
}

/**
 * `resolveMaxDepth` lets each folder carry its own depth limit, so a folder-scoped
 * setting (e.g. `0` in `~/.vscode/settings.json`) overrides the user-level value.
 */
export function precomputeWorkspacePaths(
  workspaceFolders: readonly vscode.WorkspaceFolder[],
  resolveMaxDepth?: (folder: vscode.WorkspaceFolder) => number
): NormalizedWorkspaceFolder[] {
  return workspaceFolders
    .map((folder) => ({
      folder,
      normalizedPath: normalizeFsPath(folder.uri.fsPath),
      maxDepth: resolveMaxDepth?.(folder)
    }))
    .sort((a, b) => b.normalizedPath.length - a.normalizedPath.length);
}

/**
 * Match a session cwd to the most specific workspace folder that contains it.
 * When maxDepth >= 0, a session is only matched if its cwd is at most maxDepth
 * sub-folders below the workspace root (0 = root itself only, 1 = direct
 * children, ...). maxDepth < 0 means unlimited (original behavior). An entry that
 * carries its own `maxDepth` uses that value instead of the `maxDepth` argument.
 * `precomputed` is sorted longest-path first, so the first hit is the
 * most-specific folder.
 */
export function matchWorkspacePrecomputed(
  sessionCwd: string,
  precomputed: readonly NormalizedWorkspaceFolder[],
  maxDepth = -1
): vscode.WorkspaceFolder | undefined {
  const normalizedCwd = normalizeFsPath(sessionCwd);
  for (const entry of precomputed) {
    if (!isNormalizedPathWithin(normalizedCwd, entry.normalizedPath)) {
      continue;
    }
    const effectiveMaxDepth = entry.maxDepth ?? maxDepth;
    if (effectiveMaxDepth >= 0 && normalizedDepthBelow(normalizedCwd, entry.normalizedPath) > effectiveMaxDepth) {
      continue;
    }
    return entry.folder;
  }
  return undefined;
}
