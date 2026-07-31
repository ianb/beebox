/**
 * Install the per-box validation hooks:
 *
 *  1. `.claude/settings.json` — PostToolUse hook that runs `cb validate`
 *     on any `.card` file the agent writes or edits. Hook output goes to
 *     the agent (warnings are visible; they don't block the tool call).
 *
 *  2. `.git/hooks/pre-commit` — runs `cb validate --staged` and exits
 *     non-zero if any staged card fails validation. Blocks the commit.
 *
 *  3. `.git/hooks/post-commit` — a marker-delimited managed block that
 *     fires `cb validate --urls --urls-since HEAD~1` in the background.
 *     External-URL checking is network-dependent, so it must never sit in
 *     the commit's critical path; detection of new URLs is offline, the
 *     HEADing runs detached. The block coexists with a foreign post-commit
 *     hook (e.g. git-lfs) — we splice our block in, leaving the rest intact.
 *
 * Together: write-time warns, commit-time blocks, post-commit checks URLs
 * without blocking. Idempotent — only rewrites when content differs.
 *
 * Deliberately not routed through `installTemplateFile`: the settings
 * file needs JSON merge semantics (preserve unrelated keys, dedupe a
 * specific PostToolUse entry), and the pre-commit hook lives outside
 * the tracked tree (under `.git/`) and uses a marker comment rather
 * than a hash to distinguish ours-vs-user's. Neither fits the
 * overwrite-or-park-the-whole-file shape that helper is built for.
 *
 * **The v2 git-hooks trap** (see "THE TRAP" in
 * `docs/implemented-plans/boxes-as-packages-v2.md`, Track B): for a shapeVersion 2 box,
 * `.git` sits at the package root, not at `boxRoot` (`content/`). Git always
 * invokes hooks with cwd = the repository's top level regardless of where
 * `git commit` was run from — i.e. the PACKAGE root, not `content/` — so
 * `requireBoxRoot()` (which walks UP from cwd) would never find
 * `content/.cb-box`. Both hook bodies below `cd` into the box root (a plain
 * relative path from the package root — safe, since that cwd guarantee is
 * unconditional) before invoking `cb`, so `requireBoxRoot()` resolves
 * correctly and `git diff --cached --name-only --relative` (see
 * `listStagedCards`/`listStagedMarkdown` in `../cli/commands/validate*.ts`)
 * reports box-relative paths instead of package-root-relative ones. `.claude/
 * settings.json`'s PostToolUse hook needs no such fix — Claude Code invokes
 * it with cwd = the operating agent's own cwd (`content/` or a subdirectory),
 * which already resolves correctly.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFileSync, type ExecFileSyncOptionsWithStringEncoding } from "node:child_process";
import { z } from "zod";
import { PACKAGE_ROOT } from "../lib/package-root.js";
import { getBoxShape } from "../lib/box-shape.js";
import { VALIDATION_IGNORE_PATH } from "./validation-ignore.js";
import { errnoCode } from "../lib/error-guards.js";

/**
 * Resolve `bin/cb` to embed in a box's git hooks. Embedding an absolute path
 * means the hooks don't depend on the user's PATH.
 *
 * The catch: boxes live OUTSIDE the monorepo, so the embedded path is their only
 * link back to a `cb`, and whichever checkout last ran `cb` on the box stamps it.
 * A git *worktree*'s checkout (`~/src/callback-worktrees/<name>/callback-box`) is
 * ephemeral — deleted on session exit — so stamping it leaves the hook pointing
 * at a vanished `cb` that then silently skips validation. So when we're running
 * inside a worktree, resolve to the stable **main checkout**'s `cb` (via the
 * shared git dir) instead of the worktree's. Degrades to the local path when git
 * isn't available (e.g. the server's rsynced, `.git`-less deploy tree).
 *
 * `CB_HOOK_BIN` overrides all of the above with an explicit absolute path.
 * For doctests/smoke scripts driving a full `cb init` end-to-end (installing
 * AND immediately exercising a real, executable hook) against a worktree
 * checkout: the worktree-routing logic above would otherwise stamp the
 * MAIN checkout's `cb`, which can lag behind whatever the worktree is
 * actively developing (e.g. box-package-layout support genuinely absent
 * from `main` mid-plan) — pinning the override to the worktree's own
 * freshly-built `bin/cb` avoids exercising a stale, incompatible binary.
 */
