# Time Utilities

Stubbable time for scenario testing. Resolution: `CB_TIME` env var → `stubs.yaml` in parent dir → real time.

```ts setup
import { getBoxTime, getBoxTimeISO, clearTimeCache } from "../../../src/cli/lib/time.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import * as fs from "node:fs";
import * as path from "node:path";
```

## Default: real time

Without any stubs, `getBoxTime()` returns approximately now:

```ts
const now = Date.now();
const boxTime = getBoxTime();
Math.abs(boxTime.getTime() - now) < 1000
=> true
```

## CB_TIME environment variable

The `CB_TIME` env var overrides time globally:

```ts
process.env.CB_TIME = "2025-06-15T12:00:00Z";
getBoxTime().toISOString()
=> 2025-06-15T12:00:00.000Z
```

```ts continue
getBoxTimeISO()
=> 2025-06-15T12:00:00.000Z
```

```ts cleanup
delete process.env.CB_TIME;
```

## CB_TIME takes priority over stubs.yaml

```ts
const box = await makeTmpBox();
const stubsPath = path.join(box.root, "../stubs.yaml");
fs.writeFileSync(stubsPath, "time: 2025-01-01T00:00:00Z\n");
clearTimeCache();
process.env.CB_TIME = "2025-12-25T00:00:00Z";
getBoxTimeISO(box.root)
=> 2025-12-25T00:00:00.000Z
```

```ts cleanup
delete process.env.CB_TIME;
fs.unlinkSync(stubsPath);
clearTimeCache();
await box.cleanup();
```

## stubs.yaml in parent directory

When a `stubs.yaml` file exists in the parent of the box root, its `time` field is used:

```ts
const box = await makeTmpBox();
const stubsPath = path.join(box.root, "../stubs.yaml");
fs.writeFileSync(stubsPath, "time: 2025-07-04T10:30:00Z\n");
clearTimeCache();
getBoxTimeISO(box.root)
=> 2025-07-04T10:30:00.000Z
```

```ts cleanup
fs.unlinkSync(stubsPath);
clearTimeCache();
await box.cleanup();
```

## Missing stubs.yaml falls back to real time

```ts
const box = await makeTmpBox();
clearTimeCache();
const now = Date.now();
const boxTime = getBoxTime(box.root);
Math.abs(boxTime.getTime() - now) < 1000
=> true
```

```ts cleanup
clearTimeCache();
await box.cleanup();
```

## Cache persists across calls

The stubs.yaml result is cached per box root:

```ts
const box = await makeTmpBox();
const stubsPath = path.join(box.root, "../stubs.yaml");
fs.writeFileSync(stubsPath, "time: 2025-03-01T00:00:00Z\n");
clearTimeCache();
print(getBoxTimeISO(box.root));
fs.writeFileSync(stubsPath, "time: 2025-09-01T00:00:00Z\n");
print(getBoxTimeISO(box.root));
=>
2025-03-01T00:00:00.000Z
2025-03-01T00:00:00.000Z
```

```ts cleanup
fs.unlinkSync(stubsPath);
clearTimeCache();
await box.cleanup();
```

## clearTimeCache resets the cache

```ts
const box = await makeTmpBox();
const stubsPath = path.join(box.root, "../stubs.yaml");
fs.writeFileSync(stubsPath, "time: 2025-03-01T00:00:00Z\n");
clearTimeCache();
print(getBoxTimeISO(box.root));
fs.writeFileSync(stubsPath, "time: 2025-09-01T00:00:00Z\n");
clearTimeCache();
print(getBoxTimeISO(box.root));
=>
2025-03-01T00:00:00.000Z
2025-09-01T00:00:00.000Z
```

```ts cleanup
fs.unlinkSync(stubsPath);
clearTimeCache();
await box.cleanup();
```

## getBoxTimeISO returns ISO string

```ts
process.env.CB_TIME = "2025-06-15T12:00:00Z";
typeof getBoxTimeISO()
=> string
```

```ts continue
getBoxTimeISO().endsWith("Z")
=> true
```

```ts cleanup
delete process.env.CB_TIME;
```
