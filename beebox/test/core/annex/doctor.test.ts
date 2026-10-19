// # `bbx doctor annex`
//
// Is git-annex set up correctly in this repository? See
// `src/core/annex/doctor/core.ts`.
//
// **Repair by default.** Most of what can be wrong is something the box can put
// right, so reporting it to a human who then runs the obvious command is a wasted
// round trip. `check: true` is the read-only mode.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { not } from "@ianbicking/tap-check/check";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import { createFakeGitAnnex } from "../../../src/services/git-annex.js";
import {
  runAnnexDoctor,
  formatAnnexDoctor,
  ANNEX_PRECOMMIT_LINE,
  ANNEX_SMUDGE_LINE,
  type AnnexCheckResult,
  type AnnexCheckStatus,
} from "../../../src/core/annex/doctor/core.js";
import { assetAnnexAttributes, assetLargefilesExpression } from "../../../src/lib/asset-extensions.js";
import { writeAnnexInfoAttributes } from "../../../src/core/annex/info-attributes.js";
import { UNIGNORE_BLOCK } from "../../../src/core/attachments-gitignore.js";
import { assetGitignorePatterns } from "../../../src/lib/asset-extensions.js";

/**
 * The RETIRED manifest-scheme asset block. Nothing writes it any more — a box
 * is annex-shaped from creation — but the doctor still has to REPORT a box
 * whose `.gitignore` was hand-edited back to hiding assets, so the tests below
 * put one there deliberately.
 */
const GITIGNORE_BLOCK = `# bbx-assets (managed by bbx attachments init-gitignore)
${assetGitignorePatterns()}
`;

/** A fake in the fully-correct state, which individual tests then break. */
function healthyFake() {
  return createFakeGitAnnex({
    gitConfig: { "annex.thin": "false" },
    annexConfig: { "annex.largefiles": assetLargefilesExpression() },
  });
}

async function installSmudgeHooks(box: { root: string }): Promise<void> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const dir = path.join(box.root, ".git", "hooks");
  await fs.mkdir(dir, { recursive: true });
  const hook = `#!/bin/sh\n${ANNEX_SMUDGE_LINE}\n`;
  await Promise.all([
    fs.writeFile(path.join(dir, "post-checkout"), hook),
    fs.writeFile(path.join(dir, "post-merge"), hook),
  ]);
  await Promise.all([
    fs.chmod(path.join(dir, "post-checkout"), 0o755),
    fs.chmod(path.join(dir, "post-merge"), 0o755),
  ]);
}

/** Write the annex hooks so hook checks pass. */
async function installHooks(box: { root: string }): Promise<void> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const dir = path.join(box.root, ".git", "hooks");
  await installSmudgeHooks(box);
  await fs.writeFile(path.join(dir, "pre-commit"), `#!/bin/bash\n${ANNEX_PRECOMMIT_LINE}\n`);
}

const OK_CHECKS: AnnexCheckResult[] = [
  { id: "binary", status: "ok", message: "git-annex 10.20260717" },
  { id: "initialized", status: "ok", message: "repository is annex-initialized" },
  { id: "gitignore-assets", status: "ok", message: ".gitignore leaves assets visible to git" },
  { id: "thin", status: "ok", message: "annex.thin is false" },
  { id: "largefiles", status: "ok", message: "annex.largefiles matches the asset classifier" },
  { id: "annexed-coverage", status: "ok", message: "all 0 annexed path(s) are covered by the asset extensions" },
  { id: "attributes", status: "ok", message: ".git/info/attributes is scoped to the asset extensions" },
  { id: "content-present", status: "ok", message: "no missing asset content" },
  { id: "journal", status: "ok", message: "git-annex journal is flushed" },
  { id: "smudge-hooks", status: "ok", message: "post-checkout and post-merge hooks invoke git annex smudge --update" },
  { id: "hook", status: "ok", message: "pre-commit hook invokes git annex pre-commit" },
];

const GITIGNORE_FAILED = ".gitignore still ignores assets. Run `bbx attachments unignore` to complete the annex conversion; if it reports unmanaged rules, remove those rules from .gitignore by hand.";
const HOOK_FAILED = "the pre-commit hook does not invoke `git annex pre-commit`. If bbx manages this hook, `bbx engine init` regenerates it; if it is hand-written, add the line yourself.";