function resolveCbBin(): string {
  const override = process.env["CB_HOOK_BIN"];
  if (override) return override;
  const local = path.join(PACKAGE_ROOT, "bin", "cb");
  try {
    // stdio: pipe the failure-case stderr instead of letting execFileSync's
    // default inherit it straight to our own stderr — a released package
    // (no shipped `.git`) hits this catch on every `cb init`/hook install,
    // and "not a git repository" leaking out unprompted for something we
    // already handle gracefully is exactly the noise the monorepo's "quiet
    // on success" rule bans.
    const opts = {
      cwd: PACKAGE_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    } satisfies ExecFileSyncOptionsWithStringEncoding;
    const top = execFileSync("git", ["rev-parse", "--show-toplevel"], opts).trim();
    const commonDir = execFileSync(
      "git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], opts,
    ).trim();
    const mainTop = path.dirname(commonDir); // main worktree root (== `top` unless we're in a linked worktree)
    if (top !== "" && mainTop !== "" && mainTop !== top) {
      // In a linked worktree — rebase PACKAGE_ROOT's repo-relative path onto the main checkout.
      return path.join(mainTop, path.relative(top, PACKAGE_ROOT), "bin", "cb");
    }
  } catch (_e) {
    // Not a git repo / git missing — the local checkout path is the best we have.
  }
  return local;
}

const SETTINGS_PATH = ".claude/settings.json";
const PRE_COMMIT_PATH = ".git/hooks/pre-commit";
const POST_COMMIT_PATH = ".git/hooks/post-commit";

// Path-conditional rule warning an agent off the operator-owned ignore file.
// Scoped to the ignore file's path so it stays out of general agent context and
// only fires when an agent actually opens the file (Claude Code's `paths:`
// frontmatter — the same mechanism the generated card rules use).
const IGNORE_RULE_PATH = ".claude/rules/cb-validate-ignore.md";

/**
 * `paths:` frontmatter is resolved by Claude Code relative to the project
 * root — the package root, where `.claude/rules/` lives. That's the same as
 * `VALIDATION_IGNORE_PATH` for a legacy box, but a v2 box's ignore file is
 * operational data under `boxRoot` (`content/`), so the caller passes the
 * package-root-relative glob (`ignoreGlob`) while the prose keeps the plain
 * `VALIDATION_IGNORE_PATH` — the name an agent working from `content/` (its
 * own cwd) actually sees.
 */
function ignoreRuleBody(ignoreGlob: string): string {
  return `---
paths:
  - "${ignoreGlob}"
---

# ${VALIDATION_IGNORE_PATH} — operator-owned. Do NOT edit.

This file controls what \`cb validate\` skips. It belongs to the boxholder, not
to agents.

**Never add an entry here to silence a validation error.** If \`cb validate\`
flags something — a broken link, a malformed card, bad markdown — fix the
flagged content. Making the validator ignore the file is not a fix; it hides a
real problem.

Only the boxholder edits this list. If you genuinely believe something is being
validated that should not be, stop and ask the boxholder — do not edit this file
yourself.
`;
}

// Seeded ignore file: an all-commented template so the human discovers it under
// config/. The builtin skips already cover cb's generated docs, so a fresh box
// needs no active entries. Seeded only when absent — never overwrites operator
// edits. Kept intentionally undocumented in agent-facing surfaces.
const IGNORE_SEED_BODY = `# cb validate ignore — operator-owned. Gitignore-style patterns for paths
# that \`cb validate\` should skip (broken-link and markdown checks). One
# pattern per line, box-root-relative, '#' for comments.
#
# This is the boxholder's file. It exists so YOU (the human) can exclude
# box-specific trees that carry illustrative or intentionally-unresolved links
# — e.g. a vendored doc set or imported data. cb already skips its own
# generated docs (docs/generated/) everywhere, so most boxes need nothing here.
#
# Examples (uncomment / adapt as needed):
#
#   vendor/**
#   store/imported/**/*.md
`;

/** Delimiters for the post-commit block we own, so we can splice it in/out of a
 * file that may also carry a foreign hook (git-lfs installs one here). */
const URLCHECK_BEGIN = "# >>> callback-box url-check (managed) >>>";
const URLCHECK_END = "# <<< callback-box url-check (managed) <<<";

