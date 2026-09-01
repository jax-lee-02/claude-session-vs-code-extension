import * as fs from "fs";
import { promises as fsp } from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { SessionNode } from "../models";
import { buildTitle } from "./title";
import {
  CachedContentText,
  CachedPromptList,
  CachedSessionMeta,
  DiscoveryResult,
  ISessionDiscoveryService,
  SearchableEntry,
  SessionPrompt,
  TranscriptCandidate
} from "./types";
import { parseSessionContent } from "../search/parseContent";
import { collectTranscriptFiles, exists } from "./scan";
import { ProfileRoot, profileIdFromConfigDir, resolveProfileRoots } from "./profileRoots";
import { parseTranscriptFile, matchWorkspacePrecomputed, precomputeWorkspacePaths } from "./parseSession";
import { parseAllUserPrompts } from "./parsePrompts";

const BATCH_CONCURRENCY = 8;

export class ClaudeSessionDiscoveryService implements ISessionDiscoveryService {
  /** Fixed roots injected by tests; when unset the roots are resolved per discover(). */
  private readonly explicitRoots: ProfileRoot[] | undefined;
  private readonly promptCacheByPath = new Map<string, CachedPromptList>();
  private readonly sessionCacheByPath = new Map<string, CachedSessionMeta>();
  private readonly contentCacheByPath = new Map<string, CachedContentText>();

  public constructor(
    private readonly outputChannel: vscode.OutputChannel,
    roots?: string | readonly ProfileRoot[]
  ) {
    if (typeof roots === "string") {
      this.explicitRoots = [projectsDirToProfileRoot(roots)];
    } else if (roots) {
      this.explicitRoots = [...roots];
    } else {
      this.explicitRoots = undefined;
    }
  }

  /**
   * Configuration directories to scan. `claudeSessions.profileRoots` replaces
   * auto-discovery when set; otherwise `~/.claude`, every `~/.claude-*` holding
   * a `projects/` directory, and `CLAUDE_CONFIG_DIR` are used.
   */
  private async resolveRoots(): Promise<ProfileRoot[]> {
    if (this.explicitRoots) {
      return this.explicitRoots;
    }
    const configured = vscode.workspace.getConfiguration("claudeSessions").get<string[]>("profileRoots") ?? [];
    return resolveProfileRoots({
      homeDir: os.homedir(),
      configuredConfigDirs: Array.isArray(configured) ? configured : [],
      envConfigDir: process.env.CLAUDE_CONFIG_DIR,
      log: (msg) => this.outputChannel.appendLine(msg)
    });
  }

