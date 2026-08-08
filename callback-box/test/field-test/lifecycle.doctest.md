# Field-test run lifecycle

A field run owns a disposable box and a dedicated server
(`docs/plans/agent-field-tests.md`, Track 2). This exercises the real thing —
a real `cb init`, a real `cb serve` on a real free port — because the failures
this module exists to catch (a marker written to the package root instead of
the operational box root, a server that never comes up, a child left running
after teardown) are all invisible to a mocked version.

```ts setup
import { mkdtemp, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { createFieldBox, TEST_BOX_MARKER } from "../../src/field-test/run-box.js";
import { startFieldServer, allocateFreePort, serverProcessAlive } from "../../src/field-test/run-server.js";
import { fileExists } from "../../src/lib/file-exists.js";
import { getStatus } from "../../src/lib/git.js";
```

## A free port is a real, unbound port

```ts
const port = await allocateFreePort();
port > 1024 && port < 65536
=> true

const second = await allocateFreePort();
second !== port
=> true
```

## Create a box, serve it, tear it down

`createFieldBox` puts the box at `<runDir>/box` — a v2 package whose
operational root is its `content/` — and writes the test-box marker relative to
that operational root, which is where the `CB_FAKE_GMAIL` gate (Track 1) will
look for it.

```ts
const runDir = await mkdtemp(join(tmpdir(), "cb-field-run-"));
const box = await createFieldBox(runDir);
[relative(runDir, box.packageRoot), relative(runDir, box.boxRoot), box.slug].join(" | ")
=> box | box/content | box

await fileExists(join(box.boxRoot, TEST_BOX_MARKER))
=> true

// Not at the package root — the marker is a property of the operational box.
await fileExists(join(box.packageRoot, TEST_BOX_MARKER))
=> false
```

The baseline is committed, so a later `reset` cleanup policy has something to
rewind to:

```ts continue
const status = await getStatus(box.packageRoot);
status.clean
=> true
```

The server starts on its own port and answers `/` before `startFieldServer`
returns. `baseUrl` is what the harness hands browse as `BROWSE_BASE_URL`.

```ts continue
const server = await startFieldServer(box, { env: { CB_TIME: "2026-08-08T09:00:00Z" } });
server.baseUrl === `${server.origin}/${box.slug}`
=> true

const response = await fetch(`${server.origin}/`);
response.status
=> 200
```

Teardown kills the child; nothing is left listening.

```ts continue
await server.stop();
serverProcessAlive(server)
=> false

const afterStop = await fetch(`${server.origin}/`).then(() => "still serving", () => "refused");
afterStop
=> refused
```

```ts cleanup
await rm(runDir, { recursive: true, force: true });
```

## A server that cannot start fails loudly

`cb serve` on a directory that is not a box exits non-zero. The harness must
hear about that before an operator session starts, with the child's own output
attached rather than a bare timeout.

```ts
const emptyDir = await mkdtemp(join(tmpdir(), "cb-field-empty-"));
const notABox = { packageRoot: emptyDir, boxRoot: emptyDir, slug: "nope" };

await startFieldServer(notABox, { env: {}, readyTimeoutMs: 20_000 })
=> throws FieldServerStartError
```

```ts cleanup
await rm(emptyDir, { recursive: true, force: true });
```
