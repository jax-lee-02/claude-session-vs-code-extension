export interface WebviewPromptItem {
  readonly promptId: string;
  readonly sessionId: string;
  readonly sessionTitle: string;
  readonly promptIndex: number;
  readonly promptTitle: string;
  readonly promptRaw: string;
  readonly responseRaw?: string;
  readonly timestampIso?: string;
  readonly timestampMs?: number;
  readonly highlightRanges?: [number, number][];
  readonly matchType?: "title" | "prompt" | "response";
}

export interface WebviewSessionItem {
  readonly sessionId: string;
  /** Indentation level of the session row; prompts render one level deeper. */
  readonly depth: number;
  readonly title: string;
  readonly description: string;
  readonly tooltip: string;
  readonly transcriptPath: string;
  readonly cwd: string;
  readonly updatedAt: number;
  readonly prompts?: WebviewPromptItem[];
}

export interface WebviewProfileGroup {
  /** Expansion key, unique per workspace folder. */
  readonly profileKey: string;
  readonly profileId: string;
  readonly label: string;
  /** Configuration directory shown next to the label, e.g. `~/.claude-personal`. */
  readonly description: string;
  readonly sessions: WebviewSessionItem[];
}

export interface WebviewWorkspaceGroup {
  readonly workspaceUri: string;
  readonly workspaceName: string;
  /** Sessions always sit under a profile row, one group per profile with sessions. */
  readonly profiles: WebviewProfileGroup[];
  readonly infoMessage?: string;
}

export interface WebviewTreeState {
  readonly workspaces: WebviewWorkspaceGroup[];
  readonly filterQuery: string | undefined;
  readonly selectionMode: boolean;
  readonly checkedSessionIds: string[];
  readonly expandedWorkspaces: string[];
  readonly expandedProfiles: string[];
  readonly expandedSessions: string[];
}

// Extension → Webview
export type ExtensionToWebviewMessage =
  | { type: "updateState"; state: WebviewTreeState }
  | { type: "startRename"; sessionId: string }
  | { type: "cancelRename" }
  | { type: "focusSearch" };

// Webview → Extension
export type WebviewToExtensionMessage =
  | { type: "openSession"; sessionId: string }
  | { type: "openSessionDangerously"; sessionId: string }
  | { type: "renameSession"; sessionId: string; newTitle: string }
  | { type: "renameCancelled" }
  | { type: "deleteSession"; sessionId: string }
  | { type: "toggleCheck"; sessionId: string }
  | { type: "toggleWorkspaceExpand"; workspaceUri: string }
  | { type: "toggleProfileExpand"; profileKey: string }
  | { type: "toggleSessionExpand"; sessionId: string }
  | { type: "openPromptPreview"; sessionId: string; promptId: string }
  | { type: "viewSession"; sessionId: string }
  | { type: "clearFilter" }
  | { type: "search"; query: string }
  | { type: "rangeCheck"; sessionIds: string[] };
