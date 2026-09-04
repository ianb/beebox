# Files API — writes, conflicts, commits

`PUT /api/files/*` creates or overwrites; `POST /api/files/*` appends;
both accept etag preconditions for mid-air collision detection and return
the file's new metadata. `POST /api/files-commit` commits a file and its
attachments — nothing else. Writes never auto-commit (interactive views
are chatty); git state rides on view metadata instead.

```ts setup
import { makeTestServer } from "../../helpers/doctest-server.js";
import { getStatus } from "../../../src/lib/git.js";
```

## PUT creates (with parent dirs) and returns the file's identity

```ts
const ctx = await makeTestServer();
const res = await ctx.request({
  method: "PUT",
  url: "/api/files/_content/playground/Playground.attach/sessions/history.jsonl",
  payload: { content: '{"summary":"first"}\n' },
});
res.statusCode
=> 201

res.body.file.path
=> _content/playground/Playground.attach/sessions/history.jsonl

res.body.file.size
=> 20

typeof res.body.file.etag
=> string
```

## POST appends; the returned identity moves

```ts continue
const appended = await ctx.request({
  method: "POST",
  url: "/api/files/_content/playground/Playground.attach/sessions/history.jsonl",
  payload: { content: '{"summary":"second"}\n' },
});
appended.statusCode
=> 200

appended.body.file.size
=> 41

appended.body.file.etag !== res.body.file.etag
=> true
```

## A write asserting a stale version conflicts with 412 + current state

```ts continue
const stale = await ctx.request({
  method: "PUT",
  url: "/api/files/_content/playground/Playground.attach/sessions/history.jsonl",
  payload: { content: "clobber" },
  headers: { "if-match": res.body.file.etag },
});
stale.statusCode
=> 412

stale.body.error
=> File changed since it was read

stale.body.current.etag === appended.body.file.etag
=> true

const fresh = await ctx.request({
  method: "PUT",
  url: "/api/files/_content/playground/Playground.attach/sessions/history.jsonl",
  payload: { content: "rewritten\n" },
  headers: { "if-match": appended.body.file.etag },
});
fresh.statusCode
=> 200
```

## Create-only (If-None-Match: *) conflicts when the file appeared

```ts continue
const createOnly = await ctx.request({
  method: "PUT",
  url: "/api/files/_content/playground/Playground.attach/sessions/history.jsonl",
  payload: { content: "x" },
  headers: { "if-none-match": "*" },
});
createOnly.statusCode
=> 412

createOnly.body.error
=> File already exists
```

## Cards and escapes are rejected

```ts continue
(await ctx.request({ method: "PUT", url: "/api/files/_content/notes/A.memo.card", payload: { content: "x" } })).statusCode
=> 403

// Fastify resolves dot-segments before routing, so a traversal never even
// reaches the handler (404); the handler's own resolve-guard (403) backstops
// any encoded form that slips through routing.
(await ctx.request({ method: "PUT", url: "/api/files/_content/../../outside.txt", payload: { content: "x" } })).statusCode
=> 404
```

A path outside the underscore areas — `src/`, `node_modules/`, or any other
root entry — is rejected too, even though it stays inside the box (Track B's
namespace fence):

```ts continue
(await ctx.request({ method: "PUT", url: "/api/files/src/tricks/scripts/x.ts", payload: { content: "x" } })).statusCode
=> 403
```

## files-commit sweeps the file's card + attach scope, nothing else

```ts continue
await ctx.seed("_content/playground/Playground.doc.card", "---\ntitle: Playground\n---\nbody\n");
await ctx.seed("_content/notes/unrelated.md", "left dirty on purpose\n");
const commit = await ctx.request({
  method: "POST",
  url: "/api/files-commit",
  payload: { path: "_content/playground/Playground.attach/sessions/history.jsonl", message: "Save session history" },
});
commit.statusCode
=> 200

commit.body.committed
=> true

commit.body.paths.join(", ")
=> _content/playground/Playground.doc.card, _content/playground/Playground.attach

const status = await getStatus(ctx.boxRoot);
status.untracked.some((p) => p.includes("unrelated"))
=> true

status.untracked.some((p) => p.includes("Playground"))
=> false
```

Committing again with nothing changed is a no-op:

```ts continue
const again = await ctx.request({
  method: "POST",
  url: "/api/files-commit",
  payload: { path: "_content/playground/Playground.attach/sessions/history.jsonl", message: "noop" },
});
again.body.committed
=> false
```

## View metadata carries gitStatus until a commit clears it

```ts continue
await ctx.seedView("pg.tsx", `
export const name = "PG";
export const description = "pg";
export const dependencies = ["_content/playground/**/*.jsonl", "_content/notes/**/*.md"];
export const modes = ["page"];
export default function PG() { return null; }
`);
const data = await ctx.request({ method: "GET", url: "/api/views/pg/cards" });
const byPath = Object.fromEntries(data.body.files.map((f) => [f.path, f.gitStatus]));
byPath["_content/notes/unrelated.md"]
=> untracked

JSON.stringify(byPath["_content/playground/Playground.attach/sessions/history.jsonl"])
=> undefined
```

```ts cleanup
await ctx.cleanup();
```