function postCommitBlock(cbBin: string, boxRelFromPackageRoot: string): string {
  // v2's git-hooks trap (see the module doc): this hook always runs with cwd
  // = the package root, so a v2 box needs an explicit `cd` into `content/`
  // before `.callback-box/url-check.log` and `cb`'s own `requireBoxRoot()`
  // resolve to the right place. A no-op line for a legacy box (cwd is
  // already the box root).
  const cd = boxRelFromPackageRoot === "" ? "" : `cd ${JSON.stringify(boxRelFromPackageRoot)}\n`;
  return [
    URLCHECK_BEGIN,
    "# Non-blocking external-URL check (see `cb validate --urls`): HEADs only the",
    "# http(s) URLs new in this commit, detached in the background, so the commit",
    "# never waits on the network. Output → .callback-box/url-check.log.",
    "# Delete just this block to disable; `cb init` re-adds it.",
    `${cd}CB_URLCHECK=${JSON.stringify(cbBin)}`,
    "[ -x \"$CB_URLCHECK\" ] || CB_URLCHECK=$(command -v cb || true)",
    "if [ -n \"$CB_URLCHECK\" ] && git rev-parse --verify -q HEAD~1 >/dev/null 2>&1; then",
    "  ( \"$CB_URLCHECK\" validate --urls --urls-since HEAD~1 >.callback-box/url-check.log 2>&1 & ) || true",
    "fi",
    URLCHECK_END,
  ].join("\n");
}

/**
 * Splice our managed block into a post-commit hook: replace it in place if our
 * markers are already there, append it (preserving a foreign hook) otherwise,
 * or create the file with a shebang when none exists.
 */
function upsertPostCommitBlock(existing: string | null, block: string): string {
  if (existing === null) return `#!/usr/bin/env bash\n\n${block}\n`;
  const beginIdx = existing.indexOf(URLCHECK_BEGIN);
  const endIdx = existing.indexOf(URLCHECK_END);
  if (beginIdx !== -1 && endIdx !== -1) {
    return existing.slice(0, beginIdx) + block + existing.slice(endIdx + URLCHECK_END.length);
  }
  const sep = existing.endsWith("\n") ? "\n" : "\n\n";
  return `${existing}${sep}${block}\n`;
}

/**
 * Marker comment so we recognize a hook we wrote vs one a user installed.
 * If a foreign pre-commit hook exists we leave it alone.
 */
const PRE_COMMIT_MARKER = "# callback-box validation hook (managed)";

function preCommitBody(cbBin: string, boxRelFromPackageRoot: string): string {
  // v2's git-hooks trap (see the module doc): git always invokes this hook
  // with cwd = the package root, so a v2 box needs an explicit `cd` into
  // `content/` first — otherwise `requireBoxRoot()` never finds
  // `content/.cb-box` (it only walks UP from cwd). No-op for a legacy box.
  const cd = boxRelFromPackageRoot === "" ? "" : `cd ${JSON.stringify(boxRelFromPackageRoot)}\n`;
  return `#!/usr/bin/env bash
${PRE_COMMIT_MARKER}
# Block commits that include cards failing schema validation, and hand assets
# to git-annex before they can be committed as raw bytes.
# Regenerate via \`cb init\` if you delete this file.

set -e
${cd}

# git-annex FIRST, deliberately above the cb fallback below.
#
# \`git annex init\` declines to install its own pre-commit hook when one already
# exists (ours does), so this line is the only thing that runs annex at commit
# time. Placed below the \`cb\`-not-found \`exit 0\`, it would silently vanish on
# any machine where cb is not resolvable — exactly the under-provisioned machine
# most likely to also be missing git-annex, and the failure would be assets
# quietly entering git history as raw bytes.
if command -v git-annex >/dev/null 2>&1; then
  git annex pre-commit
else
  echo "pre-commit: git-annex is not installed; assets would be committed as raw bytes." >&2
  echo "  Install it (apt install git-annex / brew install git-annex) or run: cb doctor annex" >&2
  exit 1
fi

CB=${JSON.stringify(cbBin)}
if [ ! -x "$CB" ]; then
  if command -v cb >/dev/null 2>&1; then
    CB="cb"
  else
    echo "pre-commit: cb not found at $CB and not on PATH; skipping card validation" >&2
    exit 0
  fi
fi

# Validate staged cards/markdown only when there are any (blocks on errors).
staged=$(git diff --cached --name-only --diff-filter=ACMR | grep -E '\\.(card|md)$' || true)
if [ -n "$staged" ]; then
  "$CB" validate --staged
fi

# Box-wide broken-link scan: a move can break links in files that aren't
# staged (the referrers), which --staged never sees. Warn-only (always exits
# 0) so it never blocks — it surfaces dangling links to fix with cb mv.
"$CB" validate --links || true

# Large files in attach scopes whose extension git-annex is not configured to
# annex would be committed as raw bytes — the class of bug that put 41MB
# .frozen pages into box history. Blocks rather than advises.
"$CB" attachments check-unlisted
`;
}

