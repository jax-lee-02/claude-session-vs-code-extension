import * as assert from "assert";
import { SessionNode } from "../../models";
import { groupSessionsByProfile, orderProfileIds } from "../../webview/profileGrouping";

function makeSession(sessionId: string, profileId: string, updatedAt = 0): SessionNode {
  return {
    kind: "session",
    sessionId,
    cwd: "/workspace/project",
    transcriptPath: `/home/user/.claude/projects/-workspace-project/${sessionId}.jsonl`,
    title: sessionId,
    updatedAt,
    profileId,
    profileLabel: profileId,
    configDir: profileId === "default" ? "/home/user/.claude" : `/home/user/.claude-${profileId}`
  };
}

describe("orderProfileIds()", () => {
  it("follows the discovery order", () => {
    const ordered = orderProfileIds(new Set(["personal", "default"]), ["default", "personal"]);
    assert.deepStrictEqual(ordered, ["default", "personal"]);
  });

  it("appends unknown ids alphabetically after the known ones", () => {
    const ordered = orderProfileIds(new Set(["zeta", "alpha", "default"]), ["default"]);
    assert.deepStrictEqual(ordered, ["default", "alpha", "zeta"]);
  });

  it("omits profiles that have no sessions", () => {
    const ordered = orderProfileIds(new Set(["personal"]), ["default", "personal"]);
    assert.deepStrictEqual(ordered, ["personal"]);
  });
});

describe("groupSessionsByProfile()", () => {
  it("groups a single profile too, so every folder reads the same", () => {
    const buckets = groupSessionsByProfile([makeSession("a", "default")], ["default"]);

    assert.deepStrictEqual(
      buckets.map((bucket) => bucket.profileId),
      ["default"]
    );
  });

  it("returns no buckets for a folder without sessions", () => {
    assert.deepStrictEqual(groupSessionsByProfile([], ["default", "personal"]), []);
  });

  it("buckets sessions per profile in discovery order", () => {
    const sessions = [makeSession("a", "personal"), makeSession("b", "default"), makeSession("c", "personal")];

    const buckets = groupSessionsByProfile(sessions, ["default", "personal"]);

    assert.deepStrictEqual(
      buckets.map((bucket) => bucket.profileId),
      ["default", "personal"]
    );
    assert.deepStrictEqual(
      buckets[1].sessions.map((session) => session.sessionId),
      ["a", "c"]
    );
  });

  it("carries the label and configuration directory of the profile", () => {
    const buckets = groupSessionsByProfile([makeSession("a", "personal")], ["personal"]);

    assert.strictEqual(buckets[0].label, "personal");
    assert.strictEqual(buckets[0].configDir, "/home/user/.claude-personal");
  });

  it("drops profiles whose sessions were all filtered out", () => {
    const buckets = groupSessionsByProfile([makeSession("a", "default")], ["default", "personal"]);

    assert.deepStrictEqual(
      buckets.map((bucket) => bucket.profileId),
      ["default"]
    );
  });

  it("preserves the incoming session order inside a bucket", () => {
    const sessions = [makeSession("newer", "default", 200), makeSession("older", "default", 100)];

    const buckets = groupSessionsByProfile(sessions, ["default"]);

    assert.deepStrictEqual(
      buckets[0].sessions.map((session) => session.sessionId),
      ["newer", "older"]
    );
  });
});
