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
 * Together: write-time warns, commit-time blocks. Idempotent — only
 * rewrites when content differs.
 *
 * Deliberately not routed through `installTemplateFile`: the settings
 * file needs JSON merge semantics (preserve unrelated keys, dedupe a
 * specific PostToolUse entry), and the pre-commit hook lives outside
 * the tracked tree (under `.git/`) and uses a marker comment rather
 * than a hash to distinguish ours-vs-user's. Neither fits the
 * overwrite-or-park-the-whole-file shape that helper is built for.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { PACKAGE_ROOT } from "../lib/package-root.js";

/**
 * Resolve `bin/cb` in the callback-box checkout that's running this code.
 * Embedding the absolute path in the hooks means they don't depend on the
 * user's PATH — the hook always invokes the same `cb` that installed it.
 */
function resolveCbBin(): string {
  return path.join(PACKAGE_ROOT, "bin", "cb");
}

const SETTINGS_PATH = ".claude/settings.json";
const PRE_COMMIT_PATH = ".git/hooks/pre-commit";

/**
 * Marker comment so we recognize a hook we wrote vs one a user installed.
 * If a foreign pre-commit hook exists we leave it alone.
 */
const PRE_COMMIT_MARKER = "# callback-box validation hook (managed)";

function preCommitBody(cbBin: string): string {
  return `#!/usr/bin/env bash
${PRE_COMMIT_MARKER}
# Block commits that include cards failing schema validation, and verify the
# attachment/asset manifest is intact (read-only scan, no auto-claim).
# Regenerate via \`cb init\` if you delete this file.

set -e

CB=${JSON.stringify(cbBin)}
if [ ! -x "$CB" ]; then
  if command -v cb >/dev/null 2>&1; then
    CB="cb"
  else
    echo "pre-commit: cb not found at $CB and not on PATH; skipping card validation" >&2
    exit 0
  fi
fi

# Validate staged cards only when there are any.
staged_cards=$(git diff --cached --name-only --diff-filter=ACMR | grep '\\.card$' || true)
if [ -n "$staged_cards" ]; then
  "$CB" validate --staged
fi

# Verify the asset manifest on every commit (read-only; fails on error).
"$CB" attachments verify
`;
}

interface SettingsShape {
  hooks?: {
    PostToolUse?: Array<{
      matcher?: string;
      hooks?: Array<{ type: string; command: string }>;
    }>;
  };
  [k: string]: unknown;
}

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
    return JSON.parse(text) as SettingsShape;
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return {};
    throw e;
  }
}

/**
 * Install both hooks. Returns the list of files that changed (relative to
 * boxRoot) so callers can decide whether to commit / report.
 */
export async function installValidationHooks(boxRoot: string): Promise<string[]> {
  const changed: string[] = [];
  const cbBin = resolveCbBin();
  const writeCommand = postToolUseCommand(cbBin);
  const hookBody = preCommitBody(cbBin);

  // .claude/settings.json
  const settingsAbs = path.join(boxRoot, SETTINGS_PATH);
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
  // future `git init`.
  let isRepo = false;
  try {
    isRepo = (await fs.stat(path.join(boxRoot, ".git"))).isDirectory();
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code !== "ENOENT") throw e;
  }

  if (isRepo) {
    const hookAbs = path.join(boxRoot, PRE_COMMIT_PATH);
    let existing: string | null = null;
    try {
      existing = await fs.readFile(hookAbs, "utf-8");
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code !== "ENOENT") throw e;
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
  }

  return changed;
}
