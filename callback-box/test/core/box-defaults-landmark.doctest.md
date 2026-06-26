# installRootLandmark — create, repair, keep

`installRootLandmark` keeps every box root carrying a usable landmark card. It
installs one when none exists, **repairs** one that exists but is inert (no
real role — e.g. an un-migrated XML-body card), and leaves a real landmark
alone.

```ts setup
import { installRootLandmark } from "../../src/core/box-defaults.js";
import { parseLandmarkFields } from "../../src/schemas/landmark.js";
import { mkdtemp, writeFile, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function rootLabel(dir) {
  const f = (await readdir(dir)).find((n) => n.endsWith(".landmark.card"));
  if (!f) return "(none)";
  const fields = parseLandmarkFields(await readFile(join(dir, f), "utf8"));
  return fields?.navigation?.label ?? "(no label)";
}
```

A box root with no landmark gets one installed (label + symbol present):

```ts
const A = await mkdtemp(join(tmpdir(), "lm-a-"));
const rA = await installRootLandmark(A);
rA
=> true

const lA = await rootLabel(A);
lA
=> Box
```

An inert root landmark — here the legacy XML-body shape, which the frontmatter
parser reads as having no role — is repaired in place (the filename is kept):

```ts
const B = await mkdtemp(join(tmpdir(), "lm-b-"));
await writeFile(join(B, "Box.landmark.card"), "---\ncontent-type: application/x-card+xml\n---\n<landmark><navigation><label>Old</label></navigation></landmark>\n");
const rB = await installRootLandmark(B);
rB
=> true

const lB = await rootLabel(B);
lB
=> Box
```

A real landmark (it has a navigation role) is left untouched — the user owns it:

```ts
const C = await mkdtemp(join(tmpdir(), "lm-c-"));
await writeFile(join(C, "Home.landmark.card"), "---\nnavigation:\n  label: Home\n  symbol: 🏠\n---\n");
const rC = await installRootLandmark(C);
rC
=> false

const lC = await rootLabel(C);
lC
=> Home
```
