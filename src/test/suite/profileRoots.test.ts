import * as assert from "assert";
import * as os from "os";
import * as path from "path";
import { promises as fsp } from "fs";
import {
  displayConfigDir,
  expandHome,
  profileIdFromConfigDir,
  resolveProfileRoots
} from "../../discovery/profileRoots";

async function makeProfile(homeDir: string, dirName: string, withProjects = true): Promise<string> {
  const configDir = path.join(homeDir, dirName);
  await fsp.mkdir(withProjects ? path.join(configDir, "projects") : configDir, { recursive: true });
  return configDir;
}

describe("profileIdFromConfigDir()", () => {
  it("maps the default configuration directory to `default`", () => {
    assert.strictEqual(profileIdFromConfigDir("/home/user/.claude"), "default");
  });

  it("uses the suffix of a `.claude-*` directory", () => {
    assert.strictEqual(profileIdFromConfigDir("/home/user/.claude-personal"), "personal");
  });

  it("falls back to the basename without a leading dot", () => {
    assert.strictEqual(profileIdFromConfigDir("/opt/claude-configs/work"), "work");
    assert.strictEqual(profileIdFromConfigDir("/home/user/.custom"), "custom");
  });
});

describe("expandHome()", () => {
  it("expands a leading tilde", () => {
    assert.strictEqual(expandHome("~/.claude-personal", "/home/user"), path.resolve("/home/user/.claude-personal"));
  });

  it("returns the home directory for a bare tilde", () => {
    assert.strictEqual(expandHome("~", "/home/user"), "/home/user");
  });

  it("resolves an absolute path unchanged", () => {
    assert.strictEqual(expandHome("/opt/claude", "/home/user"), path.resolve("/opt/claude"));
  });
});

describe("displayConfigDir()", () => {
  it("collapses the home directory to a tilde", () => {
    assert.strictEqual(displayConfigDir("/home/user/.claude", "/home/user"), `~${path.sep}.claude`);
  });

  it("leaves paths outside the home directory intact", () => {
    assert.strictEqual(displayConfigDir("/opt/claude", "/home/user"), "/opt/claude");
  });
});

describe("resolveProfileRoots()", () => {
  let homeDir: string;

  beforeEach(async () => {
    homeDir = await fsp.mkdtemp(path.join(os.tmpdir(), "claude-profiles-"));
  });

  afterEach(async () => {
    await fsp.rm(homeDir, { recursive: true, force: true });
  });

  it("returns a single root when only the default profile exists", async () => {
    await makeProfile(homeDir, ".claude");

    const roots = await resolveProfileRoots({ homeDir });

    assert.strictEqual(roots.length, 1);
    assert.strictEqual(roots[0].id, "default");
    assert.strictEqual(roots[0].projectsDir, path.join(homeDir, ".claude", "projects"));
  });

  it("discovers every `.claude-*` directory holding a projects folder", async () => {
    await makeProfile(homeDir, ".claude");
    await makeProfile(homeDir, ".claude-personal");

    const roots = await resolveProfileRoots({ homeDir });

    assert.deepStrictEqual(
      roots.map((root) => root.id),
      ["default", "personal"]
    );
  });

  it("skips configuration directories without a projects folder", async () => {
    await makeProfile(homeDir, ".claude");
    await makeProfile(homeDir, ".claude-empty", false);

    const roots = await resolveProfileRoots({ homeDir });

    assert.deepStrictEqual(
      roots.map((root) => root.id),
      ["default"]
    );
  });

  it("includes CLAUDE_CONFIG_DIR when it lives outside the home directory", async () => {
    await makeProfile(homeDir, ".claude");
    const outside = path.join(homeDir, "elsewhere", "claude-work");
    await fsp.mkdir(path.join(outside, "projects"), { recursive: true });

    const roots = await resolveProfileRoots({ homeDir, envConfigDir: outside });

    assert.deepStrictEqual(
      roots.map((root) => root.id),
      ["default", "claude-work"]
    );
  });

  it("does not list the same projects directory twice", async () => {
    const configDir = await makeProfile(homeDir, ".claude");

    const roots = await resolveProfileRoots({ homeDir, envConfigDir: configDir });

    assert.strictEqual(roots.length, 1);
  });

  it("uses the configured roots instead of auto-discovery when set", async () => {
    await makeProfile(homeDir, ".claude");
    await makeProfile(homeDir, ".claude-personal");

    const roots = await resolveProfileRoots({
      homeDir,
      configuredConfigDirs: ["~/.claude-personal"]
    });

    assert.deepStrictEqual(
      roots.map((root) => root.id),
      ["personal"]
    );
  });

  it("ignores blank entries in the configured roots", async () => {
    await makeProfile(homeDir, ".claude");

    const roots = await resolveProfileRoots({ homeDir, configuredConfigDirs: ["  ", ""] });

    assert.deepStrictEqual(
      roots.map((root) => root.id),
      ["default"]
    );
  });

  it("disambiguates ids when two configured roots share a basename", async () => {
    const first = path.join(homeDir, "a", ".claude-work");
    const second = path.join(homeDir, "b", ".claude-work");
    await fsp.mkdir(path.join(first, "projects"), { recursive: true });
    await fsp.mkdir(path.join(second, "projects"), { recursive: true });

    const roots = await resolveProfileRoots({ homeDir, configuredConfigDirs: [first, second] });

    assert.deepStrictEqual(roots.map((root) => root.id).sort(), ["work", "work-2"]);
  });

  it("returns no roots when nothing holds a projects directory", async () => {
    const roots = await resolveProfileRoots({ homeDir });

    assert.deepStrictEqual(roots, []);
  });
});
