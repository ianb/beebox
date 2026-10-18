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
import "agent-doctest/tap";
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
  // doctest:L43
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

  // doctest:L58
  const settings = await readSettings(box);
  await t.checkText(settings.hooks.PostToolUse.length, "1");

  // doctest:L62
  t.check(settings.hooks.PostToolUse[0]?.matcher, "Edit|Write|MultiEdit");

  // doctest:L65
  t.check(settings.hooks.PostToolUse[0]?.hooks[0]?.command.endsWith(" validate --hook"), true);

  // The pre-commit hook is executable and includes the manager marker:

  // doctest:L72
  const hookPath = path.join(box.root, ".git/hooks/pre-commit");
  const hookBody = await fs.readFile(hookPath, "utf-8");
  await t.checkText(hookBody.includes("# beebox validation hook (managed)"), "true");

  // doctest:L77
  const stat = await fs.stat(hookPath);
  await t.checkText((stat.mode & 0o111) !== 0, "true");

  // ### git-annex runs before the `bbx` fallback
  //
  // `git annex init` declines to install its own pre-commit hook when one already
  // exists — ours does — so this line is the only thing that runs annex at commit
  // time. Its *position* is the load-bearing part: the hook `exit 0`s when `bbx` is
  // not resolvable, so an annex call placed below that would silently vanish on
  // exactly the under-provisioned machine most likely to be missing git-annex too,
  // and assets would quietly enter git history as raw bytes.

  // doctest:L92
  const annexAt = hookBody.indexOf("git annex pre-commit");
  const bbxFallbackExitAt = hookBody.indexOf("skipping card validation");
  await t.checkText(annexAt !== -1 && bbxFallbackExitAt !== -1 && annexAt < bbxFallbackExitAt, "true");

  // The annex block is gated on whether **this repo** is annexed, not on whether
  // git-annex is installed. A box still on the manifest model must keep committing
  // normally — requiring annex unconditionally would break every unmigrated box at
  // its next commit, which is a rollout foot-gun rather than a safety property.
  // Once a repo is annexed, a missing binary is fatal:

  // doctest:L105
  const gatedOnRepo = hookBody.includes('if [ -d "$(git rev-parse --git-common-dir)/annex" ]');
  const fatalWhenAnnexed = hookBody.includes("this repo uses git-annex but git-annex is not installed");
  t.check(`${gatedOnRepo} ${fatalWhenAnnexed}`, "true true");

  // The three `bbx` invocations the hook used to make — `validate --staged`,
  // `validate --links`, and `attachments check-unlisted` — are one. Each paid the
  // full CLI startup floor for a fraction of a second of work, and commit duration
  // is also git-lock hold duration for a box (see `docs/plans/commit-performance.md`).
  // The manifest-era `bbx attachments verify` call is gone too — git-annex is the
  // integrity mechanism now:

  // doctest:L119
  const bbxCalls = hookBody.split("\n").filter((l) => l.startsWith('"$BBX" '));
  t.check(bbxCalls, [
    "\"$BBX\" validate --pre-commit",
  ]);

  // doctest:L128
  t.check(
    [
      hookBody.includes("attachments verify"),
      hookBody.includes("attachments check-unlisted"),
      hookBody.includes("validate --links"),
    ],
    [
    false,
    false,
    false,
  ],
  );
});