/** The doctor's full report: every check ok, except the listed `[status, message]` overrides. */
function report(healthy: boolean, overrides?: Record<string, [AnnexCheckStatus, string]>) {
  return {
    checks: OK_CHECKS.map((c) => {
      const [status, message] = overrides?.[c.id] ?? [c.status, c.message];
      return { id: c.id, status, message };
    }),
    healthy,
  };
}

// A correctly configured repository reports every check clean and changes
// nothing:
void test("A correctly configured repository reports every check clean and changes nothing:", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L76
  const box = await makeTmpBox({ git: true });
  await installHooks(box);
  await writeAnnexInfoAttributes(box.root);
  const annex = healthyFake();
  const result = await runAnnexDoctor(annex, { repoRoot: box.root, boxRoot: box.root });
  t.check(result, report(true));
  t.check(annex.calls, []);
});

// ## annex.thin — the check that fires in practice
//
// `annex.thin` is plain git config, so it does not propagate to clones: every
// fresh clone silently inherits git-annex's default. Repairing it takes **both**
// commands — setting the config alone leaves existing files hardlinked to their
// annex objects, so an in-place edit still corrupts the object and `fsck` does
// not notice.
void test("annex.thin is plain git config, so it does not propagate to clones:", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L104
  const box = await makeTmpBox({ git: true });
  await installHooks(box);
  const annex = createFakeGitAnnex({
    gitConfig: { "annex.thin": "true" },
    annexConfig: { "annex.largefiles": assetLargefilesExpression() },
  });
  const result = await runAnnexDoctor(annex, { repoRoot: box.root, boxRoot: box.root });
  t.check(annex.calls, ["setGitConfig:annex.thin=false", "fix"]);

  // The repair counts as healthy — a fixed problem is not a defect:
  t.check(result, report(true, { thin: ["repaired", "set annex.thin=false and ran `git annex fix` to break existing hardlinks"] }));

  // Under `check: true` nothing is touched and the failure names both commands:

  // doctest:L128
  const annex2 = createFakeGitAnnex({ gitConfig: { "annex.thin": "true" } });
  const readOnly = await runAnnexDoctor(annex2, {
    repoRoot: box.root, boxRoot: box.root, options: { check: true },
  });
  t.check(annex2.calls, []);
  t.check(readOnly, report(false, {
    thin: ["failed", "annex.thin is true; it must be false or fsck cannot detect in-place corruption. Run `git config annex.thin false && git annex fix`."],
    largefiles: ["failed", "annex.largefiles is unset. Run `git annex config --set annex.largefiles \"$(bbx attachments largefiles-expr)\"`."],
  }));
});

// ## A box that is not annex-initialized is a defect, and is still not repaired here
//
// Every box is annex-shaped from its first commit, so an uninitialized one
// predates that or was created outside `bbx init`. It used to be a second
// supported state; it is a failure now.
//
// The doctor still does not initialize it. `git annex init` is not the whole job
// — config, the scoped attributes file, and the un-ignored `.gitignore` have to
// land in an order that never leaves a window where `git add` can see an asset
// the annex does not yet claim. Doing half of that would be worse than
// reporting.
void test("Every box is annex-shaped from its first commit, so an uninitialized one pred...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L156
  const box = await makeTmpBox();
  await box.write(".gitignore", GITIGNORE_BLOCK);
  const annex = createFakeGitAnnex({ initialized: false });
  const result = await runAnnexDoctor(annex, {
    repoRoot: box.root, boxRoot: box.root, options: { description: "testbox" },
  });
  t.check(result, {
    checks: [
      { id: "binary", status: "ok", message: "git-annex 10.20260717" },
      { id: "initialized", status: "failed", message: "not annex-initialized. Every box is annex-shaped from its first commit, so this box predates that or was created outside `bbx init`. Asset bytes written to it reach neither git nor the annex. Re-run `bbx init` on it." },
    ],
    healthy: false,
  });
  t.check(annex.calls, []);
});

