# Recovering a card path from Git after a miss

The normal card read happens before this helper is called. Once that read has
reported `ENOENT`, the helper can recover an unstaged filesystem move without
changing the real Git index.

```ts setup
import { rename } from "node:fs/promises";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { parseGitRenameRecords, resolveMovedCardPath } from "../../src/core/moved-card-forwarding.js";

const CARD = `---
type: memo
title: A card with enough content for rename detection
---
The body stays recognizable when the card moves to another directory.
`;
```

```ts
const box = await makeTmpBox({ git: true });
await box.seed("_content/Old.memo.card", CARD);
box.commitAll("seed old card");
await box.seed("_content/archive/.keep", "");
await rename(box.path("_content/Old.memo.card"), box.path("_content/archive/New.memo.card"));

JSON.stringify(await resolveMovedCardPath({ boxRoot: box.root, missingPath: "_content/Old.memo.card" }))
=> {"kind":"moved","path":"_content/archive/New.memo.card"}
```

The scratch lookup did not stage either end in the real index.

```ts continue
const status = (await import("simple-git")).simpleGit(box.root);
const realIndex = await status.diff(["--cached", "--name-status"]);
realIndex
=> 
```

If a new card reuses the old path, that card wins before historical recovery.

```ts continue
await box.seed("_content/Old.memo.card", CARD.replace("title: A card", "title: Reused path"));
JSON.stringify(await resolveMovedCardPath({ boxRoot: box.root, missingPath: "_content/Old.memo.card" }))
=> {"kind":"not-moved"}
```

```ts cleanup
await box.cleanup();
```

## Committed and chained moves

A committed rename is read from the latest commit that touched the old path.
The same lookup follows a committed move into a second, still-uncommitted move.

```ts
const chain = await makeTmpBox({ git: true });
await chain.seed("_content/First.memo.card", CARD);
chain.commitAll("seed first path");
await rename(chain.path("_content/First.memo.card"), chain.path("_content/Second.memo.card"));
chain.commitAll("first move");
await rename(chain.path("_content/Second.memo.card"), chain.path("_content/Third.memo.card"));

JSON.stringify(await resolveMovedCardPath({ boxRoot: chain.root, missingPath: "_content/First.memo.card" }))
=> {"kind":"moved","path":"_content/Third.memo.card"}
```

```ts cleanup
await chain.cleanup();
```

## Directory moves are recovered per card

Git reports the cards inside a renamed directory as ordinary rename records,
so the resolver needs no separate directory-forwarding format.

```ts
const directory = await makeTmpBox({ git: true });
await directory.seed("_content/session/Note.memo.card", CARD);
directory.commitAll("seed session");
await rename(directory.path("_content/session"), directory.path("_content/archive-session"));

JSON.stringify(await resolveMovedCardPath({
  boxRoot: directory.root,
  missingPath: "_content/session/Note.memo.card",
}))
=> {"kind":"moved","path":"_content/archive-session/Note.memo.card"}
```

```ts cleanup
await directory.cleanup();
```

## Failing closed

An incomplete or unsafe record is not enough to navigate. A box without Git
also keeps the ordinary not-found result and reports the recovery failure to
the supplied warning boundary.

```ts
const plain = await makeTmpBox();
const warnings: string[] = [];
const result = await resolveMovedCardPath({
  boxRoot: plain.root,
  missingPath: "_content/Gone.memo.card",
  warn: message => warnings.push(message),
});
print(JSON.stringify(result));
warnings.length
=>
{"kind":"not-moved"}
1
```

```ts cleanup
await plain.cleanup();
```

The NUL parser preserves unusual filenames and rejects truncated records.

```ts
JSON.stringify(parseGitRenameRecords("R100\0_content/Old name.card\0_content/New\tname.card\0"))
=> [{"from":"_content/Old name.card","to":"_content/New\tname.card"}]

parseGitRenameRecords("R100\0_content/only-one-path.card\0")
=> null
```