  /**
   * Reads claudeSessions.maxDepth for a workspace folder. Returns -1 (unlimited)
   * when unset or invalid. Value N >= 0 keeps only sessions whose cwd is at most N
   * sub-folders below that workspace root, so opening `~` no longer surfaces
   * deeply-nested projects. The setting is folder-scoped, so `~/.vscode/settings.json`
   * can hold `0` while the user-level value stays `-1`.
   */
  private readMaxDepth(folder?: vscode.WorkspaceFolder): number {
    const raw = vscode.workspace.getConfiguration("claudeSessions", folder?.uri).get<number>("maxDepth");
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) {
      return -1;
    }
    return Math.floor(raw);
  }

  public invalidateSessionCache(transcriptPath: string): void {
    this.sessionCacheByPath.delete(transcriptPath);
    this.contentCacheByPath.delete(transcriptPath);
    this.promptCacheByPath.delete(transcriptPath);
  }

  public async discover(workspaceFolders: readonly vscode.WorkspaceFolder[]): Promise<DiscoveryResult> {
    const sessionsByWorkspace = new Map<string, SessionNode[]>();
    for (const folder of workspaceFolders) {
      sessionsByWorkspace.set(folder.uri.toString(), []);
    }

    const resolvedRoots = await this.resolveRoots();
    const roots: ProfileRoot[] = [];
    for (const root of resolvedRoots) {
      if (await exists(root.projectsDir)) {
        roots.push(root);
      }
    }

    if (workspaceFolders.length === 0) {
      return { sessionsByWorkspace, profiles: roots, globalInfoMessage: "Open a folder to view Claude sessions." };
    }

    if (roots.length === 0) {
      const searched =
        resolvedRoots.length > 0
          ? resolvedRoots.map((root) => root.projectsDir).join(", ")
          : path.join(os.homedir(), ".claude", "projects");
      return {
        sessionsByWorkspace,
        profiles: roots,
        globalInfoMessage: `No Claude project history found at ${searched}.`
      };
    }

    const log = (msg: string) => this.outputChannel.appendLine(msg);
    const files: { file: string; profile: ProfileRoot }[] = [];
    for (const root of roots) {
      const rootFiles = await collectTranscriptFiles(root.projectsDir, log);
      log(`[discovery] profile "${root.id}": ${String(rootFiles.length)} transcript(s) under ${root.projectsDir}.`);
      for (const file of rootFiles) {
        files.push({ file, profile: root });
      }
    }
    const candidates = await this.processFilesBatched(files, log);

    // Prune session cache entries for deleted files
    const fileSet = new Set(files.map((entry) => entry.file));
    for (const cachedPath of this.sessionCacheByPath.keys()) {
      if (!fileSet.has(cachedPath)) {
        this.sessionCacheByPath.delete(cachedPath);
      }
    }

    // Also prune content cache
    for (const cachedPath of this.contentCacheByPath.keys()) {
      if (!fileSet.has(cachedPath)) {
        this.contentCacheByPath.delete(cachedPath);
      }
    }

    // Also prune prompt cache
    for (const cachedPath of this.promptCacheByPath.keys()) {
      if (!fileSet.has(cachedPath)) {
        this.promptCacheByPath.delete(cachedPath);
      }
    }

    const precomputed = precomputeWorkspacePaths(workspaceFolders, (folder) => this.readMaxDepth(folder));
    const byWorkspaceAndSession = new Map<string, Map<string, SessionNode>>();
    for (const workspace of workspaceFolders) {
      byWorkspaceAndSession.set(workspace.uri.toString(), new Map<string, SessionNode>());
    }

    for (const candidate of candidates) {
      const targetWorkspace = matchWorkspacePrecomputed(candidate.parsed.cwd, precomputed);
      if (!targetWorkspace) {
        continue;
      }

      const workspaceKey = targetWorkspace.uri.toString();
      const sessionNode: SessionNode = {
        kind: "session",
        sessionId: candidate.parsed.sessionId,
        cwd: candidate.parsed.cwd,
        transcriptPath: candidate.transcriptPath,
        title: buildTitle(candidate.parsed.titleSourceRaw, candidate.parsed.sessionId),
        updatedAt: candidate.updatedAt,
        profileId: candidate.profile.id,
        profileLabel: candidate.profile.label,
        configDir: candidate.profile.configDir
      };

      const sessions = byWorkspaceAndSession.get(workspaceKey);
      if (!sessions) {
        continue;
      }

      const existing = sessions.get(sessionNode.sessionId);
      if (!existing || existing.updatedAt < sessionNode.updatedAt) {
        sessions.set(sessionNode.sessionId, sessionNode);
      }
    }

    for (const workspace of workspaceFolders) {
      const workspaceKey = workspace.uri.toString();
      const sessionMap = byWorkspaceAndSession.get(workspaceKey);
      const list = Array.from(sessionMap?.values() ?? []);
      list.sort((a, b) => b.updatedAt - a.updatedAt);
      sessionsByWorkspace.set(workspaceKey, list);
    }

    return { sessionsByWorkspace, profiles: roots };
  }

  private async processFilesBatched(
    files: readonly { file: string; profile: ProfileRoot }[],
    log: (msg: string) => void
  ): Promise<TranscriptCandidate[]> {
    const candidates: TranscriptCandidate[] = [];

    for (let i = 0; i < files.length; i += BATCH_CONCURRENCY) {
      const batch = files.slice(i, i + BATCH_CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map((entry) => this.processOneFile(entry.file, entry.profile, log))
      );

      for (const result of results) {
        if (result.status === "fulfilled" && result.value) {
          candidates.push(result.value);
        } else if (result.status === "rejected") {
          log(`[discovery] unexpected batch error: ${String(result.reason)}`);
        }
      }
    }

    return candidates;
  }

  private async processOneFile(
    file: string,
    profile: ProfileRoot,
    log: (msg: string) => void
  ): Promise<TranscriptCandidate | null> {
    let stat: fs.Stats;
    try {
      stat = await fsp.stat(file);
    } catch (error) {
      log(`[discovery] stat failed for ${file}: ${String(error)}`);
      return null;
    }

    const cached = this.sessionCacheByPath.get(file);
    if (cached && cached.mtimeMs === stat.mtimeMs) {
      return {
        transcriptPath: file,
        updatedAt: stat.mtimeMs,
        parsed: cached.parsed,
        profile
      };
    }

    const parsed = await parseTranscriptFile(file, log);
    if (!parsed) {
      return null;
    }

    this.sessionCacheByPath.set(file, { mtimeMs: stat.mtimeMs, parsed });

    return {
      transcriptPath: file,
      updatedAt: stat.mtimeMs,
      parsed,
      profile
    };
  }

  public async getUserPrompts(session: SessionNode): Promise<SessionPrompt[]> {
    let stat: fs.Stats;
    try {
      stat = await fsp.stat(session.transcriptPath);
    } catch (error) {
      this.outputChannel.appendLine(
        `[discovery] stat failed while reading prompts for ${session.transcriptPath}: ${String(error)}`
      );
      return [];
    }

    const cached = this.promptCacheByPath.get(session.transcriptPath);
    if (cached && cached.mtimeMs === stat.mtimeMs) {
      return cached.prompts;
    }

    const log = (msg: string) => this.outputChannel.appendLine(msg);
    const prompts = await parseAllUserPrompts(session.transcriptPath, session.sessionId, log);
    this.promptCacheByPath.set(session.transcriptPath, {
      mtimeMs: stat.mtimeMs,
      prompts
    });

    return prompts;
  }

  public async getSearchableEntries(workspaceFolders: readonly vscode.WorkspaceFolder[]): Promise<SearchableEntry[]> {
    const log = (msg: string) => this.outputChannel.appendLine(msg);
    const result = await this.discover(workspaceFolders);

    const allSessions: SessionNode[] = [];
    for (const sessions of result.sessionsByWorkspace.values()) {
      for (const session of sessions) {
        allSessions.push(session);
      }
    }

    const entries: SearchableEntry[] = [];

    for (let i = 0; i < allSessions.length; i += BATCH_CONCURRENCY) {
      const batch = allSessions.slice(i, i + BATCH_CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(async (session) => {
          let stat: fs.Stats;
          try {
            stat = await fsp.stat(session.transcriptPath);
          } catch (error) {
            log(`[search] stat failed for ${session.transcriptPath}: ${String(error)}`);
            return null;
          }

          const cached = this.contentCacheByPath.get(session.transcriptPath);
          let contentText: string;
          if (cached && cached.mtimeMs === stat.mtimeMs) {
            contentText = cached.contentText;
          } else {
            contentText = await parseSessionContent(session.transcriptPath, log);
            this.contentCacheByPath.set(session.transcriptPath, {
              mtimeMs: stat.mtimeMs,
              contentText
            });
          }

          const entry: SearchableEntry = {
            sessionId: session.sessionId,
            profileId: session.profileId,
            transcriptPath: session.transcriptPath,
            title: session.title,
            cwd: session.cwd,
            updatedAt: session.updatedAt,
            contentText
          };
          return entry;
        })
      );

      for (const res of results) {
        if (res.status === "fulfilled" && res.value) {
          entries.push(res.value);
        } else if (res.status === "rejected") {
          log(`[search] unexpected batch error: ${String(res.reason)}`);
        }
      }
    }

    return entries;
  }
}

/**
 * Backwards-compatible adapter for callers that pass a bare `projects/` path
 * (the previous constructor shape, still used by the tests).
 */
function projectsDirToProfileRoot(projectsDir: string): ProfileRoot {
  const configDir = path.dirname(path.resolve(projectsDir));
  const id = profileIdFromConfigDir(configDir);
  return { id, label: id, configDir, projectsDir: path.resolve(projectsDir) };
}
