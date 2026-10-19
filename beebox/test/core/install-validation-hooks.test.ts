// # Install Validation Hooks
//
// `installValidationHooks` writes two managed hooks into a box:
//
// - `.claude/settings.json` — a `PostToolUse` entry that runs `bbx validate --hook` after Edit/Write/MultiEdit on `.card` files (warns the agent, doesn't block)
// - `.git/hooks/pre-commit` — runs `bbx validate --pre-commit` (the whole commit-time suite in one process) and blocks the commit if any blocking check fails
// - `.git/hooks/post-commit` — a marker-delimited managed block that fires `bbx validate --urls --urls-since HEAD~1` in the background (non-blocking external-URL check)
//
// Both writes are idempotent and merge-aware. The settings file preserves unrelated keys and unrelated `PostToolUse` entries. A foreign pre-commit hook (one we didn't write) is left alone with a warning. The post-commit block is spliced into whatever already exists there (e.g. a git-lfs hook), preserving it.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, not } from "@ianbicking/tap-check/check";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { installValidationHooks } from "../../src/core/install-validation-hooks.js";
import { z } from "zod";
import { makeTmpBox, type TmpBox } from "../helpers/test-helpers.js";

const settingsSchema = z.object({
  hooks: z.object({
    PostToolUse: z.array(z.object({ matcher: z.string(), hooks: z.array(z.object({ command: z.string() })) })),
  }),
  permissions: z.unknown().optional(),
  model: z.unknown().optional(),
});

/** The box's `.claude/settings.json`, parsed against the shape these tests read. */
async function readSettings(box: TmpBox) {
  return settingsSchema.parse(JSON.parse(await fs.readFile(path.join(box.root, ".claude/settings.json"), "utf-8")));
}

// shapeVersion 3: one root. `box.root` holds `.claude/`, `.git/`, and every
// `_`-prefixed operational area — git needs to be initialized there for
// pre-commit to be written.
async function makeBox() {
  return makeTmpBox({ git: true });
}

// ## Fresh install — writes both files
void test("Fresh install — writes both files", async (t) => {
  const box = await makeBox();
  const changed = await installValidationHooks(box.root);
  t.check(changed.toSorted(), [
    ".claude/rules/bbx-validate-ignore.md",
    ".claude/settings.json",
    ".git/hooks/post-commit",
    ".git/hooks/pre-commit",
    "_config/bbx-validate.ignore",
  ]);

  // The settings file has a single PostToolUse entry with the bbx path embedded:

  const settings = await readSettings(box);
  t.check(settings.hooks.PostToolUse, [
    { matcher: "Edit|Write|MultiEdit", hooks: [{ command: any(String).endsWith(" validate --hook") }] },
  ]);

  // The pre-commit hook is executable and carries the manager marker. git-annex runs
  // before the `bbx` fallback: `git annex init` declines to install its own pre-commit
  // hook when one already exists, so this line is the only thing that runs annex at
  // commit time, and the hook `exit 0`s when `bbx` is not resolvable. An annex call
  // placed below that would vanish on the under-provisioned machine most likely to be
  // missing git-annex too. The annex block is gated on whether this repo is annexed;
  // once it is, a missing binary is fatal. One `bbx` invocation does the whole
  // commit-time suite (it used to be several, each paying the CLI startup floor while
  // holding the git lock), and no manifest-era `attachments verify` call remains.
  const hookPath = path.join(box.root, ".git/hooks/pre-commit");
  const hookBody = await fs.readFile(hookPath, "utf-8");
  // The hook is a 50-line shell script with explanatory comments; whole-text equality would
  // break on any comment edit, so each rule above gets its own narrow check.
  t.check(hookBody, any(String).includes("# beebox validation hook (managed)"));
  t.check(hookBody, any(String).matches(/git annex pre-commit[\S\s]*skipping card validation/));
  t.check(hookBody, any(String).includes('if [ -d "$(git rev-parse --git-common-dir)/annex" ]').includes("this repo uses git-annex but git-annex is not installed"));
  t.check(hookBody.split("\n").filter((l) => l.startsWith('"$BBX" ')), ['"$BBX" validate --pre-commit']);
  t.check(hookBody, not(any(String).includes("attachments verify")));
  t.check(hookBody, not(any(String).includes("attachments check-unlisted")));
  t.check(hookBody, not(any(String).includes("validate --links")));
  t.check((await fs.stat(hookPath)).mode & 0o111, 0o111);
});

