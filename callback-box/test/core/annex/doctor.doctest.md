# `cb doctor annex`

Is git-annex set up correctly in this repository? See
`src/core/annex/doctor.ts`.

**Repair by default.** Most of what can be wrong is something the box can put
right, so reporting it to a human who then runs the obvious command is a wasted
round trip. `check: true` is the read-only mode.

```ts setup
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { createFakeGitAnnex } from "../../../src/services/git-annex.js";
import { runAnnexDoctor, formatAnnexDoctor, ANNEX_PRECOMMIT_LINE } from "../../../src/core/annex/doctor.js";
import { assetAnnexAttributes, assetLargefilesExpression } from "../../../src/lib/asset-extensions.js";
import { writeAnnexInfoAttributes } from "../../../src/core/annex/info-attributes.js";
import { GITIGNORE_BLOCK, UNIGNORE_BLOCK } from "../../../src/core/commands/attachments-gitignore.js";

/** A fake in the fully-correct state, which individual tests then break. */
function healthyFake() {
  return createFakeGitAnnex({
    gitConfig: { "annex.thin": "false" },
    annexConfig: { "annex.largefiles": assetLargefilesExpression() },
  });
}

/** Write the managed pre-commit hook so the hook check passes. */
async function installHook(box: { packageRoot: string }): Promise<void> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const dir = path.join(box.packageRoot, ".git", "hooks");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "pre-commit"), `#!/bin/bash\n${ANNEX_PRECOMMIT_LINE}\n`);
}

function statuses(result: { checks: { id: string; status: string }[] }): string {
  return result.checks.map((c) => `${c.id}=${c.status}`).join(" ");
}
```

A correctly configured repository reports every check clean and changes
nothing:

```ts
const box = await makeTmpBox();
await installHook(box);
await writeAnnexInfoAttributes(box.packageRoot);
const annex = healthyFake();
const result = await runAnnexDoctor(annex, { repoRoot: box.packageRoot, boxRoot: box.root });
statuses(result)
=> binary=ok initialized=ok gitignore-assets=ok thin=ok largefiles=ok annexed-coverage=ok attributes=ok content-present=ok journal=ok hook=ok

result.healthy
=> true

annex.calls.length
=> 0
```

```ts cleanup
await box.cleanup();
```

## annex.thin — the check that fires in practice

`annex.thin` is plain git config, so it does not propagate to clones: every
fresh clone silently inherits git-annex's default. Repairing it takes **both**
commands — setting the config alone leaves existing files hardlinked to their
annex objects, so an in-place edit still corrupts the object and `fsck` does
not notice.

```ts
const box = await makeTmpBox();
await installHook(box);
const annex = createFakeGitAnnex({
  gitConfig: { "annex.thin": "true" },
  annexConfig: { "annex.largefiles": assetLargefilesExpression() },
});
const result = await runAnnexDoctor(annex, { repoRoot: box.packageRoot, boxRoot: box.root });
annex.calls.join(" then ")
=> setGitConfig:annex.thin=false then fix
```

The repair counts as healthy — a fixed problem is not a defect:

```ts continue
result.healthy
=> true

result.checks.find((c) => c.id === "thin")?.status
=> repaired
```

Under `check: true` nothing is touched and the failure names both commands:

```ts continue
const annex2 = createFakeGitAnnex({ gitConfig: { "annex.thin": "true" } });
const readOnly = await runAnnexDoctor(annex2, {
  repoRoot: box.packageRoot, boxRoot: box.root, options: { check: true },
});
annex2.calls.length
=> 0

