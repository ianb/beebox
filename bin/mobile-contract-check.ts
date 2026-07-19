#!/usr/bin/env node --import tsx
/**
 * Mobile-contract tripwire (`pnpm mobile-contract-check`). One script, two modes,
 * driven by the two git hooks that together enforce the sync rule from
 * `callback-box/docs/mobile-contract.md` (mechanism 5 of
 * `callback-box/docs/implemented-plans/mobile-parity-sync.md`):
 *
 *   pre-commit  (default mode)   — reads the staged file list and the anchor
 *     manifest (the ```anchors block in the contract doc). If a staged file
 *     matches an anchor (exact or directory-prefix) while the contract doc
 *     itself is NOT staged, that is a pending violation: it is recorded to a
 *     per-worktree state file and the commit is ALLOWED to proceed to the
 *     message step (a pre-commit hook cannot read the not-yet-written commit
 *     message, so it cannot honor the override trailer — the block lives in
 *     commit-msg). If the doc IS staged, or no anchor is touched, any stale
 *     state file is cleared and the commit passes silently.
 *
 *   --commit-msg <file>          — the blocker. If a violation is pending (state
 *     file present), the commit passes ONLY if the message carries a
 *     `Contract-Unchanged: <reason>` trailer; otherwise it is blocked with a
 *     message naming the touched anchors and the two ways out. A satisfied or
 *     absent violation clears the state file.
 *
 * Fail-closed: a missing or unparseable manifest aborts the commit loudly —
 * we cannot know whether a staged file is an anchor, so we refuse to guess.
 *
 * Runs on EVERY commit repo-wide, so it stays fast: plain git + fs, no heavy
 * imports. Background: `callback-box/docs/implemented-plans/mobile-parity-sync.md`.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// The contract doc that a contract-surface change must co-stage, repo-relative.
const CONTRACT_DOC = "callback-box/docs/mobile-contract.md";
// Basename of the per-worktree state file inside the git dir. `git rev-parse
// --git-path` resolves it correctly whether in the main checkout or a worktree,
// and pre-commit + commit-msg for one commit share the same git dir.
const STATE_FILE_NAME = "mobile-contract-pending";
// The trailer that overrides a pending violation for a genuine non-wire change.
const TRAILER_KEY = "Contract-Unchanged";

class ManifestError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ManifestError";
  }
}

/**
 * Extract the anchor list from the contract doc's ```anchors fenced block.
 * Blank lines and `#` comments are skipped. Throws `ManifestError` if the
 * block is missing or empty (fail-closed).
 */
export function parseManifest(docText: string): string[] {
  const lines = docText.split("\n");
  const open = lines.findIndex((line) => line.trim() === "```anchors");
  if (open === -1) {
    throw new ManifestError("no ```anchors block found in the contract doc");
  }
  const anchors: string[] = [];
  for (let i = open + 1; i < lines.length; i++) {
    const raw = lines[i];
    if (raw === undefined) break;
    const line = raw.trim();
    if (line === "```") {
      if (anchors.length === 0) {
        throw new ManifestError("```anchors block is empty");
      }
      return anchors;
    }
    if (line === "" || line.startsWith("#")) continue;
    anchors.push(line);
  }
  throw new ManifestError("unterminated ```anchors block in the contract doc");
}

/** True if a staged path matches an anchor: exact, or under a `dir/` prefix. */
export function matchesAnchor(stagedPath: string, anchor: string): boolean {
  if (anchor.endsWith("/")) return stagedPath.startsWith(anchor);
  return stagedPath === anchor;
}

/** The staged files that touch a contract-surface anchor. */
export function touchedAnchors(stagedPaths: string[], anchors: string[]): string[] {
  return stagedPaths.filter((p) => anchors.some((a) => matchesAnchor(p, a)));
}

/**
 * True if the commit message carries a non-empty `Contract-Unchanged:` trailer.
 * Comment lines (git strips `#`-leading lines) do not count.
 */
