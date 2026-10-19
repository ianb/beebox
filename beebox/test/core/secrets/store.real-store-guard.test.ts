// # A test process cannot reach the boxholder's real secret store
//
// `.taprc` isolates the store and HOME, but a test run outside tap skips that.
// On 2026-10-18 such runs overwrote a real key. The store's fallback path now
// refuses in a test process whose HOME is the account's real home. Each case
// runs a child `node` on a `*.test.ts` script, the way a direct run would, and
// only resolves the path: nothing is read or written.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const storeModule = fileURLToPath(new URL("../../../src/core/secrets/store.ts", import.meta.url));
const dir = await mkdtemp(path.join(tmpdir(), "bbx-real-store-guard-"));
const script = path.join(dir, "probe.test.ts");
await writeFile(script, `
import { secretsFilePath } from ${JSON.stringify(storeModule)};
try { console.log("path " + secretsFilePath()); } catch (error) { console.log("refused " + (error as Error).name); }
`);

async function probe(env: Record<string, string>): Promise<string> {
  const base = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("TAP") && key !== "BBX_SECRETS_FILE" && key !== "NODE_TEST_CONTEXT"));
  const { stdout } = await run(process.execPath, ["--import", "tsx", script], { env: { ...base, ...env } });
  return stdout.trim();
}

void test("A direct run with the real HOME and no override is refused; an override or an isolated HOME is not", async (t) => {
  t.teardown(() => rm(dir, { recursive: true, force: true }));
  const realHome = userInfo().homedir;

  t.check(await probe({ HOME: realHome }), "refused RealSecretStoreInTestError");

  const override = path.join(dir, "secrets.json");
  t.check(await probe({ HOME: realHome, BBX_SECRETS_FILE: override }), `path ${override}`);

  t.check(await probe({ HOME: dir }), `path ${path.join(dir, ".config", "beebox", "secrets.json")}`);
});
