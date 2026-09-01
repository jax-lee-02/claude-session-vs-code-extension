import { SessionNode } from "../models";

export interface ProfileBucket {
  readonly profileId: string;
  readonly label: string;
  readonly configDir: string;
  readonly sessions: SessionNode[];
}

/**
 * A folder gets a profile level only when its sessions come from two or more
 * profiles. Callers pass the unfiltered session list so the tree keeps its
 * shape while a search filter is active.
 */
export function shouldGroupByProfile(sessions: readonly SessionNode[]): boolean {
  const profileIds = new Set<string>();
  for (const session of sessions) {
    profileIds.add(session.profileId);
    if (profileIds.size > 1) {
      return true;
    }
  }
  return false;
}

/** Discovery order first (the default profile leads), then any unknown ids alphabetically. */
export function orderProfileIds(profileIds: ReadonlySet<string>, profileOrder: readonly string[]): string[] {
  const ordered = profileOrder.filter((id) => profileIds.has(id));
  const remaining = Array.from(profileIds)
    .filter((id) => !ordered.includes(id))
    .sort((a, b) => a.localeCompare(b));
  return [...ordered, ...remaining];
}

/**
 * Bucket sessions per profile. Buckets are ordered by `profileOrder`; a profile
 * whose sessions were all filtered out is dropped rather than shown empty.
 */
export function groupSessionsByProfile(
  sessions: readonly SessionNode[],
  profileOrder: readonly string[]
): ProfileBucket[] {
  const byProfile = new Map<string, SessionNode[]>();
  for (const session of sessions) {
    const bucket = byProfile.get(session.profileId);
    if (bucket) {
      bucket.push(session);
    } else {
      byProfile.set(session.profileId, [session]);
    }
  }

  const buckets: ProfileBucket[] = [];
  for (const profileId of orderProfileIds(new Set(byProfile.keys()), profileOrder)) {
    const profileSessions = byProfile.get(profileId);
    if (!profileSessions || profileSessions.length === 0) {
      continue;
    }
    buckets.push({
      profileId,
      label: profileSessions[0].profileLabel,
      configDir: profileSessions[0].configDir,
      sessions: profileSessions
    });
  }

  return buckets;
}