// ## Which `bbx` gets stamped — the engine the box depends on
//
// When the box has an installed engine (`node_modules/beebox`), the hooks run
// that engine's `bin/bbx`, resolved to its real path — so a managed worktree's
// box clone, whose link points at the worktree's checkout, validates its
// commits with the worktree's schemas, whichever checkout reinstalls the hooks.
// `BBX_HOOK_BIN` still wins when set, so this case clears it:
void test("When the box has an installed engine (nodemodules/beebox), the hooks run that...", async (t) => {
  const box = await makeBox();
  const engine = await fs.mkdtemp(path.join(os.tmpdir(), "bbx-fake-engine-"));
  await fs.mkdir(path.join(engine, "bin"));
  await fs.writeFile(path.join(engine, "bin", "bbx"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  await fs.mkdir(path.join(box.root, "node_modules"), { recursive: true });
  await fs.symlink(engine, path.join(box.root, "node_modules", "beebox"));

  const savedOverride = process.env["BBX_HOOK_BIN"];
  delete process.env["BBX_HOOK_BIN"];
  try {
    await installValidationHooks(box.root);
  } finally {
    if (savedOverride !== undefined) process.env["BBX_HOOK_BIN"] = savedOverride;
  }

  const expected = JSON.stringify(path.join(await fs.realpath(engine), "bin", "bbx"));
  const preCommit = await fs.readFile(path.join(box.root, ".git/hooks/pre-commit"), "utf-8");
  const settings = await readSettings(box);
  t.check(preCommit, any(String).includes(`BBX=${expected}\n`));
  t.check(settings.hooks.PostToolUse[0]?.hooks, [{ command: `${expected} validate --hook` }]);
});

// ## Idempotent — second run changes nothing
void test("Idempotent — second run changes nothing", async (t) => {
  const box = await makeBox();
  await installValidationHooks(box.root);
  const second = await installValidationHooks(box.root);
  t.check(second, []);
});

// ## Rename migration — replaces the retired managed hook
void test("Rename migration — replaces the retired managed hook", async (t) => {
  const box = await makeBox();
  const hookPath = path.join(box.root, ".git/hooks/pre-commit");
  await fs.writeFile(hookPath, "#!/bin/sh\n# callback-box validation hook (managed)\nexit 0\n");
  await installValidationHooks(box.root);
  const migrated = await fs.readFile(hookPath, "utf8");
  const fresh = await makeBox();
  await installValidationHooks(fresh.root);
  t.check(migrated, await fs.readFile(path.join(fresh.root, ".git/hooks/pre-commit"), "utf8"));
});

// The post-commit migration removes the retired URL-check block instead of
// leaving it ahead of the new block:
void test("The post-commit migration removes the retired URL-check block instead of leav...", async (t) => {
  const box = await makeBox();
  const postPath = path.join(box.root, ".git/hooks/post-commit");
  await fs.writeFile(
    postPath,
    `#!/bin/sh
echo foreign-hook

# >>> callback-box url-check (managed) >>>
echo old-block-one
# <<< callback-box url-check (managed) <<<

# >>> callback-box url-check (managed) >>>
echo old-block-two
# <<< callback-box url-check (managed) <<<

# >>> beebox url-check (managed) >>>
BBX_URLCHECK="/stale/bin/bbx"
# <<< beebox url-check (managed) <<<
`,
  );
  await installValidationHooks(box.root);
  const migrated = await fs.readFile(postPath, "utf8");
  // The foreign hook stays, both retired blocks are gone, and the stale block is replaced by a
  // current one: the text after the foreign hook is the block a fresh install writes.
  const fresh = await makeBox();
  await installValidationHooks(fresh.root);
  const freshPost = await fs.readFile(path.join(fresh.root, ".git/hooks/post-commit"), "utf8");
  t.check(migrated, `#!/bin/sh\necho foreign-hook\n\n\n\n${freshPost.slice(freshPost.indexOf("# >>> beebox url-check (managed) >>>"))}`);
});

// ## Merge — preserves unrelated settings keys
//
// Existing user settings under unrelated top-level keys are preserved verbatim:
void test("Existing user settings under unrelated top-level keys are preserved verbatim:", async (t) => {
  const box = await makeBox();
  await fs.mkdir(path.join(box.root, ".claude"), { recursive: true });
  await fs.writeFile(
    path.join(box.root, ".claude/settings.json"),
    JSON.stringify({
      permissions: { allow: ["Bash(npm test)"] },
      model: "custom-model",
    }, null, 2)
  );

  await installValidationHooks(box.root);

  // The validation hook was added alongside the preserved keys.
  t.check(await readSettings(box), {
    permissions: { allow: ["Bash(npm test)"] },
    model: "custom-model",
    hooks: {
      PostToolUse: [{ matcher: "Edit|Write|MultiEdit", hooks: [{ command: any(String).endsWith(" validate --hook") }] }],
    },
  });
});

// ## Merge — preserves unrelated PostToolUse entries
//
// A user-installed PostToolUse hook for a different matcher (or different command) stays alongside ours:
void test("A user-installed PostToolUse hook for a different matcher (or different comma...", async (t) => {
  const box = await makeBox();
  await fs.mkdir(path.join(box.root, ".claude"), { recursive: true });
  await fs.writeFile(
    path.join(box.root, ".claude/settings.json"),
    JSON.stringify({
      hooks: {
        PostToolUse: [
          { matcher: "Bash", hooks: [{ type: "command", command: "/usr/bin/true" }] },
        ],
      },
    }, null, 2)
  );

  await installValidationHooks(box.root);

  const settings = await readSettings(box);
  // User's entry is still there, untouched:
  t.check(settings.hooks.PostToolUse, [
    { matcher: "Bash", hooks: [{ command: "/usr/bin/true" }] },
    { matcher: "Edit|Write|MultiEdit", hooks: [{ command: any(String).endsWith(" validate --hook") }] },
  ]);
});

// ## Bbx path drift — updates command when beebox moves
//
// If the existing settings file references a stale bbx path (the old `validate "$f"` style), `installValidationHooks` rewrites the command in place rather than duplicating the entry:
void test("If the existing settings file references a stale bbx path (the old validate \"...", async (t) => {
  const box = await makeBox();
  await fs.mkdir(path.join(box.root, ".claude"), { recursive: true });
  await fs.writeFile(
    path.join(box.root, ".claude/settings.json"),
    JSON.stringify({
      hooks: {
        PostToolUse: [
          {
            matcher: "Edit|Write|MultiEdit",
            hooks: [{ type: "command", command: "/old/path/bbx validate \"$f\"" }],
          },
        ],
      },
    }, null, 2)
  );

  await installValidationHooks(box.root);

  const settings = await readSettings(box);
  t.check(settings.hooks.PostToolUse, [
    { matcher: "Edit|Write|MultiEdit", hooks: [{ command: any(String).endsWith(" validate --hook") }] },
  ]);
});

// ## Not a git repo — skips pre-commit install silently
//
// If `.git/` does not exist (a non-box directory, or a fixture that skipped git), only the settings file gets written; the pre-commit step is skipped instead of bootstrapping a stray `.git/hooks/` directory:
void test("If .git/ does not exist (a non-box directory, or a fixture that skipped git),...", async (t) => {
  const box = await makeTmpBox({ git: "none" });
  const changed = await installValidationHooks(box.root);
  t.check(changed.toSorted(), [
    ".claude/rules/bbx-validate-ignore.md",
    ".claude/settings.json",
    "_config/bbx-validate.ignore",
  ]);

  // No phantom `.git/` directory was created:

  await t.checkThrows(() => fs.access(path.join(box.root, ".git")), "Error");
});

// ## Foreign pre-commit hook — left alone
//
// A pre-commit hook that doesn't carry our marker is the user's own and stays put:
void test("A pre-commit hook that doesn't carry our marker is the user's own and stays put:", async (t) => {
  const box = await makeBox();
  const hookPath = path.join(box.root, ".git/hooks/pre-commit");
  await fs.writeFile(hookPath, "#!/bin/sh\necho user hook\n");
  await fs.chmod(hookPath, 0o755);

  const origConsoleWarn = console.warn;
  console.warn = () => {};
  const changed = await installValidationHooks(box.root);
  console.warn = origConsoleWarn;

  t.check(changed, ["_config/bbx-validate.ignore", ".claude/rules/bbx-validate-ignore.md", ".claude/settings.json", ".git/hooks/post-commit"]);

  // The user's hook is unchanged:

  await t.checkText(await fs.readFile(hookPath, "utf-8"), `#!/bin/sh
echo user hook`);
});

// ## git-annex pre-commit hook — adopted and chained
//
// When `git annex init` gets the hook slot first, it installs its canonical
// three-line hook. That hook is safe to adopt: beebox's managed hook keeps
// the annex command and adds the card-validation gate after it.
void test("When git annex init gets the hook slot first, it installs its canonical three...", async (t) => {
  const box = await makeBox();
  const hookPath = path.join(box.root, ".git/hooks/pre-commit");
  await fs.writeFile(
    hookPath,
    "#!/bin/sh\n# automatically configured by git-annex\ngit annex pre-commit .\n",
  );
  await fs.chmod(hookPath, 0o755);

  const changed = await installValidationHooks(box.root);
  const body = await fs.readFile(hookPath, "utf-8");
  const again = await installValidationHooks(box.root);
  t.check(changed, ["_config/bbx-validate.ignore", ".claude/rules/bbx-validate-ignore.md", ".claude/settings.json", ".git/hooks/pre-commit", ".git/hooks/post-commit"]);
  // The managed hook is a 50-line commented script: three narrow checks show it adopted the annex line and added the gate.
  t.check(body, any(String).includes("# beebox validation hook (managed)").includes("git annex pre-commit").includes('"$BBX" validate --pre-commit'));
  t.check(again, []);
});

// A near-match with an extra user command is foreign, even though it contains
// git-annex's generated body, and remains byte-for-byte untouched:
void test("A near-match with an extra user command is foreign, even though it contains g...", async (t) => {
  const box = await makeBox();
  const hookPath = path.join(box.root, ".git/hooks/pre-commit");
  const customBody = "#!/bin/sh\n# automatically configured by git-annex\ngit annex pre-commit .\necho custom\n";
  await fs.writeFile(hookPath, customBody);

  const origConsoleWarn = console.warn;
  console.warn = () => {};
  const changed = await installValidationHooks(box.root);
  console.warn = origConsoleWarn;

  t.check(changed, ["_config/bbx-validate.ignore", ".claude/rules/bbx-validate-ignore.md", ".claude/settings.json", ".git/hooks/post-commit"]);
  t.check(await fs.readFile(hookPath, "utf-8"), customBody);
});

// ## Post-commit — managed block, fresh file
//
// With no existing post-commit hook, one is created with our marker block and the
// non-blocking `--urls-since HEAD~1` command, and it's executable:
void test("With no existing post-commit hook, one is created with our marker block and t...", async (t) => {
  const box = await makeBox();
  await installValidationHooks(box.root);
  const body = await fs.readFile(path.join(box.root, ".git/hooks/post-commit"), "utf-8");
  // A commented shell block: its markers and command are the contract, so the check is narrow.
  t.check(body, any(String).startsWith("#!/usr/bin/env bash\n").includes("# >>> beebox url-check (managed) >>>").includes("validate --urls --urls-since HEAD~1"));
  t.check((await fs.stat(path.join(box.root, ".git/hooks/post-commit"))).mode & 0o111, 0o111);
});

// ## Post-commit — coexists with a foreign hook (git-lfs)
//
// A pre-existing post-commit (e.g. git-lfs) is preserved verbatim; our block is
// appended after it. A second install is idempotent — the foreign hook stays and
// nothing changes:
void test("A pre-existing post-commit (e.g.", async (t) => {
  const box = await makeBox();
  const postPath = path.join(box.root, ".git/hooks/post-commit");
  const lfs = "#!/bin/sh\ngit lfs post-commit \"$@\"\n";
  await fs.writeFile(postPath, lfs);

  await installValidationHooks(box.root);
  const merged = await fs.readFile(postPath, "utf-8");
  t.check(merged, any(String).startsWith(lfs).includes("beebox url-check (managed)"));

  const again = await installValidationHooks(box.root);
  t.check(again, []);
  t.check(await fs.readFile(postPath, "utf-8"), merged);
});

// ## Validation-ignore scaffold — seed file + operator guardrail rule
//
// `installValidationHooks` also seeds the operator-owned `_config/bbx-validate.ignore`
// (a commented template — no active entries, since the builtin skips already cover
// bbx's generated docs) and installs a path-conditional `.claude/rules/` rule that
// fires only when an agent opens that file, warning it off. The seed is commented
// out; the rule is scoped to the ignore file's path:
void test("installValidationHooks also seeds the operator-owned config/bbx-validate.igno...", async (t) => {
  const box = await makeBox();
  await installValidationHooks(box.root);

  const seed = await fs.readFile(path.join(box.root, "_config/bbx-validate.ignore"), "utf-8");
  // Every non-blank line is a comment — nothing is actively ignored out of the box.
  t.check(seed.split("\n").filter((l) => l.trim() !== "" && !l.trimStart().startsWith("#")), []);

  const rule = await fs.readFile(path.join(box.root, ".claude/rules/bbx-validate-ignore.md"), "utf-8");
  // path-conditional scope; the rest is generated prose, so the check stays narrow
  t.check(rule, any(String).includes("- \"_config/bbx-validate.ignore\""));

  // An operator's edits to the ignore file are never clobbered — the seed is written
  // only when the file is absent, so a second install (or a deploy-sync) leaves a
  // customized file untouched:

  await fs.writeFile(path.join(box.root, "_config/bbx-validate.ignore"), "vendor/**\n");
  const again = await installValidationHooks(box.root);
  t.check(again, []);

  t.check(await fs.readFile(path.join(box.root, "_config/bbx-validate.ignore"), "utf-8"), "vendor/**\n");
});
