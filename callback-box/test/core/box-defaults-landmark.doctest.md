# installRootLandmark — create, repair, keep

`installRootLandmark` keeps every box root carrying a usable landmark card. It
installs one when none exists, **repairs** one that exists but is inert (no
real role — e.g. an un-migrated XML-body card), and leaves a real landmark
alone.

```ts setup
import { installRootLandmark } from "../../src/core/box-defaults.js";
import { parseLandmarkFields } from "../../src/schemas/landmark.js";
import { stageFiles, commitPaths } from "../../src/lib/git.js";
import { mkdtemp, writeFile, readFile, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function rootLabel(dir) {
  const f = (await readdir(dir)).find((n) => n.endsWith(".landmark.card"));
  if (!f) return "(none)";
  const fields = parseLandmarkFields(await readFile(join(dir, f), "utf8"));
  return fields?.navigation?.label ?? "(no label)";
}

function gitInit(dir) {
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
}
```

A box root with no landmark gets one installed (returns its path so the caller
can commit it; label + symbol present):

```ts
const A = await mkdtemp(join(tmpdir(), "lm-a-"));
const rA = await installRootLandmark(A);
rA
=> Box.landmark.card

const lA = await rootLabel(A);
lA
=> Box
```

An inert root landmark — here the legacy XML-body shape, which the frontmatter
parser reads as having no role — is repaired in place (the existing filename is
kept and returned):

```ts
const B = await mkdtemp(join(tmpdir(), "lm-b-"));
await writeFile(join(B, "Box.landmark.card"), "---\ncontent-type: application/x-card+xml\n---\n<landmark><navigation><label>Old</label></navigation></landmark>\n");
const rB = await installRootLandmark(B);
rB
=> Box.landmark.card

const lB = await rootLabel(B);
lB
=> Box
```

A real landmark (it has a navigation role) is left untouched — returns null, the
user owns it:

```ts
const C = await mkdtemp(join(tmpdir(), "lm-c-"));
await writeFile(join(C, "Home.landmark.card"), "---\nnavigation:\n  label: Home\n  symbol: 🏠\n---\n");
const rC = await installRootLandmark(C);
rC
=> null

const lC = await rootLabel(C);
lC
=> Home
```

The returned path is what the wakeup commits, so a refilled landmark persists
(this is the staging + commit sequence `runHousekeeping` runs) — an inert one
becomes tracked rather than lingering as an uncommitted working file:

```ts
const G = await mkdtemp(join(tmpdir(), "lm-g-"));
gitInit(G);
await writeFile(join(G, "Box.landmark.card"), "---\ncontent-type: application/x-card+xml\n---\n<landmark><navigation><label>Old</label></navigation></landmark>\n");
const gp = await installRootLandmark(G);
await stageFiles(G, [gp]);
await commitPaths(G, { paths: [gp], message: "Refill root landmark", trailers: { "Created-By": "housekeeping" } });
execFileSync("git", ["ls-files"], { cwd: G }).toString().trim()
=> Box.landmark.card
```