readOnly.checks.find((c) => c.id === "thin")?.message.includes("git config annex.thin false && git annex fix")
=> true
```

```ts cleanup
await box.cleanup();
```

## An un-migrated box is left completely alone

A box still on the manifest model is in a correct state, not a broken one — and
the doctor must not "fix" it. `git annex init` writes `* filter=annex` into
`.git/info/attributes`, the highest-precedence attributes file, which instantly
stops Git LFS from smudging anything in that repository. Every unmigrated box
uses LFS, so auto-initializing would half-break each one: annexing nothing while
making its LFS content unreachable until `git annex uninit`.

```ts
const box = await makeTmpBox();
await box.write(".gitignore", GITIGNORE_BLOCK);
const annex = createFakeGitAnnex({ initialized: false });
const result = await runAnnexDoctor(annex, {
  repoRoot: box.packageRoot, boxRoot: box.root, options: { description: "testbox" },
});
statuses(result)
=> binary=ok initialized=ok

annex.calls.length
=> 0

result.healthy
=> true

result.checks[1]?.message.includes("cb attachments to-annex")
=> true
```

```ts cleanup
await box.cleanup();
```

## Annex initialization is not enough when `.gitignore` still hides assets

The annex gate requires both halves of the migration: git-annex initialized and
assets visible to `git add`. A box can have the annex directory while retaining
the manifest scheme's asset-ignore block. The doctor must expose that broken
half-state and name the existing repair:

```ts
const box = await makeTmpBox({ annex: true });
await installHook(box);
await writeAnnexInfoAttributes(box.packageRoot);
await box.write(".gitignore", GITIGNORE_BLOCK);
const halfMigrated = await runAnnexDoctor(healthyFake(), {
  repoRoot: box.packageRoot, boxRoot: box.root, options: { check: true },
});
halfMigrated.checks.find((c) => c.id === "gitignore-assets")?.status
=> failed

halfMigrated.checks.find((c) => c.id === "gitignore-assets")?.message.includes("cb attachments unignore")
=> true

halfMigrated.checks.find((c) => c.id === "gitignore-assets")?.message.includes("remove those rules")
=> true

halfMigrated.healthy
=> false
```

Repair mode also reports this state instead of rewriting `.gitignore` outside
the migration's load-bearing configuration sequence:

```ts continue
const repairMode = await runAnnexDoctor(healthyFake(), {
  repoRoot: box.packageRoot, boxRoot: box.root,
});
repairMode.checks.find((c) => c.id === "gitignore-assets")?.status
=> failed

await box.read(".gitignore") === GITIGNORE_BLOCK
=> true
```

Once the box has the post-annex unignore block, the same check passes:

```ts continue
await box.write(".gitignore", UNIGNORE_BLOCK);
const converted = await runAnnexDoctor(healthyFake(), {
  repoRoot: box.packageRoot, boxRoot: box.root, options: { check: true },
});
converted.checks.find((c) => c.id === "gitignore-assets")?.status
=> ok

converted.healthy
=> true
```

```ts cleanup
await box.cleanup();
```

## Stale largefiles and a dirty journal self-heal

On a box that IS annexed:

```ts
const box = await makeTmpBox();
await installHook(box);
const annex = createFakeGitAnnex({
  gitConfig: { "annex.thin": "false" },
  annexConfig: { "annex.largefiles": "include=*.attach/*" },
  unflushedJournal: true,
});
const result = await runAnnexDoctor(annex, {
  repoRoot: box.packageRoot, boxRoot: box.root, options: { description: "testbox" },
});
statuses(result)
=> binary=ok initialized=ok gitignore-assets=ok thin=ok largefiles=repaired annexed-coverage=ok attributes=repaired content-present=ok journal=repaired hook=ok
```

A *stale* largefiles is repaired, not just an absent one. That matters: the
value seeded above is the rejected path-glob classifier, which would annex
committed cards — silently keeping it would be worse than having none.

```ts continue
result.checks.find((c) => c.id === "largefiles")?.message
=> refreshed a stale annex.largefiles

