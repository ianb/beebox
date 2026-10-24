// # The engine link
//
// A box commits `"beebox": "link:.beebox/engine"`, and `.beebox/engine` is a
// gitignored symlink to this machine's engine. `ensureEngineLink` makes it in
// TypeScript (`bbx engine init`, the migration); `bin/box-engine-link` is the
// shell side every install path runs around `pnpm install`.
// Plan: `docs/implemented-plans/portable-engine-dependency.md`.

import { test, type Test } from "tap";
import "@ianbicking/tap-check/tap";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { ensureEngineLink, EngineLinkError } from "../../../src/core/box/engine-link.js";
import { PACKAGE_ROOT } from "../../../src/lib/package-root.js";

async function scratch(t: Test): Promise<string> {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "bbx-engine-link-")));
  t.teardown(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

async function fakeEngine(dir: string): Promise<string> {
  await fs.mkdir(path.join(dir, "bin"), { recursive: true });
  await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "beebox", version: "1.0.0", bin: { bbx: "./bin/bbx" } }));
  await fs.writeFile(path.join(dir, "bin/bbx"), "#!/bin/sh\n", { mode: 0o755 });
  return dir;
}

const errorName = (e: unknown): string => (e instanceof EngineLinkError ? e.name : String(e));

// ## A usable link is kept, a dead one replaced
//
// The main checkout's `bbx engine init` run on a worktree clone must not
// repoint it, so a link that already resolves to an engine stays, whatever
// target the caller offers. A missing or dead link is pointed at the target.
// A target that is not an engine, or lies inside the box, is refused.
void test("a usable link is kept, a dead one replaced", async (t) => {
  const dir = await scratch(t);
  const box = path.join(dir, "box");
  await fs.mkdir(box);
  const first = await fakeEngine(path.join(dir, "first"));
  const second = await fakeEngine(path.join(dir, "second"));
  const link = path.join(box, ".beebox/engine");

  const created = await ensureEngineLink(box, first);
  const kept = await ensureEngineLink(box, second);
  const keptTarget = await fs.readlink(link);
  await fs.rm(first, { recursive: true });
  const replaced = await ensureEngineLink(box, second);
  const replacedTarget = await fs.readlink(link);
  const other = path.join(dir, "other");
  await fs.mkdir(other);
  const notEngine = await ensureEngineLink(other, dir).catch(errorName);
  const inBox = await ensureEngineLink(other, await fakeEngine(path.join(other, "node_modules/beebox"))).catch(errorName);
  t.check({ created, kept, keptTarget, replaced, replacedTarget, notEngine, inBox }, {
    created: { written: true },
    kept: { written: false },
    keptTarget: first,
    replaced: { written: true },
    replacedTarget: second,
    notEngine: "EngineLinkError",
    inBox: "EngineLinkError",
  });
});

// ## The shell check
//
// `link` refuses a directory that is not an engine and one inside the box.
// `verify` passes only for a completed install: `node_modules/beebox` is an
// engine reached through the engine link (the box declares the portable
// spec), `.bin/bbx` exists, and every declared dependency is present. A fresh
// `bbx engine init` leaves only `node_modules/beebox`, which must not pass.
void test("bin/box-engine-link refuses a non-engine and verifies an install", async (t) => {
  const dir = await scratch(t);
  const box = path.join(dir, "box");
  await fs.mkdir(box);
  await fs.writeFile(path.join(box, "package.json"), JSON.stringify({ dependencies: { beebox: "link:.beebox/engine", react: "^18.3.1" } }));
  const engine = await fakeEngine(path.join(dir, "engine"));
  const inside = await fakeEngine(path.join(box, "vendor/beebox"));
  const run = (...args: string[]): { code: number | null; stderr: string } => {
    const r = spawnSync(path.join(PACKAGE_ROOT, "bin/box-engine-link"), args, { encoding: "utf8" });
    return { code: r.status, stderr: r.stderr.trim() };
  };

  const notEngine = run("link", box, dir);
  const inBox = run("link", box, inside);
  const verifyBefore = run("verify", box);
  const linked = run("link", box, engine);
  await fs.mkdir(path.join(box, "node_modules/.bin"), { recursive: true });
  await fs.symlink(engine, path.join(box, "node_modules/beebox"));
  const direct = run("verify", box);
  await fs.unlink(path.join(box, "node_modules/beebox"));
  await fs.symlink("../.beebox/engine", path.join(box, "node_modules/beebox"));
  const noBin = run("verify", box);
  await fs.symlink("../beebox/bin/bbx", path.join(box, "node_modules/.bin/bbx"));
  const freshInit = run("verify", box);
  await fs.mkdir(path.join(box, "node_modules/react"));
  await fs.writeFile(path.join(box, "node_modules/react/package.json"), JSON.stringify({ name: "react" }));
  const verified = run("verify", box);
  t.check({ notEngine, inBox, verifyBefore, linked, target: await fs.readlink(path.join(box, ".beebox/engine")), direct, noBin, freshInit, verified }, {
    notEngine: { code: 1, stderr: `box-engine-link: ${box}: ${dir} is not a beebox engine package; not linking.` },
    inBox: { code: 1, stderr: `box-engine-link: ${box}: ${inside} is inside the box; the next install could remove it.` },
    verifyBefore: { code: 1, stderr: `box-engine-link: ${box}: node_modules/beebox is not a beebox engine after install.` },
    linked: { code: 0, stderr: "" },
    target: engine,
    direct: { code: 1, stderr: `box-engine-link: ${box}: node_modules/beebox does not go through .beebox/engine; rerun pnpm install.` },
    noBin: { code: 1, stderr: `box-engine-link: ${box}: node_modules/.bin/bbx is missing after install; rerun pnpm install with .beebox/engine in place.` },
    freshInit: { code: 1, stderr: `box-engine-link: ${box}: declared dependencies are not installed: react.` },
    verified: { code: 0, stderr: "" },
  });
});

// ## The portable spec in devDependencies
//
// The migration converts `beebox` in either dependency field, so `verify`
// reads both: a portable devDependency with an old direct
// `node_modules/beebox` link is not a completed install.
void test("bin/box-engine-link verify reads the beebox spec from devDependencies too", async (t) => {
  const dir = await scratch(t);
  const box = path.join(dir, "box");
  const engine = await fakeEngine(path.join(dir, "engine"));
  await fs.mkdir(path.join(box, "node_modules/.bin"), { recursive: true });
  await fs.writeFile(path.join(box, "package.json"), JSON.stringify({ devDependencies: { beebox: "link:.beebox/engine" } }));
  await fs.symlink(engine, path.join(box, "node_modules/beebox"));
  await fs.symlink("../beebox/bin/bbx", path.join(box, "node_modules/.bin/bbx"));
  const r = spawnSync(path.join(PACKAGE_ROOT, "bin/box-engine-link"), ["verify", box], { encoding: "utf8" });
  t.check({ code: r.status, stderr: r.stderr.trim() }, {
    code: 1,
    stderr: `box-engine-link: ${box}: node_modules/beebox does not go through .beebox/engine; rerun pnpm install.`,
  });
});