// `.claude/settings.json` is a user-owned config file with many keys we
// don't model (permissions, other hook events, ...) — `.passthrough()` at
// every level preserves them verbatim through a read-modify-write cycle
// instead of silently dropping them, matching the old cast's zero-cost
// round-trip behavior while still validating the shape we actually touch.
const settingsHookSchema = z.object({
  type: z.string(),
  command: z.string(),
}).passthrough();

const settingsPostToolUseEntrySchema = z.object({
  matcher: z.string().optional(),
  hooks: z.array(settingsHookSchema).optional(),
}).passthrough();

const settingsShapeSchema = z.object({
  hooks: z.object({
    PostToolUse: z.array(settingsPostToolUseEntrySchema).optional(),
  }).passthrough().optional(),
}).passthrough();

type SettingsShape = z.infer<typeof settingsShapeSchema>;

const POST_TOOL_USE_MATCHER = "Edit|Write|MultiEdit";

function postToolUseCommand(cbBin: string): string {
  // Claude Code passes a JSON payload on stdin (tool_input.file_path). `cb
  // validate --hook` parses that itself, checks if the path is a card,
  // and either exits 0 silently or exits 2 with the validation error on
  // stderr (which Claude Code surfaces to the agent as feedback).
  return `${JSON.stringify(cbBin)} validate --hook`;
}

// True if the command looks like a previously-installed cb validation hook
// (regardless of which cb path it points at, including the legacy
// `validate "$f"` form). We want to replace these so a monorepo migration
// or a switch to a different worktree's cb cleanly updates the embedded
// absolute path instead of appending a parallel hook that still runs the
// old cb.
function isManagedValidationHook(command: string): boolean {
  return (
    /\bvalidate\s+--hook\b/.test(command) ||
    command.includes('validate "$f"')
  );
}

function ensurePostToolUseEntry(settings: SettingsShape, command: string): boolean {
  const hooks = settings.hooks ?? (settings.hooks = {});
  const entries = hooks.PostToolUse ?? (hooks.PostToolUse = []);

  let changed = false;
  for (const entry of entries) {
    if (entry.matcher !== POST_TOOL_USE_MATCHER) continue;
    const original = entry.hooks ?? [];
    // Strip any existing managed validation hooks; we'll add the current one back.
    const filtered = original.filter((h) => !isManagedValidationHook(h.command));
    if (filtered.length !== original.length) changed = true;
    entry.hooks = [...filtered, { type: "command", command }];
    if (filtered.length !== original.length || !original.some((h) => h.command === command)) {
      changed = true;
    }
    return changed;
  }

  entries.push({
    matcher: POST_TOOL_USE_MATCHER,
    hooks: [{ type: "command", command }],
  });
  return true;
}

async function readJsonIfExists(filePath: string): Promise<SettingsShape> {
  try {
    const text = await fs.readFile(filePath, "utf-8");
    if (text.trim() === "") return {};
    return settingsShapeSchema.parse(JSON.parse(text));
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return {};
    throw e;
  }
}

/**
 * Seed the operator-owned `config/cb-validate.ignore` (commented template, only
 * if absent — never clobbering operator edits) and (over)write the
 * path-conditional rule that warns agents off it. `boxRoot`/`packageRoot`
 * differ for a v2 box (`.claude/` lives at the package root, but the ignore
 * file itself is operational data under `boxRoot`), so the rule's `paths:`
 * glob is expressed relative to `packageRoot` (where `.claude/rules/` lives,
 * and therefore where Claude Code resolves the glob from) — `boxRelFromPackageRoot`
 * prefixes it when the two roots differ. Returns the changed paths (relative
 * to `packageRoot`).
 */
async function installIgnoreScaffold(
  { boxRoot, packageRoot, boxRelFromPackageRoot }: { boxRoot: string; packageRoot: string; boxRelFromPackageRoot: string }
): Promise<string[]> {
  const changed: string[] = [];

  const seedAbs = path.join(boxRoot, VALIDATION_IGNORE_PATH);
  let seedExists = true;
  try {
    await fs.stat(seedAbs);
  } catch (e) {
    if (errnoCode(e) !== "ENOENT") throw e;
    seedExists = false;
  }
  if (!seedExists) {
    await fs.mkdir(path.dirname(seedAbs), { recursive: true });
    await fs.writeFile(seedAbs, IGNORE_SEED_BODY);
    changed.push(path.relative(packageRoot, seedAbs));
  }

  const ignoreGlob = boxRelFromPackageRoot === ""
    ? VALIDATION_IGNORE_PATH
    : `${boxRelFromPackageRoot}/${VALIDATION_IGNORE_PATH}`;
  const ruleBody = ignoreRuleBody(ignoreGlob);
  const ruleAbs = path.join(packageRoot, IGNORE_RULE_PATH);
  let ruleExisting: string | null = null;
  try {
    ruleExisting = await fs.readFile(ruleAbs, "utf-8");
  } catch (e) {
    if (errnoCode(e) !== "ENOENT") throw e;
  }
  if (ruleExisting !== ruleBody) {
    await fs.mkdir(path.dirname(ruleAbs), { recursive: true });
    await fs.writeFile(ruleAbs, ruleBody);
    changed.push(IGNORE_RULE_PATH);
  }

  return changed;
}

