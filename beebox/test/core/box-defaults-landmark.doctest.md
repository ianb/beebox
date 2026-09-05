# installRootLandmark — create, repair, keep

`installRootLandmark` keeps every box's `_content/` carrying a usable
landmark card. It installs one when none exists, **repairs** one that exists
but is inert (no real role — e.g. an un-migrated XML-body card), and leaves a
real landmark alone.

```ts setup
import { mkdir } from "node:fs/promises";
import { installRootLandmark } from "../../src/core/box/defaults.js";
import { parseLandmarkFields } from "../../src/schemas/landmark.js";
import { stageFiles, commitPaths } from "../../src/lib/git.js";
import { mkdtemp, writeFile, readFile, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";

async function makeContentBox() {
  const dir = await mkdtemp(join(tmpdir(), "lm-"));
  await mkdir(join(dir, "_content"), { recursive: true });
  return dir;
}

async function rootLabel(dir) {
  const contentDir = join(dir, "_content");
  const f = (await readdir(contentDir)).find((n) => n.endsWith(".landmark.card"));
  if (!f) return "(none)";
  const fields = parseLandmarkFields(await readFile(join(contentDir, f), "utf8"));
  return fields?.navigation?.label ?? "(no label)";
}

function gitInit(dir) {
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
}
```

A box with no landmark gets one installed under `_content/` (returns its
box-relative path so the caller can commit it; label + symbol present). The
label is the box's OWN name, not a fixed word: this card's label is the box's
display name everywhere a box is named — the switcher, the dashboard header,
the browser tab — so a fleet scaffolded with one hardcoded label would be a
fleet of identical-looking tabs.

```ts
const A = await makeContentBox();
const rA = await installRootLandmark(A);
rA
=> _content/Box.landmark.card

const lA = await rootLabel(A);
lA === basename(A)
=> true
```

An inert root landmark — here the legacy XML-body shape, which the frontmatter
parser reads as having no role — is repaired in place (the existing filename is
kept and returned):

```ts
const B = await makeContentBox();
await writeFile(join(B, "_content", "Box.landmark.card"), "---\ncontent-type: application/x-card+xml\n---\n<landmark><navigation><label>Old</label></navigation></landmark>\n");
const rB = await installRootLandmark(B);
rB
=> _content/Box.landmark.card

const lB = await rootLabel(B);
lB === basename(B)
=> true
```

A real landmark (it has a navigation role) is left untouched — returns null, the
user owns it:

```ts
const C = await makeContentBox();
await writeFile(join(C, "_content", "Home.landmark.card"), "---\nnavigation:\n  label: Home\n  symbol: 🏠\n---\n");
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
const G = await makeContentBox();
gitInit(G);
await writeFile(join(G, "_content", "Box.landmark.card"), "---\ncontent-type: application/x-card+xml\n---\n<landmark><navigation><label>Old</label></navigation></landmark>\n");
const gp = await installRootLandmark(G);
await stageFiles(G, [gp]);
await commitPaths(G, { paths: [gp], message: "Refill root landmark", trailers: { "Created-By": "housekeeping" } });
execFileSync("git", ["ls-files"], { cwd: G }).toString().trim()
=> _content/Box.landmark.card
```
