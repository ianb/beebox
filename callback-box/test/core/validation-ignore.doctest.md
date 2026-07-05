# Validation ignore: config/cb-validate.ignore + color gating

`loadValidationIgnore` reads the box's operator-owned `config/cb-validate.ignore`
(a gitignore-style file — the `.gitignore` analogue for `cb validate`) and
returns a matcher. When the file is absent the matcher allows everything, so the
common case (no file) costs nothing.

```ts setup
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { loadValidationIgnore } from "../../src/core/validation-ignore.js";
import { useColor } from "../../src/cli/commands/validate.js";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
```

No ignore file → allow-all (nothing is ignored):

```ts
const box = await makeTmpBox();
const ig = await loadValidationIgnore(box.root);
[ig.isIgnored("store/anything.md"), ig.isIgnored(join(box.root, "vendor/x.md"))]
=> [
  false,
  false
]
```

```ts continue
await box.cleanup();
```

With patterns, matching paths are ignored and others aren't. Both box-relative
and absolute paths resolve against the box root:

```ts
const box = await makeTmpBox();
await mkdir(join(box.root, "config"), { recursive: true });
await writeFile(join(box.root, "config/cb-validate.ignore"), "# a comment\nvendor/**\nstore/imported/**/*.md\n");
const ig = await loadValidationIgnore(box.root);
[
  ig.isIgnored("vendor/docs/readme.md"),
  ig.isIgnored(join(box.root, "vendor/docs/readme.md")),
  ig.isIgnored("store/imported/data/notes.md"),
  ig.isIgnored("store/real/note.md"),
]
=> [
  true,
  true,
  true,
  false
]
```

Paths outside the box root (or empty) are never ignored — the matcher only
speaks to box-relative content:

```ts continue
[ig.isIgnored("/etc/passwd"), ig.isIgnored("")]
=> [
  false,
  false
]
```

```ts continue
await box.cleanup();
```

## Color gating

`useColor` emits ANSI only for a real terminal and never when `NO_COLOR` is set.
Under the test harness stdout is piped (not a TTY), so it stays off — the common
piped/pasted case gets clean, escape-free output:

```ts
useColor()
=> false
```

Force a TTY to exercise the terminal branch, and confirm `NO_COLOR` still wins:

```ts
const orig = process.stdout.isTTY;
process.stdout.isTTY = true;
const noEnv = process.env.NO_COLOR;
delete process.env.NO_COLOR;
const onTty = useColor();
process.env.NO_COLOR = "1";
const withNoColor = useColor();
if (noEnv === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = noEnv;
process.stdout.isTTY = orig;
[onTty, withNoColor]
=> [
  true,
  false
]
```
