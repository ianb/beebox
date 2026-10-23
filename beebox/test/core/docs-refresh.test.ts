// # The unattended generated-docs refresh
//
// `refreshGeneratedDocs` is what `deploy.sh` runs per box after `bbx migrate --sweep`
// (as `bbx docs refresh`): regenerate the box's agent docs, card rules, and managed
// skills if the engine that wrote them has moved on, commit the result, and leave
// a box that needs a human alone. See `src/core/docs-refresh.ts`.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, containing, not } from "@ianbicking/tap-check/check";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { rm, writeFile, mkdir, chmod, access, utimes } from "node:fs/promises";
import { makeTmpBox, type TmpBox } from "../helpers/test-helpers.js";
import { refreshGeneratedDocs } from "../../src/core/docs-refresh.js";
import { acquireBoxWork, boxMaintenanceStatus } from "../../src/lib/box-maintenance/admission.js";
import { GENERATE_MARKER, generatedDocsAreCurrent } from "../../src/core/docs-gen/generate/core.js";
import { withDocId } from "../../src/core/docs-gen/shared.js";
import { PACKAGE_ROOT } from "../../src/lib/package-root.js";

// This runs a real, executable `.git/hooks/pre-commit`. In a linked worktree,
// `resolveBbxBin` (install-validation-hooks.ts) would otherwise stamp the
// MAIN checkout's `bbx` — which can lag behind whatever this worktree is
// actively developing — so pin it to this checkout's own freshly-built binary.
process.env["BBX_HOOK_BIN"] = join(PACKAGE_ROOT, "bin", "bbx");

/** A committed, clean box shaped enough like a real one for a full doc run:
 *  the box `.gitignore` a real box gets from `bbx init` (without it, the
 *  deliberately gitignored `_content/docs/generated/` and `.beebox/` read as
 *  untracked and every run would look dirty) and an AGENTS.md for the generator
 *  to add its @-includes to. */
async function makeCleanBox() {
  const box = await makeTmpBox({ git: true });
  await box.write(".gitignore", ".beebox/\n_content/docs/generated/\n");
  await box.write("AGENTS.md", "# Box\n");
  box.commitAll("seed box");
  return box;
}

function git(box: TmpBox, ...args: string[]) {
  return execFileSync("git", args, { cwd: box.root }).toString().trim();
}

// ## A stale box is regenerated, and the result is committed
//
// The first run on a box that has never generated: rules and skills land together
// (they share one path now — `syncTemplatesFromSource` calls `generateRules` and
// `generateSkills` side by side), and the generated output is committed together.
void test("The first run on a box that has never generated:", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeCleanBox();

  const result = await refreshGeneratedDocs({ boxRoot: box.root });
  t.check(
    {
      result,
      rules: git(box, "ls-files", ".claude/rules").split("\n"),
      skills: git(box, "ls-files", ".claude/skills").split("\n"),
      status: git(box, "status", "--porcelain"),
    },
    {
      result: { status: "refreshed" },
      rules: containing<string>([".claude/rules/card-pdf.md"]),
      skills: containing<string>([".claude/skills/views/SKILL.md"]),
      status: "",
    },
  );

  // One measured output commit carries the refresh attribution.

  t.check(git(box, "log", "-1", "--format=%s|%(trailers:key=Created-By,valueonly)"), "Refresh generated docs|docs-refresh");
});

// ## A box whose docs are current is a silent no-op
//
// This runs against every box on every deploy, so the quiet path has to stay
// quiet. The cache (input mtimes + the running engine's version) is left in place
// rather than forced — a box someone chatted with between the deploy and this step
// already regenerated.
void test("This runs against every box on every deploy, so the quiet path has to stay qu...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeCleanBox();
  await refreshGeneratedDocs({ boxRoot: box.root });
  const before = Number(git(box, "rev-list", "--count", "HEAD"));

  const result = await refreshGeneratedDocs({ boxRoot: box.root });
  t.check(
    { result, commits: Number(git(box, "rev-list", "--count", "HEAD")) },
    { result: { status: "current" }, commits: before },
  );

  // Quiet also means the gate never closed. With live work admitted, a refresh that
  // closed first would wait in its drain; this one answers while the work is still
  // running and leaves no maintenance phase behind.

  const busy = await acquireBoxWork(box.root, { reason: "live chat run" });
  const quiet = refreshGeneratedDocs({ boxRoot: box.root }).then((outcome) => outcome.status);
  t.check(await Promise.race([quiet, new Promise((resolve) => setTimeout(() => resolve("still draining"), 3000))]), "current");

  t.check(await boxMaintenanceStatus(box.root), null);

  await busy.release();
});

