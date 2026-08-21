import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { runTests } from "@vscode/test-electron";

async function main(): Promise<void> {
  try {
    const extensionDevelopmentPath = path.resolve(__dirname, "../../");
    const extensionTestsPath = path.resolve(__dirname, "./suite/index");
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "vscs-"));

    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      // Keep the user-data dir short: VS Code opens an IPC socket inside it and
      // macOS rejects socket paths longer than 103 chars, which a checkout in a
      // deep directory (e.g. a git worktree) easily exceeds.
      launchArgs: ["--disable-extensions", "--user-data-dir", userDataDir],
      extensionTestsEnv: {
        ...process.env,
        ...(process.env.NODE_V8_COVERAGE ? { NODE_V8_COVERAGE: process.env.NODE_V8_COVERAGE } : {})
      }
    });
  } catch (err) {
    console.error("Failed to run tests", err);
    process.exit(1);
  }
}

void main();
