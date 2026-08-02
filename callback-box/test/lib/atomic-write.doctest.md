# `writeFileAtomic` — crash-safe replace that preserves the target's mode

`fs.writeFile` truncates in place, so a crash mid-write leaves a torn store;
`writeFileAtomic` goes temp → fsync → rename so the target is always either
the old complete file or the new one. Because the rename replaces the inode,
it must also carry the old file's permissions forward — otherwise every save
of a `0600` credential store would silently loosen it to the umask default
(caught by cross-model review, 2026-08-01).

```ts setup
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { writeFileAtomic } from "../../src/lib/atomic-write.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atomic-write-"));
const target = path.join(dir, "store.json");
```

## Replaces content atomically and leaves no temp siblings

```ts
await writeFileAtomic(target, { content: '{"v":1}\n' });
await writeFileAtomic(target, { content: '{"v":2}\n' });
print(fs.readFileSync(target, "utf-8").trim());
print(`siblings: ${fs.readdirSync(dir).join(",")}`);
=> {"v":2}
siblings: store.json
```

## An existing target's mode survives a rewrite without an explicit `mode`

```ts
fs.chmodSync(target, 0o600);
await writeFileAtomic(target, { content: '{"v":3}\n' });
print((fs.statSync(target).mode & 0o777).toString(8));
=> 600
```

## An explicit `mode` wins

```ts
await writeFileAtomic(target, { content: '{"v":4}\n', mode: 0o640 });
print((fs.statSync(target).mode & 0o777).toString(8));
=> 640
```

## A brand-new file gets the platform default (not a stat failure)

```ts
const fresh = path.join(dir, "brand-new.json");
await writeFileAtomic(fresh, { content: "x\n" });
print(fs.existsSync(fresh));
=> true
```

```ts cleanup
fs.rmSync(dir, { recursive: true, force: true });
```
