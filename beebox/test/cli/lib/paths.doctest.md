# Path Utilities

Utilities for working with card filenames and Bee Box directory structure.

```ts setup
import { parseCardName, buildCardName, isCardFile, BOX_DIRS, findBoxRoot } from "../../../src/lib/paths.js";
import { PreV3ShapeError } from "../../../src/lib/box-shape-errors.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Whether `findBoxRoot(dir)` throws the migration-pointing pre-v3 error. */
async function findBoxRootThrowsPreV3(dir: string): Promise<boolean> {
  try {
    await findBoxRoot(dir);
    return false;
  } catch (e) {
    return e instanceof PreV3ShapeError;
  }
}
```

## Card filenames

Card files follow the pattern `Name.type.card`. The name can contain dots, but the type is always the last segment before `.card`.

```ts
parseCardName("Test.memo.card")
=>
{
  "name": "Test",
  "type": "memo"
}
```

Compound types work — the type is everything between the last dot-separated segment and `.card`:

```ts
parseCardName("Meeting_Tomorrow.email-thread.card")
=>
{
  "name": "Meeting_Tomorrow",
  "type": "email-thread"
}
```

Positional names (bare `<type>.card` — "the ‹type› of this directory") parse
with the stem doing double duty as name and type:

```ts
parseCardName("nav.card")
=>
{
  "name": "nav",
  "type": "nav"
}
```

Returns `null` for strings that aren't valid card filenames:

```ts
parseCardName("no-extension")
=> null

parseCardName(".card")
=> null
```

## Building card filenames

`buildCardName` is the inverse of `parseCardName`:

```ts
buildCardName("Test", "memo")
=> Test.memo.card

buildCardName("Meeting_Tomorrow", "email-thread")
=> Meeting_Tomorrow.email-thread.card
```

## Checking card files

`isCardFile` is a simple extension check — any path ending in `.card`:

```ts
isCardFile("Test.memo.card")
=> true

isCardFile("/path/to/Test.memo.card")
=> true

isCardFile("Test.memo")
=> false

isCardFile("Test.card.bak")
=> false
```

## Box directory constants

`BOX_DIRS` defines the standard directory layout of a Bee Box:

```ts
BOX_DIRS.inbox
=> _content/inbox

BOX_DIRS.questions
=> _bookkeeping/questions

BOX_DIRS.archiveDone
=> _bookkeeping/archive/done
```

## `findBoxRoot` refuses a pre-v3 marker

A v3 box (`makeTmpBox`'s default scaffold) resolves normally:

```ts
const v3Box = await makeTmpBox();
(await findBoxRoot(v3Box.root)) === v3Box.root
=> true
```

```ts cleanup
await v3Box.cleanup();
```

A directory with NO marker anywhere above it still returns `null` — ordinary
"not a box" discovery is untouched:

```ts
const bareDir = await makeTmpBox();
const unmarkedSubdir = join(bareDir.root, "..", `bbx-doctest-unmarked-${String(Date.now())}`);
await mkdir(unmarkedSubdir, { recursive: true });
await findBoxRoot(unmarkedSubdir)
=> null
```

A marker whose `shapeVersion` predates 3 (the common "invoked from inside an
old v2 `content/` root" case) throws the migration-pointing error INSTEAD of
returning the directory — this is the fix for the original bug: `bbx tick`
run from inside such a directory used to silently resolve it as a valid box
root, find nothing under `_config/schedules`, and report zero-work success:

```ts continue
const v2ContentRoot = join(bareDir.root, "v2-content");
await mkdir(join(v2ContentRoot, ".beebox"), { recursive: true });
await writeFile(join(v2ContentRoot, ".beebox", "box.json"), JSON.stringify({ shapeVersion: 2 }));
await findBoxRootThrowsPreV3(v2ContentRoot)
=> true
```

A marker with NO `shapeVersion` field at all (predates the field entirely)
throws the same way:

```ts continue
const noVersionRoot = join(bareDir.root, "no-version");
await mkdir(join(noVersionRoot, ".beebox"), { recursive: true });
await writeFile(join(noVersionRoot, ".beebox", "box.json"), JSON.stringify({}));
await findBoxRootThrowsPreV3(noVersionRoot)
=> true
```

```ts cleanup
await bareDir.cleanup();
```