// ## Annex initialization is not enough when `.gitignore` still hides assets
//
// The annex gate requires both halves of the migration: git-annex initialized and
// assets visible to `git add`. A box can have the annex directory while retaining
// the manifest scheme's asset-ignore block. The doctor must expose that broken
// half-state and name the existing repair:
void test("The annex gate requires both halves of the migration:", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L187
  const box = await makeTmpBox({ git: true });
  await installHooks(box);
  await writeAnnexInfoAttributes(box.root);
  await box.write(".gitignore", GITIGNORE_BLOCK);
  const halfMigrated = await runAnnexDoctor(healthyFake(), {
    repoRoot: box.root, boxRoot: box.root, options: { check: true },
  });
  t.check(halfMigrated, report(false, { "gitignore-assets": ["failed", GITIGNORE_FAILED] }));

  // Repair mode also reports this state instead of rewriting `.gitignore` outside
  // the migration's load-bearing configuration sequence:

  // doctest:L211
  const repairMode = await runAnnexDoctor(healthyFake(), {
    repoRoot: box.root, boxRoot: box.root,
  });
  t.check(repairMode, report(false, { "gitignore-assets": ["failed", GITIGNORE_FAILED] }));
  t.check(await box.read(".gitignore"), GITIGNORE_BLOCK);

  // Once the box has the post-annex unignore block, the same check passes:

  // doctest:L224
  await box.write(".gitignore", UNIGNORE_BLOCK);
  const converted = await runAnnexDoctor(healthyFake(), {
    repoRoot: box.root, boxRoot: box.root, options: { check: true },
  });
  t.check(converted, report(true));
});

// ## Stale largefiles and a dirty journal self-heal
//
// On a box that IS annexed:
void test("On a box that IS annexed:", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L244
  const box = await makeTmpBox({ git: true });
  await installHooks(box);
  const annex = createFakeGitAnnex({
    gitConfig: { "annex.thin": "false" },
    annexConfig: { "annex.largefiles": "include=*.attach/*" },
    unflushedJournal: true,
  });
  const result = await runAnnexDoctor(annex, {
    repoRoot: box.root, boxRoot: box.root, options: { description: "testbox" },
  });
  t.check(result, report(true, {
    largefiles: ["repaired", "refreshed a stale annex.largefiles"],
    journal: ["repaired", "flushed the git-annex journal"],
  }));

  // A *stale* largefiles is repaired, not just an absent one. That matters: the
  // value seeded above is the rejected path-glob classifier, which would annex
  // committed cards — silently keeping it would be worse than having none.

  t.check(await annex.getAnnexConfig(box.root, "annex.largefiles"), assetLargefilesExpression());
});

// ## The annex filter is scoped to the asset extensions
//
// `git annex init` writes `* filter=annex` into `.git/info/attributes`, which
// hands every path to the annex filter-process — ~0.3s of fixed cost per git
// invocation, paid by every text-only commit. The doctor replaces it with the
// rendering from `ASSET_EXTENSIONS`, and does so on a box that has git-annex's
// default:
void test("git annex init writes  filter=annex into .git/info/attributes, which hands ev...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L283
  const box = await makeTmpBox();
  await installHooks(box);
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const attrPath = path.join(box.root, ".git", "info", "attributes");
  await fs.mkdir(path.dirname(attrPath), { recursive: true });
  await fs.writeFile(attrPath, "\n* filter=annex\n");
  const result = await runAnnexDoctor(healthyFake(), { repoRoot: box.root, boxRoot: box.root });
  t.check(result, report(true, { attributes: ["repaired", "rescoped .git/info/attributes to the asset extensions"] }));
  t.check(await fs.readFile(attrPath, "utf-8"), assetAnnexAttributes());

  // A second run is a no-op — the repair is idempotent, which matters because
  // `bbx init` runs the doctor every time:

  // doctest:L302
  const again = await runAnnexDoctor(healthyFake(), { repoRoot: box.root, boxRoot: box.root });
  t.check(again, report(true));

  // Under `check: true` nothing is written and the message names both remedies:

  // doctest:L310
  await fs.writeFile(attrPath, "\n* filter=annex\n");
  const readOnly = await runAnnexDoctor(healthyFake(), {
    repoRoot: box.root, boxRoot: box.root, options: { check: true },
  });
  t.check(readOnly, report(false, { attributes: ["failed", ".git/info/attributes is unscoped or stale. Run `bbx doctor annex` without `--check`, or `bbx attachments annex-attributes > .git/info/attributes`."] }));

  // doctest:L320
  await t.checkText(await fs.readFile(attrPath, "utf-8"), `«blankline»
* filter=annex`);
});