// ## Stale rules and skills are rewritten once the cache is invalidated
//
// What the deploy step exists for: the engine moved, so the generated guidance the
// box carries is wrong. Dropping the marker stands in for the version bump the
// deploy stamp gives on the real path. The stale skill carries its DOCID marker,
// as every file the engine wrote does; a `SKILL.md` without one is the
// boxholder's and is left alone (`test/core/box/guidance-sync/skills/core.test.ts`).
void test("What the deploy step exists for:", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeCleanBox();
  await refreshGeneratedDocs({ boxRoot: box.root });

  await writeFile(box.path(".claude/rules/card-pdf.md"), "stale rule\n");
  await writeFile(
    box.path(".claude/skills/views/SKILL.md"),
    withDocId({ relativePath: ".claude/skills/views/SKILL.md", content: "stale skill\n" }),
  );
  await rm(box.path(GENERATE_MARKER));
  box.commitAll("box carries stale generated guidance");

  const result = await refreshGeneratedDocs({ boxRoot: box.root });
  const rule = await box.read(".claude/rules/card-pdf.md");
  const skill = await box.read(".claude/skills/views/SKILL.md");
  t.check(
    { result, rule, skill, status: git(box, "status", "--porcelain") },
    {
      result: { status: "refreshed" },
      rule: not(any(String).startsWith("stale")),
      skill: not(any(String).includes("stale skill")),
      status: "",
    },
  );
});

// ## A changed box-local schema makes the docs stale
//
// A box's own `src/schemas/*.ts` feeds its card rules and the agent guide, so
// editing one has to invalidate the cache; otherwise the refresh answers
// `current` and the rules keep describing the old fields.
void test("A changed box-local schema makes the docs stale", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeCleanBox();
  await refreshGeneratedDocs({ boxRoot: box.root });
  const before = await generatedDocsAreCurrent(box.root);

  await box.write("src/schemas/loan.ts", "export {};\n");
  const later = new Date(Date.now() + 60_000);
  await utimes(box.path("src/schemas/loan.ts"), later, later);

  t.check({ before, after: await generatedDocsAreCurrent(box.root) }, { before: true, after: false });
});

// ## Dirty input remains outside the generated-output commit
void test("Dirty input remains outside the generated-output commit", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeCleanBox();
  await box.write("_content/notes.md", "work in progress\n");
  git(box, "add", "_content/notes.md");
  const result = await refreshGeneratedDocs({ boxRoot: box.root });
  t.check({ result, staged: git(box, "diff", "--cached", "--name-only"), committed: git(box, "ls-tree", "--name-only", "HEAD", "_content/notes.md") }, {
    result: { status: "refreshed" },
    staged: "_content/notes.md",
    committed: "",
  });
});

// ## Rejected output invalidates the cache and retains its original recovery baseline
//
// The failed generation has already written files. Retrying must commit those
// files, rather than treating them as unrelated dirt in a fresh snapshot.
void test("The failed generation has already written files.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeCleanBox();
  const hooks = join(git(box, "rev-parse", "--absolute-git-dir"), "reject-hooks");
  await mkdir(hooks);
  await writeFile(join(hooks, "pre-commit"), "#!/bin/sh\nexit 1\n");
  await chmod(join(hooks, "pre-commit"), 0o755);
  git(box, "config", "core.hooksPath", hooks);
  await t.checkThrows(async () => (await refreshGeneratedDocs({ boxRoot: box.root })), "DocsRefreshError");

  await t.checkThrows(async () => (await access(box.path(GENERATE_MARKER))), "Error");

  const pending = git(box, "rev-parse", "refs/bbx/migrations/docs-refresh/pending");
  t.check(pending, any(String).matches(/^[\da-f]{40,64}$/));

  git(box, "config", "--unset", "core.hooksPath");
  const result = await refreshGeneratedDocs({ boxRoot: box.root });
  t.check({ result, rules: git(box, "ls-files", ".claude/rules").split("\n"), pending: git(box, "for-each-ref", "--format=%(objectname)", "refs/bbx/migrations/docs-refresh/pending"), status: git(box, "status", "--porcelain") }, {
    result: { status: "refreshed" },
    rules: containing<string>([".claude/rules/card-pdf.md"]),
    pending: "",
    status: "",
  });
});