export function hasContractUnchangedTrailer(message: string): boolean {
  const pattern = new RegExp(`^${TRAILER_KEY}:\\s*(\\S.*)$`);
  return message.split("\n").some((line) => {
    if (line.startsWith("#")) return false;
    return pattern.test(line.trim());
  });
}

function gitPath(repoRoot: string, relative: string): string {
  const out = execFileSync("git", ["rev-parse", "--git-path", relative], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
  // `--git-path` may return a path relative to the repo root; normalize.
  return out.startsWith("/") ? out : join(repoRoot, out);
}

function repoRoot(): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
}

function stagedFiles(root: string): string[] {
  // No --diff-filter: deletions count too (removing an anchor is a contract change).
  const out = execFileSync("git", ["diff", "--cached", "--name-only"], {
    cwd: root,
    encoding: "utf8",
  });
  return out.split("\n").filter((line) => line !== "");
}

function loadAnchors(root: string): string[] {
  const docPath = join(root, CONTRACT_DOC);
  if (!existsSync(docPath)) {
    throw new ManifestError(`contract doc missing at ${CONTRACT_DOC}`);
  }
  return parseManifest(readFileSync(docPath, "utf8"));
}

function clearState(statePath: string): void {
  rmSync(statePath, { force: true });
}

/** pre-commit mode: record a pending violation or clear stale state; never blocks. */
function runPreCommit(root: string, statePath: string): void {
  const staged = stagedFiles(root);
  const anchors = loadAnchors(root);
  const touched = touchedAnchors(staged, anchors);
  const docStaged = staged.includes(CONTRACT_DOC);

  if (touched.length === 0 || docStaged) {
    clearState(statePath);
    return;
  }
  // A contract-surface change without a doc update: defer the block to
  // commit-msg (it can read the override trailer; pre-commit cannot).
  writeFileSync(statePath, `${touched.join("\n")}\n`);
}

/** commit-msg mode: block a pending violation unless the trailer overrides it. */
function runCommitMsg(statePath: string, messageFile: string): void {
  if (!existsSync(statePath)) return; // no pending violation
  const touched = readFileSync(statePath, "utf8").split("\n").filter((l) => l !== "");
  const message = readFileSync(messageFile, "utf8");

  if (hasContractUnchangedTrailer(message)) {
    console.error(
      `mobile-contract: ${TRAILER_KEY} trailer accepted for ${touched.length} touched anchor(s) — contract doc left unchanged by attestation.`,
    );
    clearState(statePath);
    return;
  }

  console.error("mobile-contract tripwire: contract-surface files staged without a contract-doc update.");
  console.error("Touched anchors:");
  for (const p of touched) console.error(`  ${p}`);
  console.error("");
  console.error("Two ways forward:");
  console.error(`  1. Stage an update to ${CONTRACT_DOC} reflecting the change, then re-commit.`);
  console.error(
    `  2. If this genuinely does not alter the wire surface (refactor, comment, test scaffold),`,
  );
  console.error(
    `     re-run the commit with a trailer, e.g.:  git commit --trailer "${TRAILER_KEY}: <reason>"`,
  );
  // Keep the state file: the next attempt re-derives it (or clears it once the
  // doc is staged), so a re-commit with the trailer is honored.
  process.exit(1);
}

function main(): void {
  const args = process.argv.slice(2);
  const root = repoRoot();
  const statePath = gitPath(root, STATE_FILE_NAME);

  try {
    if (args[0] === "--commit-msg") {
      const messageFile = args[1];
      if (messageFile === undefined) {
        console.error("mobile-contract-check: --commit-msg requires a message-file path");
        process.exit(1);
      }
      runCommitMsg(statePath, messageFile);
    } else {
      runPreCommit(root, statePath);
    }
  } catch (e) {
    if (e instanceof ManifestError) {
      console.error(`mobile-contract-check failed (fail-closed): ${e.message}`);
      console.error(`Fix the anchors fenced block in ${CONTRACT_DOC}, then retry.`);
      process.exit(1);
    }
    throw e;
  }
}

// Run only as a script, not when imported by a test.
if (process.argv[1] !== undefined && process.argv[1].endsWith("mobile-contract-check.ts")) {
  main();
}
