// # When a deploy reinstalls a box
//
// `deploy/server-bin/bbx-box-install` runs after every deploy and installs a
// box's node_modules when it has no completed install on record or its manifest
// changed since. The record is `node_modules/.bbx-install-stamp`, written only
// after an install that exited 0 and verified. Before the stamp the check
// compared package.json against node_modules/react, which a no-op install never
// touches, so every deploy reinstalled every box.
//
// These examples run the real helper against a temporary boxes root, with
// `sudo`, `pnpm` and the engine's `box-engine-link` replaced by stubs that log
// their calls and fail on request.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const helper = resolve("deploy/server-bin/bbx-box-install");

const stubs = {
  // `sudo -u <user> -H <command...>` runs the command as the test user, naming the requested account.
  sudo: "#!/usr/bin/env bash\nexport BBX_TEST_AS=\"$2\"\nshift 3\nexec \"$@\"\n",
  // `pnpm install` in a box: logs the box and whether it runs non-interactively, fails when the box asks it to.
  pnpm: "#!/usr/bin/env bash\necho \"install $(basename \"$PWD\") ci=${CI:-unset}\" >> \"$BBX_TEST_LOG\"\n[[ -e .fail-install ]] && exit 1\nexit 0\n",
  // `box-engine-link link|verify <box> ...`: logs the call and the account it ran as, fails when the box asks it to.
  "box-engine-link": "#!/usr/bin/env bash\necho \"$1 $(basename \"$2\") as=${BBX_TEST_AS:-root}\" >> \"$BBX_TEST_LOG\"\n[[ -e \"$2/.fail-$1\" ]] && exit 1\nexit 0\n",
};

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "bbx-box-install-"));
  const bin = join(root, "bin");
  const engine = join(root, "engine");
  const boxes = join(root, "boxes");
  await mkdir(bin);
  await mkdir(join(engine, "bin"), { recursive: true });
  await mkdir(boxes);
  for (const [name, body] of Object.entries(stubs)) {
    const file = name === "box-engine-link" ? join(engine, "bin", name) : join(bin, name);
    await writeFile(file, body);
    await chmod(file, 0o755);
  }
  const log = join(root, "calls.log");
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}`, BBX_TEST_LOG: log };
  async function run() {
    const outcome = await execFileAsync(helper, [boxes, engine], { env }).then(
      ({ stdout, stderr }) => ({ code: 0, stdout, stderr }),
      (error: { code?: number; stdout?: string; stderr?: string }) => ({ code: error.code ?? -1, stdout: error.stdout ?? "", stderr: error.stderr ?? "" }),
    );
    const calls = await readFile(log, "utf8").then((text) => text.trim().split("\n").filter(Boolean), () => []);
    await rm(log, { force: true });
    return { ...outcome, stdout: outcome.stdout.trim(), stderr: outcome.stderr.trim(), calls };
  }
  async function box(name: string, opts?: { manifest: false }) {
    const dir = join(boxes, name);
    await mkdir(join(dir, "node_modules"), { recursive: true });
    if (opts === undefined) await writeFile(join(dir, "package.json"), "{}\n");
    return dir;
  }
  async function stampAge(dir: string) {
    return stat(join(dir, "node_modules/.bbx-install-stamp")).then((s) => s.mtimeMs, () => null);
  }
  /** Make the stamp older than the manifest by a clear margin. */
  async function age(file: string, seconds: number) {
    const past = (Date.now() - seconds * 1000) / 1000;
    await utimes(file, past, past);
  }
  return { root, boxes, run, box, stampAge, age };
}

void test("A box with no install on record is installed once and then left alone", async (t) => {
  const s = await setup();
  t.teardown(() => rm(s.root, { recursive: true, force: true }));
  const a = await s.box("a");

  const first = await s.run();
  t.check(
    { code: first.code, calls: first.calls, stamped: (await s.stampAge(a)) !== null },
    { code: 0, calls: ["link a as=beebox", "install a ci=true", "verify a as=beebox"], stamped: true },
  );

  // The stamp is what records the install; a second run finds nothing to do.
  const second = await s.run();
  t.check({ code: second.code, calls: second.calls, stdout: second.stdout }, { code: 0, calls: ["link a as=beebox", "verify a as=beebox"], stdout: "" });
});

void test("A manifest or lockfile newer than the stamp reinstalls the box", async (t) => {
  const s = await setup();
  t.teardown(() => rm(s.root, { recursive: true, force: true }));
  const a = await s.box("a");
  const b = await s.box("b");
  await s.run();
  await s.age(join(a, "node_modules/.bbx-install-stamp"), 60);
  await s.age(join(b, "node_modules/.bbx-install-stamp"), 60);
  await s.age(join(b, "package.json"), 120);
  await writeFile(join(a, "package.json"), "{\"dependencies\":{}}\n");
  await writeFile(join(b, "pnpm-lock.yaml"), "lockfileVersion: 9\n");

  const result = await s.run();
  t.check(
    { calls: result.calls, stdout: result.stdout },
    {
      calls: ["link a as=beebox", "install a ci=true", "verify a as=beebox", "link b as=beebox", "install b ci=true", "verify b as=beebox"],
      stdout: "a: installing (package.json changed since the last install)...\n  b: installing (pnpm-lock.yaml changed since the last install)...",
    },
  );
});

void test("A stamp is written only after an install that exited 0 and verified", async (t) => {
  const s = await setup();
  t.teardown(() => rm(s.root, { recursive: true, force: true }));
  const failing = await s.box("failing");
  const unverified = await s.box("unverified");
  const fine = await s.box("fine");
  await writeFile(join(failing, ".fail-install"), "");
  await writeFile(join(unverified, ".fail-verify"), "");

  const result = await s.run();
  t.check(
    {
      code: result.code,
      stamps: { failing: await s.stampAge(failing), unverified: await s.stampAge(unverified), fine: (await s.stampAge(fine)) !== null },
      stderr: result.stderr,
    },
    {
      code: 0,
      stamps: { failing: null, unverified: null, fine: true },
      stderr: "ERROR failing: pnpm install exited nonzero; check for real dependency errors above (a lone EPERM on .bin linking is a known-harmless pnpm quirk, everything else is not).\n  ERROR unverified: the box has no usable engine after install.",
    },
  );

  // Without a stamp the next deploy tries both again.
  const again = await s.run();
  t.check(again.calls.filter((c) => c.startsWith("install ")), ["install failing ci=true", "install unverified ci=true"]);
});

void test("A recorded install that no longer verifies is reinstalled", async (t) => {
  const s = await setup();
  t.teardown(() => rm(s.root, { recursive: true, force: true }));
  const a = await s.box("a");
  await s.run();
  // The stub fails every verify, so the install is attempted and then reported.
  await writeFile(join(a, ".fail-verify"), "");

  const result = await s.run();
  t.check(
    { calls: result.calls, stdout: result.stdout },
    { calls: ["link a as=beebox", "verify a as=beebox", "install a ci=true", "verify a as=beebox"], stdout: "a: installing (the recorded install no longer verifies)..." },
  );
});

void test("A legacy box without a manifest and a box whose link fails are skipped, and the rest proceed", async (t) => {
  const s = await setup();
  t.teardown(() => rm(s.root, { recursive: true, force: true }));
  await s.box("legacy", { manifest: false });
  const unlinked = await s.box("unlinked");
  await writeFile(join(unlinked, ".fail-link"), "");
  await s.box("z");

  const result = await s.run();
  t.check(
    { code: result.code, calls: result.calls, stderr: result.stderr },
    { code: 0, calls: ["link unlinked as=beebox", "link z as=beebox", "install z ci=true", "verify z as=beebox"], stderr: "ERROR unlinked: could not link .beebox/engine; skipping its install." },
  );
});

void test("Wrong arguments exit 2 with usage", async (t) => {
  const outcome = await execFileAsync(helper, []).then(
    () => ({ code: 0, stderr: "" }),
    (error: { code?: number; stderr?: string }) => ({ code: error.code ?? -1, stderr: (error.stderr ?? "").trim() }),
  );
  t.check(outcome, { code: 2, stderr: "usage: bbx-box-install <boxes root> <engine>" });
});
