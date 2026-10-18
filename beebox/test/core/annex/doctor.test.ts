// # `bbx doctor annex`
//
// Is git-annex set up correctly in this repository? See
// `src/core/annex/doctor/core.ts`.
//
// **Repair by default.** Most of what can be wrong is something the box can put
// right, so reporting it to a human who then runs the obvious command is a wasted
// round trip. `check: true` is the read-only mode.

import { test } from "tap";
import "agent-doctest/tap";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { createFakeGitAnnex } from "../../../src/services/git-annex.js";
import {
  runAnnexDoctor,
  formatAnnexDoctor,
  ANNEX_PRECOMMIT_LINE,
  ANNEX_SMUDGE_LINE,
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

function statuses(result: { checks: { id: string; status: string }[] }): string {
  return result.checks.map((c) => `${c.id}=${c.status}`).join(" ");
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
  t.check(statuses(result), "binary=ok initialized=ok gitignore-assets=ok thin=ok largefiles=ok annexed-coverage=ok attributes=ok content-present=ok journal=ok smudge-hooks=ok hook=ok");

  // doctest:L84
  t.check(result.healthy, true);

  // doctest:L87
  await t.checkText(annex.calls.length, "0");
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
  t.check(annex.calls.join(" then "), "setGitConfig:annex.thin=false then fix");

  // The repair counts as healthy — a fixed problem is not a defect:

  // doctest:L118
  t.check(result.healthy, true);

  // doctest:L121
  t.check(result.checks.find((c) => c.id === "thin")?.status, "repaired");

  // Under `check: true` nothing is touched and the failure names both commands:

  // doctest:L128
  const annex2 = createFakeGitAnnex({ gitConfig: { "annex.thin": "true" } });
  const readOnly = await runAnnexDoctor(annex2, {
    repoRoot: box.root, boxRoot: box.root, options: { check: true },
  });
  await t.checkText(annex2.calls.length, "0");

  // doctest:L135
  t.check(readOnly.checks.find((c) => c.id === "thin")?.message.includes("git config annex.thin false && git annex fix"), true);
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
  t.check(statuses(result), "binary=ok initialized=failed");

  // doctest:L165
  await t.checkText(annex.calls.length, "0");

  // doctest:L168
  t.check(result.healthy, false);

  // doctest:L171
  t.check(result.checks[1]?.message.includes("Re-run `bbx init`"), true);
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
  t.check(halfMigrated.checks.find((c) => c.id === "gitignore-assets")?.status, "failed");

  // doctest:L197
  t.check(halfMigrated.checks.find((c) => c.id === "gitignore-assets")?.message.includes("bbx attachments unignore"), true);

  // doctest:L200
  t.check(halfMigrated.checks.find((c) => c.id === "gitignore-assets")?.message.includes("remove those rules"), true);

  // doctest:L203
  t.check(halfMigrated.healthy, false);

  // Repair mode also reports this state instead of rewriting `.gitignore` outside
  // the migration's load-bearing configuration sequence:

  // doctest:L211
  const repairMode = await runAnnexDoctor(healthyFake(), {
    repoRoot: box.root, boxRoot: box.root,
  });
  t.check(repairMode.checks.find((c) => c.id === "gitignore-assets")?.status, "failed");

  // doctest:L217
  await t.checkText(await box.read(".gitignore") === GITIGNORE_BLOCK, "true");

  // Once the box has the post-annex unignore block, the same check passes:

  // doctest:L224
  await box.write(".gitignore", UNIGNORE_BLOCK);
  const converted = await runAnnexDoctor(healthyFake(), {
    repoRoot: box.root, boxRoot: box.root, options: { check: true },
  });
  t.check(converted.checks.find((c) => c.id === "gitignore-assets")?.status, "ok");

  // doctest:L231
  t.check(converted.healthy, true);
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
  t.check(statuses(result), "binary=ok initialized=ok gitignore-assets=ok thin=ok largefiles=repaired annexed-coverage=ok attributes=ok content-present=ok journal=repaired smudge-hooks=ok hook=ok");

  // A *stale* largefiles is repaired, not just an absent one. That matters: the
  // value seeded above is the rejected path-glob classifier, which would annex
  // committed cards — silently keeping it would be worse than having none.

  // doctest:L263
  t.check(result.checks.find((c) => c.id === "largefiles")?.message, "refreshed a stale annex.largefiles");

  // doctest:L266
  await t.checkText(await annex.getAnnexConfig(box.root, "annex.largefiles") === assetLargefilesExpression(), "true");
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
  t.check(result.checks.find((c) => c.id === "attributes")?.message, "rescoped .git/info/attributes to the asset extensions");

  // doctest:L294
  await t.checkText(await fs.readFile(attrPath, "utf-8") === assetAnnexAttributes(), "true");

  // A second run is a no-op — the repair is idempotent, which matters because
  // `bbx init` runs the doctor every time:

  // doctest:L302
  const again = await runAnnexDoctor(healthyFake(), { repoRoot: box.root, boxRoot: box.root });
  t.check(again.checks.find((c) => c.id === "attributes")?.status, "ok");

  // Under `check: true` nothing is written and the message names both remedies:

  // doctest:L310
  await fs.writeFile(attrPath, "\n* filter=annex\n");
  const readOnly = await runAnnexDoctor(healthyFake(), {
    repoRoot: box.root, boxRoot: box.root, options: { check: true },
  });
  t.check(readOnly.checks.find((c) => c.id === "attributes")?.status, "failed");

  // doctest:L317
  t.check(readOnly.checks.find((c) => c.id === "attributes")?.message.includes("bbx attachments annex-attributes"), true);

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
  t.check(result.checks.find((c) => c.id === "annexed-coverage")?.message, "1 annexed path(s) have an extension outside ASSET_EXTENSIONS: content/scan.attach/page.psd. They would read back as pointer text once the annex filter is scoped. Add the extension(s) to ASSET_EXTENSIONS (src/lib/asset-extensions.ts).");

  // doctest:L350
  t.check(result.healthy, false);

  // Even in repair mode the attributes file is left untouched:

  // doctest:L357
  t.check(result.checks.find((c) => c.id === "attributes")?.status, "failed");

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
  t.check(statuses(result), "binary=failed");

  // doctest:L382
  t.check(result.checks[0]?.message.includes("brew install git-annex"), true);
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
  t.check(result.checks.find((c) => c.id === "content-present")?.status, "failed");

  // doctest:L404
  t.check(result.checks.find((c) => c.id === "content-present")?.message.includes("nowhere to fetch from"), true);

  // doctest:L407
  t.check(result.healthy, false);
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
  t.check(result.checks.find((c) => c.id === "content-present")?.message.includes("mail.attach/attachments/inline.png"), true);
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
  t.check(readOnly.checks.find((c) => c.id === "smudge-hooks")?.status, "failed");

  // doctest:L470
  await t.checkText(await fs.readFile(postCheckoutPath, "utf-8") === foreignCheckout, "true");

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
  t.check(repaired.checks.find((c) => c.id === "smudge-hooks")?.status, "repaired");

  // doctest:L489
  await t.checkText((await fs.readFile(postCheckoutPath, "utf-8")).includes(ANNEX_SMUDGE_LINE), "true");

  // doctest:L492
  await t.checkText((await fs.readFile(postMergePath, "utf-8")).includes(ANNEX_SMUDGE_LINE), "true");

  // doctest:L495
  await t.checkText(((await fs.stat(postCheckoutPath)).mode & 0o111) !== 0, "true");

  // doctest:L498
  await t.checkText(await fs.readFile(postCommitPath, "utf-8") === compositePostCommit, "true");

  // doctest:L501
  const healthy = await runAnnexDoctor(healthyFake(), {
    repoRoot: box.root,
    boxRoot: box.root,
  });
  t.check(healthy.checks.find((c) => c.id === "smudge-hooks")?.status, "ok");

  // Merely mentioning the smudge command in a comment does not count as invoking
  // it:

  // doctest:L513
  await fs.writeFile(postCheckoutPath, `#!/bin/sh\n# ${ANNEX_SMUDGE_LINE}\n`);
  const commentedSmudge = await runAnnexDoctor(healthyFake(), {
    repoRoot: box.root,
    boxRoot: box.root,
    options: { check: true },
  });
  t.check(commentedSmudge.checks.find((c) => c.id === "smudge-hooks")?.status, "failed");
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
  t.check(result.checks.find((c) => c.id === "hook")?.status, "failed");

  // doctest:L545
  t.check(result.checks.find((c) => c.id === "hook")?.message.includes("hand-written"), true);

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
  t.check(commented.checks.find((c) => c.id === "hook")?.status, "failed");

  // The formatted output marks each outcome distinctly, so a repair is not mistaken
  // for a pre-existing pass:

  // doctest:L568
  await t.checkText(formatAnnexDoctor(result).split("\n").filter((l) => l.startsWith("✗")).length, "1");
});
