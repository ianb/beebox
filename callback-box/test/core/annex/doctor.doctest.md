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
import { assetLargefilesExpression } from "../../../src/lib/asset-extensions.js";

/** A fake in the fully-correct state, which individual tests then break. */
function healthyFake() {
  return createFakeGitAnnex({
    gitConfig: { "annex.thin": "false" },
    annexConfig: { "annex.largefiles": assetLargefilesExpression() },
  });
}

/** Write the managed pre-commit hook so check 7 passes. */
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

A correctly configured repository reports all seven checks clean and changes
nothing:

```ts
const box = await makeTmpBox();
await installHook(box);
const annex = healthyFake();
const result = await runAnnexDoctor(annex, { repoRoot: box.packageRoot, boxRoot: box.root });
statuses(result)
=> binary=ok initialized=ok thin=ok largefiles=ok content-present=ok journal=ok hook=ok

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

## Uninitialized, stale largefiles, dirty journal

All three self-heal:

```ts
const box = await makeTmpBox();
await installHook(box);
const annex = createFakeGitAnnex({
  initialized: false,
  gitConfig: { "annex.thin": "false" },
  annexConfig: { "annex.largefiles": "include=*.attach/*" },
  unflushedJournal: true,
});
const result = await runAnnexDoctor(annex, {
  repoRoot: box.packageRoot, boxRoot: box.root, options: { description: "testbox" },
});
statuses(result)
=> binary=ok initialized=repaired thin=ok largefiles=repaired content-present=ok journal=repaired hook=ok
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