/**
 * Install both hooks. Returns the list of files that changed (relative to
 * the box's package root — where `.claude/` and `.git/` live) so callers
 * can decide whether to commit / report.
 */
export async function installValidationHooks(boxRoot: string): Promise<string[]> {
  const { packageRoot } = await getBoxShape(boxRoot);
  const boxRelFromPackageRoot = path.relative(packageRoot, boxRoot);

  const changed: string[] = [
    ...(await installIgnoreScaffold({ boxRoot, packageRoot, boxRelFromPackageRoot })),
  ];
  const cbBin = resolveCbBin();
  const writeCommand = postToolUseCommand(cbBin);
  const hookBody = preCommitBody(cbBin, boxRelFromPackageRoot);

  // .claude/settings.json — lives at the package root (see the module doc's
  // v2 git-hooks note; unlike the git hooks, this one needs no `cd` baked in
  // because Claude Code invokes it with cwd = the operating agent's own cwd).
  const settingsAbs = path.join(packageRoot, SETTINGS_PATH);
  const settings = await readJsonIfExists(settingsAbs);
  const settingsBefore = JSON.stringify(settings, null, 2) + "\n";
  ensurePostToolUseEntry(settings, writeCommand);
  const settingsAfter = JSON.stringify(settings, null, 2) + "\n";
  if (settingsAfter !== settingsBefore) {
    await fs.mkdir(path.dirname(settingsAbs), { recursive: true });
    await fs.writeFile(settingsAbs, settingsAfter);
    changed.push(SETTINGS_PATH);
  }

  // .git/hooks/pre-commit — only when the box is actually a git repo.
  // Writing into a non-repo would create a `.git/hooks/` from scratch
  // that never fires (no git, no commits) and would silently shadow a
  // future `git init`. `.git` sits at the package root for both shapes.
  let isRepo = false;
  try {
    isRepo = (await fs.stat(path.join(packageRoot, ".git"))).isDirectory();
  } catch (e) {
    if (errnoCode(e) !== "ENOENT") throw e;
  }

  if (isRepo) {
    const hookAbs = path.join(packageRoot, PRE_COMMIT_PATH);
    let existing: string | null = null;
    try {
      existing = await fs.readFile(hookAbs, "utf-8");
    } catch (e) {
      if (errnoCode(e) !== "ENOENT") throw e;
    }

    const isManaged = existing !== null && existing.includes(PRE_COMMIT_MARKER);
    const foreignHook = existing !== null && !isManaged;
    if (foreignHook) {
      console.warn(
        `[install-validation-hooks] ${PRE_COMMIT_PATH} exists and isn't ours — leaving it alone. Add the contents of cb's hook manually if you want card validation.`
      );
    } else if (existing !== hookBody) {
      await fs.mkdir(path.dirname(hookAbs), { recursive: true });
      await fs.writeFile(hookAbs, hookBody);
      await fs.chmod(hookAbs, 0o755);
      changed.push(PRE_COMMIT_PATH);
    }

    // .git/hooks/post-commit — splice our managed url-check block in, preserving
    // any foreign hook (git-lfs installs one here).
    const postAbs = path.join(packageRoot, POST_COMMIT_PATH);
    let postExisting: string | null = null;
    try {
      postExisting = await fs.readFile(postAbs, "utf-8");
    } catch (e) {
      if (errnoCode(e) !== "ENOENT") throw e;
    }
    const postMerged = upsertPostCommitBlock(postExisting, postCommitBlock(cbBin, boxRelFromPackageRoot));
    if (postMerged !== postExisting) {
      await fs.mkdir(path.dirname(postAbs), { recursive: true });
      await fs.writeFile(postAbs, postMerged);
      await fs.chmod(postAbs, 0o755);
      changed.push(POST_COMMIT_PATH);
    }
  }

  return changed;
}
