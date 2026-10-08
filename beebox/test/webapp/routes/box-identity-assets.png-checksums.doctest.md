# Served icons, and every tracked PNG, keep valid chunk checksums

The app icons that `src/webapp/routes/box-identity-assets.ts` serves are PNGs
in `src/frontend/public/icons/`. This check covers them and every other tracked
PNG under `beebox/`.

The 2026-08-30 product rename ran a text replace over the whole tree, binary
files included. It changed bytes inside the app icons, and their `IDAT`
checksums stopped matching. Nothing failed; the damage was found five weeks
later by a journey walk that saw striped photos
(`issues/closed/bugs/2026-10-08-rename-damaged-binaries-still-in-tree.md`).
A PNG carries a CRC-32 per chunk, so a byte changed by a text tool is
detectable without decoding the image.

```ts setup
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { crc32 } from "node:zlib";

const BEEBOX = join(execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim(), "beebox");

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Names the first problem in a PNG, or returns null when every chunk checks. */
function pngProblem(bytes: Buffer): string | null {
  if (!bytes.subarray(0, 8).equals(SIGNATURE)) return "no PNG signature";
  let at = 8;
  while (at < bytes.length) {
    if (at + 12 > bytes.length) return `truncated chunk header at ${String(at)}`;
    const length = bytes.readUInt32BE(at);
    const end = at + 12 + length;
    if (end > bytes.length) return `chunk at ${String(at)} runs past the end`;
    const type = bytes.subarray(at + 4, at + 8);
    const stored = bytes.readUInt32BE(at + 8 + length);
    const computed = crc32(bytes.subarray(at + 4, at + 8 + length));
    if (stored !== computed) return `bad ${type.toString("latin1")} checksum at ${String(at)}`;
    at = end;
  }
  return null;
}
```

## The checker catches a single changed byte

An intact icon passes. Changing one byte inside its first image-data (`IDAT`)
chunk fails it.

```ts
const good = readFileSync(join(BEEBOX, "src/frontend/public/icons/icon-192.png"));
pngProblem(good);
=> null
```

```ts continue
const bad = Buffer.from(good);
bad[good.indexOf("IDAT") + 10] ^= 0x01;
pngProblem(bad);
=> bad IDAT checksum at «int»
```

## Every tracked PNG under `beebox/` passes

The list of problems is empty, and the scan did find files to check.

```ts
const files = execFileSync("git", ["ls-files", "-z", "--", "*.png"], { cwd: BEEBOX, encoding: "utf8" })
  .split("\0")
  .filter((f) => f !== "");
const problems = files.flatMap((f) => {
  const problem = pngProblem(readFileSync(join(BEEBOX, f)));
  return problem === null ? [] : [`${f}: ${problem}`];
});
({ checked: files.length, problems });
=> { checked: «int», problems: [] }
```
