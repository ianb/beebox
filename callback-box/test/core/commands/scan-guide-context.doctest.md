# Scan guide context resolution

The scan-import photo flow gets its boxholder priors from
`config/scan.guide.card`, compiled in-memory into prompt-ready markdown. The
legacy box-root `CLAUDE_SCANS.md` is a deprecated fallback that keeps working
with a warning; a present-but-invalid guide card is a hard error rather than
a silent scan-without-priors. This file pins that resolution ladder.

```ts setup
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  resolveScanGuideContext,
  readScanContextFile,
  SCAN_GUIDE_REL_PATH,
} from "../../../src/core/commands/scan-guide-context.js";
import { createInitialGuideTemplate } from "../../../src/schemas/guide.js";

async function makeBoxDir(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "scan-guide-"));
  await fs.mkdir(path.join(root, "config"), { recursive: true });
  return root;
}

async function writeGuide(root: string, content: string): Promise<void> {
  await fs.writeFile(path.join(root, SCAN_GUIDE_REL_PATH), content);
}
```

## No guide, no legacy file — no priors, and that's valid

```ts
const root = await makeBoxDir();
await resolveScanGuideContext(root)
=> null

await fs.rm(root, { recursive: true, force: true });
```

## The scan seed template round-trips into compiled prompt text

The `scan` entry in `DOMAIN_SEEDS` must produce a card that parses and
compiles; the compiled text carries the applies-to line and the
disambiguation-only rule into the vision prompt.

```ts
const root = await makeBoxDir();
await writeGuide(root, createInitialGuideTemplate({ name: "scan" }));
const resolved = await resolveScanGuideContext(root);
resolved.source
=> guide

JSON.stringify(resolved.warnings)
=> []

resolved.text.split("\n")[0]
=> # Scan Guide

resolved.text.includes("disambiguation only")
=> true

resolved.text.includes("**Default → Ask User**")
=> true

await fs.rm(root, { recursive: true, force: true });
```

## Guide wins over a lingering legacy file, loudly

```ts
const root = await makeBoxDir();
await writeGuide(root, createInitialGuideTemplate({ name: "scan" }));
await fs.writeFile(path.join(root, "CLAUDE_SCANS.md"), "# Old priors\n");
const resolved = await resolveScanGuideContext(root);
resolved.source
=> guide

resolved.warnings[0].includes("CLAUDE_SCANS.md is ignored")
=> true

await fs.rm(root, { recursive: true, force: true });
```

## Legacy file alone still works, with a deprecation warning

Content passes through verbatim (it was hand-written for the prompt), and the
lowercase filename variant is honored too.

```ts
const root = await makeBoxDir();
await fs.writeFile(path.join(root, "CLAUDE_SCANS.md"), "# Scan Context\n- Dave (born 1950)\n");
const resolved = await resolveScanGuideContext(root);
resolved.source
=> claude-scans

resolved.text.includes("Dave (born 1950)")
=> true

resolved.warnings[0].includes("deprecated")
=> true

await fs.rm(root, { recursive: true, force: true });
```

```ts
const root = await makeBoxDir();
await fs.writeFile(path.join(root, "claude_scans.md"), "lowercase priors\n");
const resolved = await resolveScanGuideContext(root);
resolved.source
=> claude-scans

await fs.rm(root, { recursive: true, force: true });
```

A blank legacy file counts as absent:

```ts
const root = await makeBoxDir();
await fs.writeFile(path.join(root, "CLAUDE_SCANS.md"), "   \n");
await readScanContextFile(root)
=> null

await resolveScanGuideContext(root)
=> null

await fs.rm(root, { recursive: true, force: true });
```

## A present-but-invalid guide card is a hard error, never a silent skip

Each parse stage names itself: missing frontmatter, YAML syntax, schema
validation. Scanning without priors would commit misread names silently, so
the resolver refuses instead.

```ts
async function resolveError(root) {
  try {
    await resolveScanGuideContext(root);
    return "(no error)";
  } catch (e) {
    return `${e.name}: ${e.message}`;
  }
}

const root = await makeBoxDir();
await writeGuide(root, "just prose, no frontmatter\n");
(await resolveError(root)).includes("ScanGuideParseError: config/scan.guide.card has no YAML frontmatter")
=> true

await writeGuide(root, "---\nversion: [unclosed\n---\n");
(await resolveError(root)).startsWith("ScanGuideParseError: config/scan.guide.card has invalid YAML:")
=> true

await writeGuide(root, "---\ntriage-rules: 5\n---\n");
await resolveError(root)
=> ScanGuideParseError: config/scan.guide.card fails guide schema validation: triage-rules: Invalid input: expected array, received number — fix the card (cb validate config/scan.guide.card)

await fs.rm(root, { recursive: true, force: true });
```
