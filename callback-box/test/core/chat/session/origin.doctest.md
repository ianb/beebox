# `localOrigin` — which machine holds a chat's transcript

A transcript lives in one engine store on one machine. `localOrigin()` names
that machine so a husk can record it (`docs/plans/chat-session-identity.md`,
Track 2): a stable UUID minted once at `~/.local/share/cb/origin-id`, plus the
current hostname as a display label. The hostname is never the id — a laptop
renames itself when its network location changes.

```ts setup
import * as os from "node:os";
import { readFile, writeFile } from "node:fs/promises";
import { makeTmpBox } from "../../../helpers/doctest-helpers.js";
import { localOrigin } from "../../../../src/core/chat/session/origin.js";
```

## the first read mints the id; later reads return the same one

`CB_ORIGIN_ID_FILE` points the helper somewhere other than the real per-user
state dir — nothing else about the behaviour changes.

```ts
const box = await makeTmpBox();
process.env["CB_ORIGIN_ID_FILE"] = box.path("origin-id");

const first = await localOrigin();
/^[0-9a-f-]{36}$/.test(first.id)
=> true

first.name === os.hostname()
=> true

const onDisk = (await readFile(box.path("origin-id"), "utf-8")).trim();
onDisk === first.id
=> true

const second = await localOrigin();
second.id === first.id
=> true
```

```ts cleanup
delete process.env["CB_ORIGIN_ID_FILE"];
await box.cleanup();
```

## an existing id is read, never replaced

```ts
const box = await makeTmpBox();
await writeFile(box.path("origin-id"), "b0d1e2f3-4567-4890-abcd-ef0123456789\n");
process.env["CB_ORIGIN_ID_FILE"] = box.path("origin-id");

(await localOrigin()).id
=> b0d1e2f3-4567-4890-abcd-ef0123456789
```

```ts cleanup
delete process.env["CB_ORIGIN_ID_FILE"];
await box.cleanup();
```

## a corrupt file is an error, not a fresh identity

A missing file is the ordinary first-run case. A file that holds something
other than a UUID was edited or truncated by something else, and quietly
replacing it would re-origin every session this machine holds — every one of
them would start reading as if it had run elsewhere.

```ts
const box = await makeTmpBox();
await writeFile(box.path("origin-id"), "not-a-uuid\n");
process.env["CB_ORIGIN_ID_FILE"] = box.path("origin-id");

await localOrigin()
=> throws CorruptOriginIdError
```

```ts cleanup
delete process.env["CB_ORIGIN_ID_FILE"];
await box.cleanup();
```