await annex.getAnnexConfig(box.packageRoot, "annex.largefiles") === assetLargefilesExpression()
=> true
```

```ts cleanup
await box.cleanup();
```

## The annex filter is scoped to the asset extensions

`git annex init` writes `* filter=annex` into `.git/info/attributes`, which
hands every path to the annex filter-process — ~0.3s of fixed cost per git
invocation, paid by every text-only commit. The doctor replaces it with the
rendering from `ASSET_EXTENSIONS`, and does so on a box that has git-annex's
default:

```ts
const box = await makeTmpBox();
await installHook(box);
const fs = await import("node:fs/promises");
const path = await import("node:path");
const attrPath = path.join(box.packageRoot, ".git", "info", "attributes");
await fs.mkdir(path.dirname(attrPath), { recursive: true });
await fs.writeFile(attrPath, "\n* filter=annex\n");
const result = await runAnnexDoctor(healthyFake(), { repoRoot: box.packageRoot, boxRoot: box.root });
result.checks.find((c) => c.id === "attributes")?.message
=> rescoped .git/info/attributes to the asset extensions

await fs.readFile(attrPath, "utf-8") === assetAnnexAttributes()
=> true
```

A second run is a no-op — the repair is idempotent, which matters because
`cb init` runs the doctor every time:

```ts continue
const again = await runAnnexDoctor(healthyFake(), { repoRoot: box.packageRoot, boxRoot: box.root });
again.checks.find((c) => c.id === "attributes")?.status
=> ok
```

Under `check: true` nothing is written and the message names both remedies:

```ts continue
await fs.writeFile(attrPath, "\n* filter=annex\n");
const readOnly = await runAnnexDoctor(healthyFake(), {
  repoRoot: box.packageRoot, boxRoot: box.root, options: { check: true },
});
readOnly.checks.find((c) => c.id === "attributes")?.status
=> failed

readOnly.checks.find((c) => c.id === "attributes")?.message.includes("cb attachments annex-attributes")
=> true

await fs.readFile(attrPath, "utf-8")
=> «blankline»
* filter=annex
```

```ts cleanup
await box.cleanup();
```

## Scoping is refused while an annexed file falls outside the list

An annexed file whose extension the scoped list does not cover keeps its
pointer in git but loses the smudge filter — the next checkout writes
`/annex/objects/…` text where the bytes were. That is indistinguishable from
data loss, and it is not repairable from here: the list is a source-code
decision. So the doctor reports it loudly and leaves the unscoped file alone
rather than performing the change that would strand the file.

```ts
const box = await makeTmpBox();
await installHook(box);
const annex = createFakeGitAnnex({
  gitConfig: { "annex.thin": "false" },
  annexConfig: { "annex.largefiles": assetLargefilesExpression() },
  annexedFiles: ["content/trip.attach/photo.jpg", "content/scan.attach/page.psd"],
});
const result = await runAnnexDoctor(annex, { repoRoot: box.packageRoot, boxRoot: box.root });
result.checks.find((c) => c.id === "annexed-coverage")?.message
=> 1 annexed path(s) have an extension outside ASSET_EXTENSIONS: content/scan.attach/page.psd. They would read back as pointer text once the annex filter is scoped. Add the extension(s) to ASSET_EXTENSIONS (src/lib/asset-extensions.ts).

result.healthy
=> false
```

Even in repair mode the attributes file is left untouched:

```ts continue
result.checks.find((c) => c.id === "attributes")?.status
=> failed

