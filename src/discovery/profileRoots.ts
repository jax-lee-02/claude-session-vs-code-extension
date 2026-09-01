import { promises as fsp } from "fs";
import * as os from "os";
import * as path from "path";

/**
 * One Claude configuration directory (`CLAUDE_CONFIG_DIR`) that holds a
 * `projects/` transcript store. Multiple profiles coexist when the user keeps
 * separate configuration directories, e.g. `~/.claude` for work and
 * `~/.claude-personal` for private projects.
 */
export interface ProfileRoot {
  /** Stable identifier used as the grouping key, e.g. `default`, `personal`. */
  readonly id: string;
  /** Display label shown on the profile row. */
  readonly label: string;
  /** The configuration directory itself, e.g. `/Users/me/.claude-personal`. */
  readonly configDir: string;
  /** The transcript store inside it, e.g. `/Users/me/.claude-personal/projects`. */
  readonly projectsDir: string;
}

export const DEFAULT_CONFIG_DIR_NAME = ".claude";
const PROFILE_DIR_PREFIX = `${DEFAULT_CONFIG_DIR_NAME}-`;

export interface ResolveProfileRootsOptions {
  readonly homeDir?: string;
  /** Value of `claudeSessions.profileRoots`. When non-empty it replaces auto-discovery. */
  readonly configuredConfigDirs?: readonly string[];
  /** Value of `CLAUDE_CONFIG_DIR`, included in auto-discovery when set. */
  readonly envConfigDir?: string;
  readonly log?: (msg: string) => void;
}

/** Expand a leading `~` and resolve the path against the home directory. */
export function expandHome(candidate: string, homeDir: string): string {
  const trimmed = candidate.trim();
  if (trimmed === "~") {
    return homeDir;
  }
  if (trimmed.startsWith(`~${path.sep}`) || trimmed.startsWith("~/")) {
    return path.resolve(path.join(homeDir, trimmed.slice(2)));
  }
  return path.resolve(trimmed);
}

/**
 * `~/.claude` -> `default`, `~/.claude-personal` -> `personal`,
 * any other directory -> its basename without a leading dot.
 */
export function profileIdFromConfigDir(configDir: string): string {
  const base = path.basename(configDir);
  if (base === DEFAULT_CONFIG_DIR_NAME) {
    return "default";
  }
  if (base.startsWith(PROFILE_DIR_PREFIX)) {
    const suffix = base.slice(PROFILE_DIR_PREFIX.length);
    return suffix.length > 0 ? suffix : "default";
  }
  return base.replace(/^\.+/, "") || base;
}

/** Render an absolute path with the home directory collapsed to `~`. */
export function displayConfigDir(configDir: string, homeDir: string): string {
  if (configDir === homeDir) {
    return "~";
  }
  const prefix = `${homeDir}${path.sep}`;
  return configDir.startsWith(prefix) ? `~${path.sep}${configDir.slice(prefix.length)}` : configDir;
}

async function isDirectory(target: string): Promise<boolean> {
  try {
    const stat = await fsp.stat(target);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

function toProfileRoot(configDir: string): ProfileRoot {
  const id = profileIdFromConfigDir(configDir);
  return {
    id,
    label: id,
    configDir,
    projectsDir: path.join(configDir, "projects")
  };
}

/** Candidate configuration directories before the `projects/` existence check. */
async function collectCandidateConfigDirs(
  homeDir: string,
  envConfigDir: string | undefined,
  log: (msg: string) => void
): Promise<string[]> {
  const candidates = [path.join(homeDir, DEFAULT_CONFIG_DIR_NAME)];

  try {
    const entries = await fsp.readdir(homeDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith(PROFILE_DIR_PREFIX)) {
        continue;
      }
      candidates.push(path.join(homeDir, entry.name));
    }
  } catch (error) {
    log(`[profiles] readdir failed for ${homeDir}: ${String(error)}`);
  }

  if (envConfigDir && envConfigDir.trim().length > 0) {
    candidates.push(expandHome(envConfigDir, homeDir));
  }

  return candidates;
}

/**
 * Resolve the configuration directories to scan.
 *
 * `configuredConfigDirs` (the `claudeSessions.profileRoots` setting) replaces
 * auto-discovery when non-empty. Otherwise `~/.claude`, every `~/.claude-*`
 * directory and `CLAUDE_CONFIG_DIR` are considered. A candidate is kept only
 * when it actually contains a `projects/` directory, so a single-profile
 * machine yields exactly one root and the tree stays flat.
 */
export async function resolveProfileRoots(options: ResolveProfileRootsOptions = {}): Promise<ProfileRoot[]> {
  const homeDir = options.homeDir ?? os.homedir();
  const log = options.log ?? (() => undefined);

  const configured = (options.configuredConfigDirs ?? []).filter((value) => value.trim().length > 0);
  const candidates =
    configured.length > 0
      ? configured.map((value) => expandHome(value, homeDir))
      : await collectCandidateConfigDirs(homeDir, options.envConfigDir, log);

  const roots: ProfileRoot[] = [];
  const seen = new Set<string>();

  for (const configDir of candidates) {
    const root = toProfileRoot(configDir);
    if (seen.has(root.projectsDir)) {
      continue;
    }
    seen.add(root.projectsDir);

    if (!(await isDirectory(root.projectsDir))) {
      log(`[profiles] skipping ${root.configDir}: no projects directory.`);
      continue;
    }
    roots.push(root);
  }

  const uniqueRoots = ensureUniqueIds(roots);

  uniqueRoots.sort((a, b) => {
    if (a.id === b.id) {
      return a.configDir.localeCompare(b.configDir);
    }
    if (a.id === "default") {
      return -1;
    }
    if (b.id === "default") {
      return 1;
    }
    return a.id.localeCompare(b.id);
  });

  return uniqueRoots;
}

/**
 * Two configuration directories can share a basename (`a/.claude-x`, `b/.claude-x`)
 * when the roots are listed explicitly. Ids are grouping keys, so disambiguate.
 */
function ensureUniqueIds(roots: readonly ProfileRoot[]): ProfileRoot[] {
  const used = new Set<string>();
  return roots.map((root) => {
    if (!used.has(root.id)) {
      used.add(root.id);
      return root;
    }
    let suffix = 2;
    while (used.has(`${root.id}-${String(suffix)}`)) {
      suffix += 1;
    }
    const id = `${root.id}-${String(suffix)}`;
    used.add(id);
    return { ...root, id, label: id };
  });
}