// ## Scoping is refused while an annexed file falls outside the list
//
// An annexed file whose extension the scoped list does not cover keeps its
// pointer in git but loses the smudge filter — the next checkout writes
// `/annex/objects/…` text where the bytes were. That is indistinguishable from
// data loss, and it is not repairable from here: the list is a source-code
// decision. So the doctor reports it loudly and leaves the unscoped file alone
// rather than performing the change that would strand the file.
void test("An annexed file whose extension the scoped list does not cover keeps its poin...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L339
  const box = await makeTmpBox();
  await installHooks(box);
  const annex = createFakeGitAnnex({
    gitConfig: { "annex.thin": "false" },
    annexConfig: { "annex.largefiles": assetLargefilesExpression() },
    annexedFiles: ["content/trip.attach/photo.jpg", "content/scan.attach/page.psd"],
  });
  const result = await runAnnexDoctor(annex, { repoRoot: box.root, boxRoot: box.root });
  // Even in repair mode the attributes file is left untouched.
  t.check(result, report(false, {
    "annexed-coverage": ["failed", "1 annexed path(s) have an extension outside ASSET_EXTENSIONS: content/scan.attach/page.psd. They would read back as pointer text once the annex filter is scoped. Add the extension(s) to ASSET_EXTENSIONS (src/lib/asset-extensions.ts)."],
    attributes: ["failed", ".git/info/attributes is left unscoped: scoping it would strand the annexed path(s) reported by annexed-coverage. Fix that first."],
  }));

  // doctest:L360
  const fs2 = await import("node:fs/promises");
  const path2 = await import("node:path");
  t.check(await fs2.readFile(path2.join(box.root, ".git", "info", "attributes"), "utf-8").catch(() => "(absent)"), "(absent)");
});

// ## What cannot be repaired
//
// A missing binary short-circuits: running the rest would report a cascade of
// failures that all have one cause.
void test("A missing binary short-circuits:", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L376
  const box = await makeTmpBox();
  const annex = createFakeGitAnnex({ version: null });
  const result = await runAnnexDoctor(annex, { repoRoot: box.root, boxRoot: box.root });
  t.check(result, {
    checks: [
      { id: "binary", status: "failed", message: "git-annex is not installed. Assets will read as pointer text and commits will fail. Install it (`apt install git-annex` / `brew install git-annex`)." },
    ],
    healthy: false,
  });
});

// A pointer with no content is data already lost. With no remote configured there
// is nowhere to fetch from, so this reports rather than repairs:
void test("A pointer with no content is data already lost.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L394
  const box = await makeTmpBox();
  await installHooks(box);
  await box.write(
    "notes.attach/photo.jpg",
    "/annex/objects/SHA256E-s300000--" + "a".repeat(64) + ".jpg\n",
  );
  const result = await runAnnexDoctor(healthyFake(), { repoRoot: box.root, boxRoot: box.root });
  t.check(result, report(false, {
    attributes: ["repaired", "wrote .git/info/attributes scoped to the asset extensions"],
    "content-present": ["failed", "1 asset(s) hold a pointer with no content: notes.attach/photo.jpg. With no remote configured there is nowhere to fetch from — restore from backup."],
  }));
});

// Absent content in a plain subdirectory of a scope is found too — a
// direct-children-only scan would report "no missing content" while an email's
// `attachments/` folder was empty of bytes:
void test("Absent content in a plain subdirectory of a scope is found too — a direct-chi...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L420
  const box = await makeTmpBox();
  await installHooks(box);
  await box.write(
    "mail.attach/attachments/inline.png",
    "/annex/objects/SHA256E-s900--" + "b".repeat(64) + ".png\n",
  );
  const result = await runAnnexDoctor(healthyFake(), { repoRoot: box.root, boxRoot: box.root });
  t.check(result, report(false, {
    attributes: ["repaired", "wrote .git/info/attributes scoped to the asset extensions"],
    "content-present": ["failed", "1 asset(s) hold a pointer with no content: mail.attach/attachments/inline.png. With no remote configured there is nowhere to fetch from — restore from backup."],
  }));
});

