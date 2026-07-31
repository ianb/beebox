/**
 * `cb doctor annex` — is git-annex set up correctly in this repository?
 *
 * **Repair by default.** Most of what can be wrong here is something the box
 * can simply put right, so reporting it to a human who then runs the obvious
 * command is a wasted round trip. The doctor fixes what it can, logs each
 * repair, and reports only what it cannot fix. `check: true` is the read-only
 * mode for scripts and health endpoints.
 *
 * **It does not gate `cb serve`.** An earlier design refused to start a box
 * that failed any check. That was wrong twice over: five of the seven checks
 * self-heal, so blocking on them refuses work the box could have just done;
 * and the two that cannot self-heal are the two where blocking helps least —
 * a missing binary already fails loudly at every read (the pointer predicate)
 * and every commit (the pre-commit hook), and a pointer with no content is
 * data already lost, where an outage only compounds it.
 *
 * **Configuration only.** Every check asks "is git-annex set up correctly",
 * and every one has a fixed remedy. Conditions that vary with pending work —
 * how far behind capture triage is, say — are operational, and belong in
 * `runHealthChecks` where they can be a warning rather than a defect. Adding a
 * content-dependent check here would also have re-created the startup-gate
 * problem the first time someone re-gated on this list.
 */

import * as fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import * as path from "node:path";
import type { GitAnnexService } from "../../services/git-annex.js";
import { assetLargefilesExpression } from "../../lib/asset-extensions.js";
import { isAnnexPointer } from "../../lib/annex-pointer.js";
import { findAttachScopes } from "../../lib/attach-scopes.js";
import { errnoCode } from "../../lib/error-guards.js";

/** What a single check concluded. */
export type AnnexCheckStatus =
  /** Was already correct. */
  | "ok"
  /** Was wrong and the doctor fixed it. */
  | "repaired"
  /** Is wrong and the doctor cannot fix it. */
  | "failed";

export interface AnnexCheckResult {
  /** Stable identifier, for tests and health-check wiring. */
  id: string;
  status: AnnexCheckStatus;
  /** Human- and agent-facing sentence. Names the remedy when status is "failed". */
  message: string;
}

export interface AnnexDoctorResult {
  checks: AnnexCheckResult[];
  /** True when no check failed. Repairs do not count as failures. */
  healthy: boolean;
}

export interface AnnexDoctorOptions {
  /** Read-only: report what is wrong without repairing it. */
  check?: boolean;
  /** Repository description used when initializing. Defaults to the directory name. */
  description?: string;
}

/**
 * The `git annex pre-commit` invocation the generated hook must contain. Kept
 * here rather than in the hook generator so the doctor and the generator agree
 * by construction — the whole point of check 7 is catching a repository whose
 * hook we do not own, and a drifted literal would make it useless.
 */
export const ANNEX_PRECOMMIT_LINE = "git annex pre-commit";

/**
 * Does the hook actually RUN annex, as opposed to merely mentioning it?
 *
 * A substring test passes on `# TODO: add git annex pre-commit` and on the real
 * command commented out — both of which mean annex never runs at commit time,
 * which is exactly what this check exists to catch. So: the line must be
 * uncommented.
 */
function invokesAnnexPreCommit(hook: string): boolean {
  return hook
    .split("\n")
    .some((line) => !line.trimStart().startsWith("#") && line.includes(ANNEX_PRECOMMIT_LINE));
}

async function readHook(repoRoot: string): Promise<string | null> {
  try {
    return await fs.readFile(path.join(repoRoot, ".git", "hooks", "pre-commit"), "utf-8");
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return null;
    throw e;
  }
}

/**
 * Find working-tree files that hold an annex pointer instead of content.
 *
 * In this iteration there is nowhere to fetch from — `numcopies` is 1 and the
 * box is the authoritative copy — so a pointer here means the bytes are gone.
 * That is an alarm, not a repair. (With a remote configured this becomes
 * self-healing via `git annex get`, which is why the check is written to
 * report a list rather than a boolean.)
 */
async function findContentlessPointers(boxRoot: string): Promise<string[]> {
  const out: string[] = [];
  for (const scope of await findAttachScopes(boxRoot)) {
    await walkForPointers({ absDir: scope.absPath, relPrefix: scope.relPath, out });
  }
  return out;
}