// ## Which `bbx` gets stamped — the engine the box depends on
//
// When the box has an installed engine (`node_modules/beebox`), the hooks run
// that engine's `bin/bbx`, resolved to its real path — so a managed worktree's
// box clone, whose link points at the worktree's checkout, validates its
// commits with the worktree's schemas, whichever checkout reinstalls the hooks.
// `BBX_HOOK_BIN` still wins when set, so this case clears it:
void test("When the box has an installed engine (nodemodules/beebox), the hooks run that...", async (t) => {
  // doctest:L149
  const box = await makeBox();
  const engine = await fs.mkdtemp(path.join(os.tmpdir(), "bbx-fake-engine-"));
  await fs.mkdir(path.join(engine, "bin"));
  await fs.writeFile(path.join(engine, "bin", "bbx"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  await fs.mkdir(path.join(box.root, "node_modules"), { recursive: true });
  await fs.symlink(engine, path.join(box.root, "node_modules", "beebox"));

  // doctest:L156
  const savedOverride = process.env["BBX_HOOK_BIN"];
  delete process.env["BBX_HOOK_BIN"];
  try {
    await installValidationHooks(box.root);
  } finally {
    if (savedOverride !== undefined) process.env["BBX_HOOK_BIN"] = savedOverride;
  }

  // doctest:L164
  const expected = JSON.stringify(path.join(await fs.realpath(engine), "bin", "bbx"));
  const preCommit = await fs.readFile(path.join(box.root, ".git/hooks/pre-commit"), "utf-8");
  const settings = await readSettings(box);
  t.check(
    [
      preCommit.includes(`BBX=${expected}\n`),
      settings.hooks.PostToolUse[0]?.hooks[0]?.command === `${expected} validate --hook`,
    ],
    [
    true,
    true,
  ],
  );
});

// ## Idempotent — second run changes nothing
void test("Idempotent — second run changes nothing", async (t) => {
  // doctest:L181
  const box = await makeBox();
  await installValidationHooks(box.root);
  const second = await installValidationHooks(box.root);
  t.check(second, []);
});

// ## Rename migration — replaces the retired managed hook
void test("Rename migration — replaces the retired managed hook", async (t) => {
  // doctest:L191
  const box = await makeBox();
  const hookPath = path.join(box.root, ".git/hooks/pre-commit");
  await fs.writeFile(hookPath, "#!/bin/sh\n# callback-box validation hook (managed)\nexit 0\n");
  await installValidationHooks(box.root);
  const migrated = await fs.readFile(hookPath, "utf8");
  t.check([migrated.includes("# beebox validation hook (managed)"), migrated.includes("/bin/bbx")], [
    true,
    true,
  ]);
});

// The post-commit migration removes the retired URL-check block instead of
// leaving it ahead of the new block:
void test("The post-commit migration removes the retired URL-check block instead of leav...", async (t) => {
  // doctest:L208
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
  t.check(
    [
      migrated.includes("echo foreign-hook"),
      migrated.includes("callback-box url-check (managed)"),
      migrated.includes("beebox url-check (managed)"),
    ],
    [
    true,
    false,
    true,
  ],
  );
});

// ## Merge — preserves unrelated settings keys
//
// Existing user settings under unrelated top-level keys are preserved verbatim:
void test("Existing user settings under unrelated top-level keys are preserved verbatim:", async (t) => {
  // doctest:L248
  const box = await makeBox();
  await fs.mkdir(path.join(box.root, ".claude"), { recursive: true });
  await fs.writeFile(
    path.join(box.root, ".claude/settings.json"),
    JSON.stringify({
      permissions: { allow: ["Bash(npm test)"] },
      model: "custom-model",
    }, null, 2)
  );

  // doctest:L258
  await installValidationHooks(box.root);

  // doctest:L260
  const settings = await readSettings(box);
  t.check(settings.permissions, {
    allow: [
      "Bash(npm test)",
    ],
  });

  // doctest:L264
  t.check(settings.model, "custom-model");

  // The validation hook was added alongside:

  // doctest:L271
  t.check(settings.hooks.PostToolUse[0]?.matcher, "Edit|Write|MultiEdit");
});

// ## Merge — preserves unrelated PostToolUse entries
//
// A user-installed PostToolUse hook for a different matcher (or different command) stays alongside ours:
void test("A user-installed PostToolUse hook for a different matcher (or different comma...", async (t) => {
  // doctest:L280
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

  // doctest:L293
  await installValidationHooks(box.root);

  // doctest:L295
  const settings = await readSettings(box);
  await t.checkText(settings.hooks.PostToolUse.length, "2");

  // User's entry is still there, untouched:

  // doctest:L303
  const userEntry = settings.hooks.PostToolUse.find((e) => e.matcher === "Bash");
  t.check(userEntry?.hooks[0]?.command, "/usr/bin/true");
});

// ## Bbx path drift — updates command when beebox moves
//
// If the existing settings file references a stale bbx path (the old `validate "$f"` style), `installValidationHooks` rewrites the command in place rather than duplicating the entry:
void test("If the existing settings file references a stale bbx path (the old validate \"...", async (t) => {
  // doctest:L313
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

  // doctest:L329
  await installValidationHooks(box.root);

  // doctest:L331
  const settings = await readSettings(box);
  await t.checkText(settings.hooks.PostToolUse.length, "1");

  // doctest:L335
  t.check(settings.hooks.PostToolUse[0]?.hooks[0]?.command.endsWith(" validate --hook"), true);
});

// ## Not a git repo — skips pre-commit install silently
//
// If `.git/` does not exist (a non-box directory, or a fixture that skipped git), only the settings file gets written; the pre-commit step is skipped instead of bootstrapping a stray `.git/hooks/` directory:
void test("If .git/ does not exist (a non-box directory, or a fixture that skipped git),...", async (t) => {
  // doctest:L344
  const box = await makeTmpBox({ git: "none" });
  const changed = await installValidationHooks(box.root);
  t.check(changed.toSorted(), [
    ".claude/rules/bbx-validate-ignore.md",
    ".claude/settings.json",
    "_config/bbx-validate.ignore",
  ]);

  // No phantom `.git/` directory was created:

  // doctest:L357
  t.check(await fs.access(path.join(box.root, ".git")).then(() => true).catch(() => false), false);
});

// ## Foreign pre-commit hook — left alone
//
// A pre-commit hook that doesn't carry our marker is the user's own and stays put:
void test("A pre-commit hook that doesn't carry our marker is the user's own and stays put:", async (t) => {
  // doctest:L366
  const box = await makeBox();
  const hookPath = path.join(box.root, ".git/hooks/pre-commit");
  await fs.writeFile(hookPath, "#!/bin/sh\necho user hook\n");
  await fs.chmod(hookPath, 0o755);

  // doctest:L371
  const origConsoleWarn = console.warn;
  console.warn = () => {};
  const changed = await installValidationHooks(box.root);
  console.warn = origConsoleWarn;

  // doctest:L376
  await t.checkText(changed.includes(".git/hooks/pre-commit"), "false");

  // The user's hook is unchanged:

  // doctest:L383
  await t.checkText(await fs.readFile(hookPath, "utf-8"), `#!/bin/sh
echo user hook`);
});

// ## git-annex pre-commit hook — adopted and chained
//
// When `git annex init` gets the hook slot first, it installs its canonical
// three-line hook. That hook is safe to adopt: beebox's managed hook keeps
// the annex command and adds the card-validation gate after it.
void test("When git annex init gets the hook slot first, it installs its canonical three...", async (t) => {
  // doctest:L395
  const box = await makeBox();
  const hookPath = path.join(box.root, ".git/hooks/pre-commit");
  await fs.writeFile(
    hookPath,
    "#!/bin/sh\n# automatically configured by git-annex\ngit annex pre-commit .\n",
  );
  await fs.chmod(hookPath, 0o755);

  // doctest:L403
  const changed = await installValidationHooks(box.root);
  const body = await fs.readFile(hookPath, "utf-8");
  const again = await installValidationHooks(box.root);
  t.check(
    [
      changed.includes(".git/hooks/pre-commit"),
      body.includes("# beebox validation hook (managed)"),
      body.includes("git annex pre-commit"),
      body.includes('"$BBX" validate --pre-commit'),
      again.length,
    ],
    [
    true,
    true,
    true,
    true,
    0,
  ],
  );
});

// A near-match with an extra user command is foreign, even though it contains
// git-annex's generated body, and remains byte-for-byte untouched:
void test("A near-match with an extra user command is foreign, even though it contains g...", async (t) => {
  // doctest:L427
  const box = await makeBox();
  const hookPath = path.join(box.root, ".git/hooks/pre-commit");
  const customBody = "#!/bin/sh\n# automatically configured by git-annex\ngit annex pre-commit .\necho custom\n";
  await fs.writeFile(hookPath, customBody);

  // doctest:L432
  const origConsoleWarn = console.warn;
  console.warn = () => {};
  const changed = await installValidationHooks(box.root);
  console.warn = origConsoleWarn;

  // doctest:L437
  t.check(
    [
      changed.includes(".git/hooks/pre-commit"),
      (await fs.readFile(hookPath, "utf-8")) === customBody,
    ],
    [
    false,
    true,
  ],
  );
});

// ## Post-commit — managed block, fresh file
//
// With no existing post-commit hook, one is created with our marker block and the
// non-blocking `--urls-since HEAD~1` command, and it's executable:
void test("With no existing post-commit hook, one is created with our marker block and t...", async (t) => {
  // doctest:L454
  const box = await makeBox();
  await installValidationHooks(box.root);
  const body = await fs.readFile(path.join(box.root, ".git/hooks/post-commit"), "utf-8");
  t.check(
    [
      body.includes("# >>> beebox url-check (managed) >>>"),
      body.includes("validate --urls --urls-since HEAD~1"),
      (await fs.stat(path.join(box.root, ".git/hooks/post-commit"))).mode & 0o111 ? true : false,
    ],
    [
    true,
    true,
    true,
  ],
  );
});

// ## Post-commit — coexists with a foreign hook (git-lfs)
//
// A pre-existing post-commit (e.g. git-lfs) is preserved verbatim; our block is
// appended after it. A second install is idempotent — the foreign hook stays and
// nothing changes:
void test("A pre-existing post-commit (e.g.", async (t) => {
  // doctest:L476
  const box = await makeBox();
  const postPath = path.join(box.root, ".git/hooks/post-commit");
  const lfs = "#!/bin/sh\ngit lfs post-commit \"$@\"\n";
  await fs.writeFile(postPath, lfs);

  // doctest:L481
  await installValidationHooks(box.root);
  const merged = await fs.readFile(postPath, "utf-8");
  t.check([merged.startsWith(lfs), merged.includes("beebox url-check (managed)")], [
    true,
    true,
  ]);

  // doctest:L491
  const again = await installValidationHooks(box.root);
  t.check([again.includes(".git/hooks/post-commit"), (await fs.readFile(postPath, "utf-8")) === merged], [
    false,
    true,
  ]);
});

// ## Validation-ignore scaffold — seed file + operator guardrail rule
//
// `installValidationHooks` also seeds the operator-owned `_config/bbx-validate.ignore`
// (a commented template — no active entries, since the builtin skips already cover
// bbx's generated docs) and installs a path-conditional `.claude/rules/` rule that
// fires only when an agent opens that file, warning it off. The seed is commented
// out; the rule is scoped to the ignore file's path:
void test("installValidationHooks also seeds the operator-owned config/bbx-validate.igno...", async (t) => {
  // doctest:L508
  const box = await makeBox();
  await installValidationHooks(box.root);

  // doctest:L511
  const seed = await fs.readFile(path.join(box.root, "_config/bbx-validate.ignore"), "utf-8");
  await t.checkText(
    // Every non-blank line is a comment — nothing is actively ignored out of the box.
    seed.split("\n").filter((l) => l.trim() !== "").every((l) => l.trimStart().startsWith("#")),
    "true",
  );

  // doctest:L518
  const rule = await fs.readFile(path.join(box.root, ".claude/rules/bbx-validate-ignore.md"), "utf-8");
  await t.checkText(
    // path-conditional scope
    rule.includes("- \"_config/bbx-validate.ignore\""),
    "true",
  );

  // An operator's edits to the ignore file are never clobbered — the seed is written
  // only when the file is absent, so a second install (or a deploy-sync) leaves a
  // customized file untouched:

  // doctest:L529
  await fs.writeFile(path.join(box.root, "_config/bbx-validate.ignore"), "vendor/**\n");
  const again = await installValidationHooks(box.root);
  await t.checkText(again.includes("_config/bbx-validate.ignore"), "false");

  // doctest:L536
  t.check((await fs.readFile(path.join(box.root, "_config/bbx-validate.ignore"), "utf-8")).trim(), "vendor/**");
});