// ## Checkout and merge hook integration
//
// The annex smudge hooks are easy to lose without making `git annex info` look
// unhealthy. Read-only mode reports both a foreign `post-checkout` and a missing
// `post-merge` without touching either one:
void test("The annex smudge hooks are easy to lose without making git annex info look un...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L442
  const box = await makeTmpBox({ git: true });
  await installHooks(box);
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const hooksDir = path.join(box.root, ".git", "hooks");
  const postCheckoutPath = path.join(hooksDir, "post-checkout");
  const postMergePath = path.join(hooksDir, "post-merge");
  const postCommitPath = path.join(hooksDir, "post-commit");
  const foreignCheckout = "#!/bin/sh\necho foreign checkout hook\n";
  const compositePostCommit = [
    "#!/bin/sh",
    "echo foreign tool",
    "# >>> beebox url-check (managed) >>>",
    "echo beebox",
    "# <<< beebox url-check (managed) <<<",
    "",
  ].join("\n");
  await fs.writeFile(postCheckoutPath, foreignCheckout);
  await fs.unlink(postMergePath);
  await fs.writeFile(postCommitPath, compositePostCommit);
  const readOnly = await runAnnexDoctor(healthyFake(), {
    repoRoot: box.root,
    boxRoot: box.root,
    options: { check: true },
  });
  t.check(readOnly, report(false, { "smudge-hooks": ["failed", "post-checkout and post-merge do not invoke `git annex smudge --update`. Run `bbx doctor annex` without `--check` to reinstall the damaged annex hook(s)."] }));
  t.check(await fs.readFile(postCheckoutPath, "utf-8"), foreignCheckout);

  // doctest:L473
  t.check(await fs.access(postMergePath).then(() => "exists", () => "missing"), "missing");

  // Repair mode reinstalls only those two canonical hooks. In particular, a
  // composite `post-commit` that does not invoke annex is healthy and stays
  // byte-for-byte untouched:

  // doctest:L482
  const repaired = await runAnnexDoctor(healthyFake(), {
    repoRoot: box.root,
    boxRoot: box.root,
  });
  t.check(repaired, report(true, { "smudge-hooks": ["repaired", "reinstalled annex post-checkout and post-merge hook(s)"] }));
  t.check(await fs.readFile(postCheckoutPath, "utf-8"), `#!/bin/sh\n# automatically configured by git-annex\n${ANNEX_SMUDGE_LINE}\n`);
  t.check(await fs.readFile(postMergePath, "utf-8"), `#!/bin/sh\n# automatically configured by git-annex\n${ANNEX_SMUDGE_LINE}\n`);
  t.check((await fs.stat(postCheckoutPath)).mode & 0o111, not(0));
  t.check(await fs.readFile(postCommitPath, "utf-8"), compositePostCommit);

  // doctest:L501
  const healthy = await runAnnexDoctor(healthyFake(), {
    repoRoot: box.root,
    boxRoot: box.root,
  });
  t.check(healthy, report(true));

  // Merely mentioning the smudge command in a comment does not count as invoking
  // it:

  // doctest:L513
  await fs.writeFile(postCheckoutPath, `#!/bin/sh\n# ${ANNEX_SMUDGE_LINE}\n`);
  const commentedSmudge = await runAnnexDoctor(healthyFake(), {
    repoRoot: box.root,
    boxRoot: box.root,
    options: { check: true },
  });
  t.check(commentedSmudge, report(false, { "smudge-hooks": ["failed", "post-checkout does not invoke `git annex smudge --update`. Run `bbx doctor annex` without `--check` to reinstall the damaged annex hook(s)."] }));
});

// ## Pre-commit hook integration
//
// `git annex init` declines to install its own pre-commit hook when one already
// exists, and `bbx init` leaves a foreign hook untouched — so annex integration
// cannot be inferred from either having run. A hook that does not invoke annex is
// reported:
void test("git annex init declines to install its own pre-commit hook when one already e...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L535
  const box = await makeTmpBox({ git: true });
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  await fs.mkdir(path.join(box.root, ".git", "hooks"), { recursive: true });
  await installSmudgeHooks(box);
  await fs.writeFile(path.join(box.root, ".git", "hooks", "pre-commit"), "#!/bin/bash\necho hi\n");
  const result = await runAnnexDoctor(healthyFake(), { repoRoot: box.root, boxRoot: box.root });
  t.check(result, report(false, { hook: ["failed", HOOK_FAILED] }));

  // A hook that only *mentions* annex in a comment does not count. A substring test
  // would pass on `# TODO: add git annex pre-commit`, or on the real command
  // commented out — both of which mean annex never runs at commit time, which is
  // the whole thing this check exists to catch:

  // doctest:L555
  await fs.writeFile(
    path.join(box.root, ".git", "hooks", "pre-commit"),
    "#!/bin/bash\n# TODO: add git annex pre-commit\n",
  );
  const commented = await runAnnexDoctor(healthyFake(), { repoRoot: box.root, boxRoot: box.root });
  t.check(commented, report(false, { hook: ["failed", HOOK_FAILED] }));

  // The formatted output marks each outcome distinctly, so a repair is not mistaken
  // for a pre-existing pass:

  // doctest:L568
  t.check(formatAnnexDoctor(result).split("\n").filter((l) => l.startsWith("✗")), [`✗ hook: ${HOOK_FAILED}`]);
});
