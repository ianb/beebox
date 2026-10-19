// # `bbx init` refuses a box inside another repository
//
// A box is its own git repository. On 2026-10-04 a throwaway box created under
// the monorepo's gitignored `scratch/` directory skipped `git init`, because
// `isRepo` answered "yes" for any directory inside a repository. Every git and
// annex command after that ran against the monorepo, which ended up
// annex-initialized. Now `isRepo` means "the root of its own repository", and
// init refuses a nested target before it writes anything.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { runInit } from "../../../src/cli/commands/init.js";
import { isRepo, repoRootOf } from "../../../src/lib/git/core/operations.js";

const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "bbx-init-nested-")));
const outer = path.join(dir, "outer");
await fs.mkdir(outer);
execFileSync("git", ["init", "-q", "-b", "main"], { cwd: outer });

// ## A directory inside a repository is not a repository
//
// The outer repository's root is a repository; a folder inside it is not,
// though git can see the outer one from there.
void test("The outer repository's root is a repository; a folder inside it is not, thoug...", async (t) => {
  t.teardown(async () => {
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L30
  const inside = path.join(outer, "scratch", "box");
  await fs.mkdir(inside, { recursive: true });
  t.check(await isRepo(outer), true);

  // doctest:L35
  t.check(await isRepo(inside), false);

  // doctest:L38
  t.check(path.relative(dir, (await repoRootOf(inside)) ?? ""), "outer");

  // ## Init refuses the nested path and leaves the outer repository alone
  //
  // The refusal names both paths. Nothing is scaffolded in the target, and the
  // outer repository gains no annex configuration.

  // doctest:L48
  const refused = await runInit(inside, { branch: "main" }).then(() => null, (error) => error);
  t.check(refused.name, "NestedBoxError");

  // doctest:L52
  t.check(path.relative(dir, refused.enclosingRepo), "outer");

  // doctest:L55
  t.check(await fs.readdir(inside), []);

  // `git config --get-regexp` exits 1 when no key matches: the outer repository
  // has no annex settings.

  // doctest:L63
  t.check(spawnSync("git", ["config", "--get-regexp", "^annex"], { cwd: outer }).status, 1);

  // ## A target that does not exist yet is checked against its nearest ancestor

  // doctest:L70
  const deeper = path.join(outer, "not", "yet", "box");
  t.check((await runInit(deeper, { branch: "main" }).then(() => "created", (error) => error.name)), "NestedBoxError");

  // ## Outside any repository, init proceeds

  // doctest:L78
  const standalone = path.join(dir, "standalone");
  await runInit(standalone, { branch: "main" });
  t.check(await isRepo(standalone), true);
});
