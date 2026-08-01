# Wire client — direct contract exercise

Exercises `checkHashes`/`putFile` against a real HTTP server (the fake in
`test/fake-scan-server.ts`), covering the parts of
`docs/scan-upload-contract.md` that `run-target.doctest.md`'s higher-level
flow doesn't isolate on its own: the batch check response shapes, and a PUT
retrying through a 429 before succeeding.

```ts setup
import { checkHashes, putFile } from "../src/wire-client.js";
import { startFakeScanServer, type FakeScanServer } from "./fake-scan-server.js";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeTmpDir, removeTmpDir } from "./tmp-dir.js";

const dir = await makeTmpDir("wire-client");
const filePath = join(dir, "page1.pdf");
await writeFile(filePath, "scan bytes");
```

`checkHashes` parses the per-hash state map, including a `rejected` entry's
reason:

```
const server1: FakeScanServer = await startFakeScanServer({
  checkState: (hash) => {
    if (hash === "aaa") return { state: "unknown" };
    if (hash === "bbb") return { state: "pending" };
    if (hash === "ccc") return { state: "imported" };
    return { state: "rejected", reason: "magic bytes say text/html but extension is .pdf" };
  },
  putOutcome: () => ({ status: 200, body: { status: "accepted" } }),
});
const connection1 = { serverUrl: server1.url, box: "family", token: "test-token" };
const states = await checkHashes(connection1, ["aaa", "bbb", "ccc", "ddd"]);
JSON.stringify(Object.fromEntries(states), null, 2)
=>
{
  "aaa": {
    "state": "unknown"
  },
  "bbb": {
    "state": "pending"
  },
  "ccc": {
    "state": "imported"
  },
  "ddd": {
    "state": "rejected",
    "reason": "magic bytes say text/html but extension is .pdf"
  }
}
```

```cleanup
await server1.close();
```

`putFile` sends the bearer token, the sanitized-server-side filename header,
and the raw bytes — the fake server's request log lets us assert on exactly
what went over the wire:

```
const server2: FakeScanServer = await startFakeScanServer({
  checkState: () => ({ state: "unknown" }),
  putOutcome: () => ({ status: 200, body: { status: "accepted" } }),
});
const connection2 = { serverUrl: server2.url, box: "family", token: "secret-123" };
const result = await putFile(connection2, { hash: "deadbeef", filePath });
JSON.stringify(result)
=> {"status":"accepted"}
```

```continue
const [sent] = server2.putRequests;
sent.authorization
=> Bearer secret-123
```

```continue
sent.filename
=> page1.pdf
```

```continue
sent.body.toString("utf-8")
=> scan bytes
```

```cleanup
await server2.close();
```

A PUT that hits the rate limit reports `rate-limited` with the server's
`Retry-After`; the caller (`run-target.ts`) is the layer that sleeps and
resumes — `putFile` itself just reports the outcome once:

```
const server3: FakeScanServer = await startFakeScanServer({
  checkState: () => ({ state: "unknown" }),
  putOutcome: () => ({ status: 429, retryAfterSeconds: 2 }),
});
const connection3 = { serverUrl: server3.url, box: "family", token: "t" };
const limited = await putFile(connection3, { hash: "abc123", filePath });
JSON.stringify(limited)
=> {"status":"rate-limited","retryAfterSeconds":2}
```

```cleanup
await server3.close();
await removeTmpDir(dir);
```
