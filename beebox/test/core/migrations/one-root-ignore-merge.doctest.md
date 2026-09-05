# one-root .gitignore/.gitattributes merge: ordering and quoting

`mergeIgnoreRules` (`src/core/migrations/one-root-ignore-merge.ts`) appends a
v2 box's custom `.gitignore`/`.gitattributes` rules forward, under a marked
section, after the one-root migration's wholesale regen. Two round-4
hardening findings, tested at the unit level (no full migration needed):
Finding 4 (a naive dedup silently flips an ordered override), and Finding 5
(a quoted pattern containing a space used to split inside the quotes).

```ts setup
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import {
  captureIgnoreRules,
  mergeIgnoreRules,
  MIGRATED_SECTION_HEADER,
} from "../../../src/core/migrations/one-root-ignore-merge.js";
import { OneRootPreflightError } from "../../../src/core/migrations/one-root-errors.js";

async function makeFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bbx-ignore-merge-"));
  const contentRoot = path.join(root, "content");
  await fs.mkdir(contentRoot, { recursive: true });
  return { root, contentRoot };
}

async function cleanup(root) {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
}

function migratedLines(text) {
  const idx = text.indexOf(MIGRATED_SECTION_HEADER);
  return text
    .slice(idx + MIGRATED_SECTION_HEADER.length)
    .trim()
    .split("\n");
}
```

## Finding 4: order and duplicates survive the merge instead of being deduped

`config/x.json -diff` / `config/x.json diff` / `config/x.json -diff` is a
real override sequence — git's `.gitattributes` (and `.gitignore` negation)
semantics are order-dependent, the LAST matching rule wins. A dedup that
collapses repeats down to one occurrence each would silently flip this
sequence's effective final rule from "-diff" to "diff" (two rules landing
instead of three). The migration appends every candidate verbatim, in order,
duplicates included.

```ts
const { root, contentRoot } = await makeFixture();
await fs.writeFile(
  path.join(contentRoot, ".gitattributes"),
  "config/x.json -diff\nconfig/x.json diff\nconfig/x.json -diff\n",
);
const snapshot = await captureIgnoreRules({ packageRoot: root, contentRoot });
await mergeIgnoreRules({ packageRoot: root, snapshot });
const gitattributes = await fs.readFile(path.join(root, ".gitattributes"), "utf-8");
JSON.stringify(migratedLines(gitattributes))
=> ["/_config/x.json -diff","/_config/x.json diff","/_config/x.json -diff"]
```

```ts cleanup
await cleanup(root);
```

## Finding 5: a quoted pattern containing a space maps correctly

`"docs/My Draft.bin" -diff` is a C-quoted PATTERN plus the ` -diff`
attribute list. Splitting at the first whitespace (the old behavior) lands
inside the quotes; the pattern must be decoded as one token before the
attribute list is split off, and re-quoted on the way back out.

```ts
const { root, contentRoot } = await makeFixture();
await fs.writeFile(path.join(contentRoot, ".gitattributes"), '"docs/My Draft.bin" -diff\n');
const snapshot = await captureIgnoreRules({ packageRoot: root, contentRoot });
await mergeIgnoreRules({ packageRoot: root, snapshot });
const gitattributes = await fs.readFile(path.join(root, ".gitattributes"), "utf-8");
JSON.stringify(migratedLines(gitattributes))
=> ["\"/_content/docs/My Draft.bin\" -diff"]
```

```ts cleanup
await cleanup(root);
```

## Finding 5 (round 5 hardening): an octal-escaped byte round-trips as UTF-8, not per-byte code points

`"docs/caf\303\251.bin"` is café.bin's real name — é is the two UTF-8 BYTES
0xC3 0xA9, each escaped separately as its own three-digit octal. Decoding
each octal escape as its own Unicode code point (the old behavior) produces
mojibake (Ã©) instead of é; encoding must re-escape byte-for-byte too, not
just pass a decoded character through literally.

```ts
const { root, contentRoot } = await makeFixture();
await fs.writeFile(path.join(contentRoot, ".gitignore"), '"docs/caf\\303\\251.bin"\n');
const snapshot = await captureIgnoreRules({ packageRoot: root, contentRoot });
await mergeIgnoreRules({ packageRoot: root, snapshot });
const gitignore = await fs.readFile(path.join(root, ".gitignore"), "utf-8");
JSON.stringify(migratedLines(gitignore))
=> ["\"/_content/docs/caf\\303\\251.bin\""]
```

```ts cleanup
await cleanup(root);
```

## Finding 5 (round 5 hardening): an embedded newline never splits the rule line

A single-char escape (`\n`) decodes to a real newline byte. Encoding it back
out LITERALLY (the old behavior) would write that byte straight into the
`.gitignore` file, splitting one rule into two physical lines — this
re-escapes it as `\n` again, byte-for-byte, so the migrated line stays one
line.

```ts
const { root, contentRoot } = await makeFixture();
await fs.writeFile(path.join(contentRoot, ".gitignore"), '"docs/weird\\nname.bin"\n');
const snapshot = await captureIgnoreRules({ packageRoot: root, contentRoot });
await mergeIgnoreRules({ packageRoot: root, snapshot });
const gitignore = await fs.readFile(path.join(root, ".gitignore"), "utf-8");
const lines = migratedLines(gitignore);
JSON.stringify({ lineCount: lines.length, line: lines[0] })
=> {"lineCount":1,"line":"\"/_content/docs/weird\\nname.bin\""}
```

```ts cleanup
await cleanup(root);
```

## Finding 5: quoting this decoder can't handle aborts the migration rather than mis-splitting

An unrecognized backslash escape (`\q` isn't a C escape) means the decoder
can't be sure where the pattern ends — refusing to guess is the fail-closed
choice; silently mis-splitting it would strand a stale rule pointing at a
path that's about to move.

```ts
const { root, contentRoot } = await makeFixture();
await fs.writeFile(path.join(contentRoot, ".gitattributes"), '"docs/\\qbad.bin" -diff\n');
const snapshot = await captureIgnoreRules({ packageRoot: root, contentRoot });
const err = await mergeIgnoreRules({ packageRoot: root, snapshot }).catch((e) => e);
JSON.stringify({ isPreflightError: err instanceof OneRootPreflightError, mentionsLine: err.message.includes("qbad.bin") })
=> {"isPreflightError":true,"mentionsLine":true}
```

```ts cleanup
await cleanup(root);
```
