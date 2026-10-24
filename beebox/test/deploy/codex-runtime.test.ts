// # Deployed Codex runtime wiring
//
// Production installs workspace dependencies under `/opt/beebox/node_modules`.
// Setup and every deploy refresh `/usr/local/bin/codex` to the direct,
// SDK-version-matched dependency, and the deploy gate checks the plugin command
// without reading or mutating the service account's real Codex home.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, not } from "@ianbicking/tap-check/check";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { codexBinaryPath } from "../../src/services/codex-binary.js";

const deploy = await readFile("deploy/deploy.sh", "utf8");
const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const execFileAsync = promisify(execFile);

// The CLI and SDK versions are one lockstep contract.
void test("The CLI and SDK versions are one lockstep contract.", async (t) => {
  t.check(packageJson.dependencies["@openai/codex"], packageJson.dependencies["@openai/codex-sdk"]);

  // The resolver reaches an executable whose reported version is the package pin.
  // The test harness already supplies an isolated `CODEX_HOME`, so this cannot
  // read or mutate the developer's plugin or authentication state.

  const result = await execFileAsync(codexBinaryPath(), ["--version"]);
  t.check(result.stdout.trim(), `codex-cli ${packageJson.dependencies["@openai/codex"]}`);

  // The deploy refreshes the operator command from that dependency.

  // `deploy` is a whole shell script: a narrow check on the one line under test.
  t.check(deploy, any(String).includes("ln -sf /opt/beebox/node_modules/.bin/codex /usr/local/bin/codex"));

  // The deployment gate uses a scratch home and checks plugin-command
  // compatibility. It does not run `plugin list` against repairable global state.

  t.check(deploy, any(String).includes('CODEX_HOME="$codex_check_home" codex plugin --help'));

  t.check(deploy, not(any(String).includes('CODEX_HOME="$codex_check_home" codex plugin list')));
});