const fs2 = await import("node:fs/promises");
const path2 = await import("node:path");
await fs2.readFile(path2.join(box.packageRoot, ".git", "info", "attributes"), "utf-8").catch(() => "(absent)")
=> (absent)
```

Case is not a gap: the coverage test is case-insensitive, matching the
character classes the attributes lines use, so an iOS `.HEIC` counts as covered.

```ts continue
const ios = createFakeGitAnnex({
  gitConfig: { "annex.thin": "false" },
  annexConfig: { "annex.largefiles": assetLargefilesExpression() },
  annexedFiles: ["content/trip.attach/IMG_0001.HEIC"],
});
const iosResult = await runAnnexDoctor(ios, { repoRoot: box.packageRoot, boxRoot: box.root });
iosResult.checks.find((c) => c.id === "annexed-coverage")?.status
=> ok
```

```ts cleanup
await box.cleanup();
```

## What cannot be repaired

A missing binary short-circuits: running the rest would report a cascade of
failures that all have one cause.

```ts
const box = await makeTmpBox();
const annex = createFakeGitAnnex({ version: null });
const result = await runAnnexDoctor(annex, { repoRoot: box.packageRoot, boxRoot: box.root });
statuses(result)
=> binary=failed

result.checks[0]?.message.includes("brew install git-annex")
=> true
```

```ts cleanup
await box.cleanup();
```

A pointer with no content is data already lost. With no remote configured there
is nowhere to fetch from, so this reports rather than repairs:

```ts
const box = await makeTmpBox();
await installHook(box);
await box.write(
  "notes.attach/photo.jpg",
  "/annex/objects/SHA256E-s300000--" + "a".repeat(64) + ".jpg\n",
);
const result = await runAnnexDoctor(healthyFake(), { repoRoot: box.packageRoot, boxRoot: box.root });
result.checks.find((c) => c.id === "content-present")?.status
=> failed

result.checks.find((c) => c.id === "content-present")?.message.includes("nowhere to fetch from")
=> true

result.healthy
=> false
```

```ts cleanup
await box.cleanup();
```

Absent content in a plain subdirectory of a scope is found too — a
direct-children-only scan would report "no missing content" while an email's
`attachments/` folder was empty of bytes:

```ts
const box = await makeTmpBox();
await installHook(box);
await box.write(
  "mail.attach/attachments/inline.png",
  "/annex/objects/SHA256E-s900--" + "b".repeat(64) + ".png\n",
);
const result = await runAnnexDoctor(healthyFake(), { repoRoot: box.packageRoot, boxRoot: box.root });
result.checks.find((c) => c.id === "content-present")?.message.includes("mail.attach/attachments/inline.png")
=> true
```

```ts cleanup
await box.cleanup();
```

## Hook integration

`git annex init` declines to install its own pre-commit hook when one already
exists, and `cb init` leaves a foreign hook untouched — so annex integration
cannot be inferred from either having run. A hook that does not invoke annex is
reported:

```ts
const box = await makeTmpBox();
const fs = await import("node:fs/promises");
const path = await import("node:path");
await fs.mkdir(path.join(box.packageRoot, ".git", "hooks"), { recursive: true });
await fs.writeFile(path.join(box.packageRoot, ".git", "hooks", "pre-commit"), "#!/bin/bash\necho hi\n");
const result = await runAnnexDoctor(healthyFake(), { repoRoot: box.packageRoot, boxRoot: box.root });
result.checks.find((c) => c.id === "hook")?.status
=> failed

result.checks.find((c) => c.id === "hook")?.message.includes("hand-written")
=> true
```

A hook that only *mentions* annex in a comment does not count. A substring test
would pass on `# TODO: add git annex pre-commit`, or on the real command
commented out — both of which mean annex never runs at commit time, which is
the whole thing this check exists to catch:

```ts continue
await fs.writeFile(
  path.join(box.packageRoot, ".git", "hooks", "pre-commit"),
  "#!/bin/bash\n# TODO: add git annex pre-commit\n",
);
const commented = await runAnnexDoctor(healthyFake(), { repoRoot: box.packageRoot, boxRoot: box.root });
commented.checks.find((c) => c.id === "hook")?.status
=> failed
```

The formatted output marks each outcome distinctly, so a repair is not mistaken
for a pre-existing pass:

```ts continue
formatAnnexDoctor(result).split("\n").filter((l) => l.startsWith("✗")).length
=> 1
```

```ts cleanup
await box.cleanup();
```