/**
 * Walk a scope INCLUDING plain subdirectories — an email's `attachments/`
 * folder holds real assets, and a direct-children-only scan would report "no
 * missing content" while exactly those files were absent. Nested `.attach/`
 * dirs are their own scopes via `findAttachScopes`.
 */
async function walkForPointers(args: {
  absDir: string;
  relPrefix: string;
  out: string[];
}): Promise<void> {
  const { absDir, relPrefix, out } = args;
  let entries: Dirent[];
  try {
    entries = await fs.readdir(absDir, { withFileTypes: true });
  } catch (e) {
    if (errnoCode(e) !== "ENOENT") {
      console.warn(`Could not read ${relPrefix} while checking for pointers:`, e);
    }
    return;
  }
  for (const entry of entries) {
    const rel = `${relPrefix}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name.endsWith(".attach")) continue;
      await walkForPointers({ absDir: path.join(absDir, entry.name), relPrefix: rel, out });
      continue;
    }
    if (!entry.isFile()) continue;
    const abs = path.join(absDir, entry.name);
    try {
      const stat = await fs.stat(abs);
      if (stat.size > 1024) continue;
      if (isAnnexPointer(new Uint8Array(await fs.readFile(abs)))) out.push(rel);
    } catch (e) {
      if (errnoCode(e) !== "ENOENT") console.warn(`Could not inspect ${rel}:`, e);
    }
  }
}

/**
 * Run every check, repairing what can be repaired unless `check` is set.
 *
 * `repoRoot` is the git repository root (the package root for a v2 box);
 * `boxRoot` is the operational box directory whose attach scopes get walked.
 * They differ for package-shaped boxes, and passing one for the other yields a
 * doctor that silently inspects the wrong tree.
 */
export async function runAnnexDoctor(
  annex: GitAnnexService,
  args: { repoRoot: string; boxRoot: string; options?: AnnexDoctorOptions }
): Promise<AnnexDoctorResult> {
  const { repoRoot, boxRoot, options } = args;
  const readOnly = options?.check === true;
  const checks: AnnexCheckResult[] = [];

  // 1. Binary present. Nothing downstream is meaningful without it, so this
  //    short-circuits: running the rest would report a cascade of failures
  //    that all have the same single cause.
  const version = await annex.version();
  if (version === null) {
    checks.push({
      id: "binary",
      status: "failed",
      message:
        "git-annex is not installed. Assets will read as pointer text and commits will fail. " +
        "Install it (`apt install git-annex` / `brew install git-annex`).",
    });
    return { checks, healthy: false };
  }
  checks.push({ id: "binary", status: "ok", message: `git-annex ${version}` });

  // 2. Is this box on git-annex at all?
  //
  // A box that has not run `cb attachments to-annex` is still on the manifest
  // model, and that is a perfectly correct state — not a defect to repair. The
  // doctor must NOT initialize it: `git annex init` writes `* filter=annex`
  // into `.git/info/attributes`, the highest-precedence attributes file, which
  // immediately stops Git LFS from smudging anything in that repository. Every
  // unmigrated box uses LFS, so an auto-init here would half-break each one —
  // annexing nothing while making its LFS content unreachable.
  //
  // Migration is `cb attachments to-annex`'s job, which does these steps in an
  // order that keeps LFS working until it is deliberately retired. So: report
  // and stop.
  if (!(await annex.isInitialized(repoRoot))) {
    checks.push({
      id: "initialized",
      status: "ok",
      message:
        "not on git-annex yet (still the manifest model) — nothing to check. " +
        "Migrate with `cb attachments to-annex`.",
    });
    return { checks, healthy: true };
  }
  checks.push({ id: "initialized", status: "ok", message: "repository is annex-initialized" });

  // 3. annex.thin must be false. This is THE check that fires in practice:
  //    annex.thin is plain git config, so it does not propagate to clones and
  //    every fresh clone silently inherits git-annex's default.
  //
  //    Repairing it takes BOTH commands. Setting the config alone leaves
  //    existing files hardlinked to their annex objects — measured: link count
  //    stayed at 2, so an in-place edit still corrupts the object and `fsck`
  //    does not notice. `git annex fix` is what breaks the hardlinks.
  const thin = await annex.getGitConfig(repoRoot, "annex.thin");
  if (thin === "false") {
    checks.push({ id: "thin", status: "ok", message: "annex.thin is false" });
  } else if (readOnly) {
    checks.push({
      id: "thin",
      status: "failed",
      message:
        `annex.thin is ${thin ?? "unset"}; it must be false or fsck cannot detect in-place ` +
        "corruption. Run `git config annex.thin false && git annex fix`.",
    });
  } else {
    await annex.setGitConfig(repoRoot, { key: "annex.thin", value: "false" });
    await annex.fix(repoRoot);
    checks.push({
      id: "thin",
      status: "repaired",
      message: "set annex.thin=false and ran `git annex fix` to break existing hardlinks",
    });
  }

  // 4. annex.largefiles must match the asset classifier. A drifted expression
  //    is worse than an absent one — it silently annexes the wrong set.
  const expected = assetLargefilesExpression();
  const largefiles = await annex.getAnnexConfig(repoRoot, "annex.largefiles");
  if (largefiles === expected) {
    checks.push({ id: "largefiles", status: "ok", message: "annex.largefiles matches the asset classifier" });
  } else if (readOnly) {
    checks.push({
      id: "largefiles",
      status: "failed",
      message:
        `annex.largefiles is ${largefiles === null ? "unset" : "stale"}. ` +
        "Run `git annex config --set annex.largefiles \"$(cb attachments largefiles-expr)\"`.",
    });
  } else {
    await annex.setAnnexConfig(repoRoot, { key: "annex.largefiles", value: expected });
    checks.push({
      id: "largefiles",
      status: "repaired",
      message: largefiles === null ? "set annex.largefiles" : "refreshed a stale annex.largefiles",
    });
  }

  // 5. No pointer standing in for content. Not repairable this iteration.
  const pointers = await findContentlessPointers(boxRoot);
  if (pointers.length === 0) {
    checks.push({ id: "content-present", status: "ok", message: "no missing asset content" });
  } else {
    const sample = pointers.slice(0, 5).join(", ");
    const more = pointers.length > 5 ? ` (+${pointers.length - 5} more)` : "";
    checks.push({
      id: "content-present",
      status: "failed",
      message:
        `${pointers.length} asset(s) hold a pointer with no content: ${sample}${more}. ` +
        "With no remote configured there is nowhere to fetch from — restore from backup.",
    });
  }

  // 6. Journal flushed, so a clone can see location info and `git annex get`
  //    works. An unflushed journal is why a fresh clone reports "0 copies".
  if (await annex.hasUnflushedJournal(repoRoot)) {
    if (readOnly) {
      checks.push({
        id: "journal",
        status: "failed",
        message: "git-annex journal has unflushed entries; clones will not see them. Run `git annex merge`.",
      });
    } else {
      await annex.merge(repoRoot);
      checks.push({ id: "journal", status: "repaired", message: "flushed the git-annex journal" });
    }
  } else {
    checks.push({ id: "journal", status: "ok", message: "git-annex journal is flushed" });
  }

  // 7. The pre-commit hook actually invokes annex. `git annex init` declines
  //    to install its own hook when one already exists, and `cb init` leaves a
  //    foreign hook untouched — so integration cannot be inferred from either
  //    having run.
  const hook = await readHook(repoRoot);
  if (hook !== null && invokesAnnexPreCommit(hook)) {
    checks.push({ id: "hook", status: "ok", message: "pre-commit hook invokes git annex pre-commit" });
  } else {
    checks.push({
      id: "hook",
      status: "failed",
      message:
        hook === null
          ? "no pre-commit hook installed; run `cb init` so annex runs at commit time."
          : "the pre-commit hook does not invoke `git annex pre-commit`. If cb manages this hook, " +
            "`cb init` regenerates it; if it is hand-written, add the line yourself.",
    });
  }

  return { checks, healthy: checks.every((c) => c.status !== "failed") };
}

/** Render a doctor result for terminal output. */
export function formatAnnexDoctor(result: AnnexDoctorResult): string {
  const glyph: Record<AnnexCheckStatus, string> = { ok: "✓", repaired: "↻", failed: "✗" };
  return result.checks.map((c) => `${glyph[c.status]} ${c.id}: ${c.message}`).join("\n");
}
