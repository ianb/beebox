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

async function rejectedMessage(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "(no error thrown)";
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
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
```

An unexpected `check` status whose body carries a `reason` gets that reason
appended to the error, instead of leaving the boxholder to curl the
endpoint by hand to find out why (a 503 the client has no specific
`checkHashes` handling for — unlike `putFile`'s dedicated 503 case):

```
const server4: FakeScanServer = await startFakeScanServer({
  checkState: () => ({ state: "unknown" }),
  checkFailure: () => ({
    status: 503,
    body: { status: "server-error", reason: "box is not annex-converted; scan upload disabled" },
  }),
  putOutcome: () => ({ status: 200, body: { status: "accepted" } }),
});
const connection4 = { serverUrl: server4.url, box: "family", token: "t" };
const checkFailureMessage = await rejectedMessage(checkHashes(connection4, ["aaa"]));
checkFailureMessage.endsWith(
  "check returned HTTP 503 — server says: box is not annex-converted; scan upload disabled",
)
=> true
```

```cleanup
await server4.close();
```

A `reason` longer than ~200 chars is truncated rather than dumped whole
(guards against a server echoing something like a stack trace as the
field):

```
const longReason = "x".repeat(250);
const server5: FakeScanServer = await startFakeScanServer({
  checkState: () => ({ state: "unknown" }),
  checkFailure: () => ({ status: 503, body: { reason: longReason } }),
  putOutcome: () => ({ status: 200, body: { status: "accepted" } }),
});
const connection5 = { serverUrl: server5.url, box: "family", token: "t" };
const longReasonMessage = await rejectedMessage(checkHashes(connection5, ["aaa"]));
longReasonMessage.includes("x".repeat(200) + "…")
=> true
```

```continue
longReasonMessage.includes("x".repeat(201))
=> false
```

```cleanup
await server5.close();
```

`putFile` gets the same treatment for a status it has no specific case for
(anything besides 200/422/413/429/503) — here the reason comes from a
`message` field, checked when `reason` is absent:

```
const server6: FakeScanServer = await startFakeScanServer({
  checkState: () => ({ state: "unknown" }),
  putOutcome: () => ({ status: 500, body: { message: "database is in read-only mode" } }),
});
const connection6 = { serverUrl: server6.url, box: "family", token: "t" };
const putFailureMessage = await rejectedMessage(putFile(connection6, { hash: "abc123", filePath }));
putFailureMessage.endsWith("unexpected HTTP status 500 — server says: database is in read-only mode")
=> true
```

```cleanup
await server6.close();
await removeTmpDir(dir);
```
