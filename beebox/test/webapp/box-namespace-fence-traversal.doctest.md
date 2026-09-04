# The box namespace fence resolves the RESOLVED path, not the raw request string

Every route that serves, writes, lists, or deletes a box-relative path from a
request now resolves it via `resolveBoxNamespacePath` (`src/lib/box-namespace-resolve.ts`),
which checks the namespace fence against the RESOLVED filesystem path. Before
this fix, several routes checked `isInBoxNamespace` on the raw, un-normalized
request string instead — a traversal form like `_content/../package.json`
starts with `_content` (so the raw-string check passed) but *resolves* to
`package.json`, outside the namespace (`docs/plans/one-root-box-layout.md`
Track B).

A normal HTTP client (including Fastify's own `inject()`) collapses a literal
`../` in a URL before the request line is built, so it can't reach the
vulnerable un-normalized code path over HTTP — the traversal has to arrive
percent-encoded (`%2e%2e` / `%2f`) so Fastify's router doesn't normalize it
away, and only decodes it into the wildcard param that the route handler
actually sees. This mirrors how a real attacker (or a non-normalizing proxy)
would reach it, and is enough to prove the fix without a raw socket.

```ts setup
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { makeTestServer, TEST_SLUG } from "../helpers/doctest-server.js";
import { cardRouter } from "../../src/webapp/trpc/routers/card.js";
import { statusRouter } from "../../src/webapp/trpc/routers/status.js";

interface TestCtx {
  boxRoot: string;
  boxSlug: string;
  user: null;
  authed: boolean;
  isOwner: boolean;
}

/** Whether `card.get(cardPath)` throws (any error — the fence rejects with BAD_REQUEST). */
async function cardGetThrows(ctx: TestCtx, cardPath: string): Promise<boolean> {
  try {
    await cardRouter.createCaller(ctx).get({ path: cardPath });
    return false;
  } catch (_e) {
    return true;
  }
}

const server = await makeTestServer();
await writeFile(join(server.boxRoot, "package.json"), '{"name":"secret-marker"}');
```

## `/api/files/*` (GET, PUT, POST, DELETE)

A traversal form that starts inside `_content/` but resolves to `package.json`
is refused on every verb — not served, not written, not deleted:

```ts
const getRes = await server.request({ method: "GET", url: "/api/files/_content%2f..%2fpackage.json" });
getRes.statusCode
=> 403

const putRes = await server.request({
  method: "PUT",
  url: "/api/files/_content%2f..%2fpackage.json",
  payload: { content: "pwned" },
});
putRes.statusCode
=> 403

const deleteRes = await server.request({ method: "DELETE", url: "/api/files/_content%2f..%2fpackage.json" });
deleteRes.statusCode
=> 403
```

`package.json` on disk is untouched by the write attempt:

```ts continue
const pkgJsonPath = join(server.boxRoot, "package.json");
const packageJsonAfter = await readFile(pkgJsonPath, "utf-8");
packageJsonAfter.includes("secret-marker")
=> true
```

## `/api/files-commit`

```ts continue
const commitRes = await server.request({
  method: "POST",
  url: "/api/files-commit",
  payload: { path: "_content%2f..%2fpackage.json", message: "pwn" },
});
commitRes.statusCode
=> 403
```

## `/api/browse/*`

A traversal that resolves to `src/` (outside the namespace) 403s rather than
listing it:

```ts continue
const browseRes = await server.request({ method: "GET", url: "/api/browse/_content%2f..%2fsrc" });
browseRes.statusCode
=> 403
```

## `/api/image/*`

```ts continue
await server.seed("_content/photo.jpg", "fake-jpeg-bytes");
const imageRes = await server.request({ method: "GET", url: "/api/image/_content%2f..%2fpackage.json" });
imageRes.statusCode
=> 403
```

## `/api/figure/module.js`

```ts continue
const figureRes = await server.request({ method: "GET", url: "/api/figure/module.js?path=_content%2f..%2fpackage.json" });
figureRes.statusCode
=> 400
```

## `/api/history/blob/:hash/*`

The history blob route has no filesystem resolve step (`git show` treats the
path as repo-root-relative), so the fence normalizes with
`path.posix.normalize` instead — same bypass shape, same fix:

```ts continue
server.commitAll("seed commit");
const hash = execFileSync("git", ["rev-parse", "HEAD"], { cwd: server.boxRoot, encoding: "utf-8" }).trim();
const historyUrl = "/api/history/blob/" + hash + "/_content%2f..%2fpackage.json";
const historyRes = await server.rawRequest({ method: "GET", url: historyUrl });
historyRes.statusCode
=> 403
```

## `card.get` / `card.inboundRefs` / `card.trash` (tRPC)

tRPC input travels as a plain string (no URL encoding involved), so the raw
traversal string reaches `resolveCardPath` directly:

```ts continue
const ctx: TestCtx = { boxRoot: server.boxRoot, boxSlug: "t", user: null, authed: true, isOwner: true };
await cardGetThrows(ctx, "_content/../package.json")
=> true
```

## `status.browse` (tRPC)

```ts continue
const statusBrowseRes = await statusRouter.createCaller(ctx).browse({ path: "_content/../src" });
JSON.stringify(statusBrowseRes)
=> {"path":"_content/../src","dirs":[],"cards":[],"files":[]}
```

## `files.summarize` (tRPC) — the straggler

`files.summarize` reads arbitrary file CONTENT (not just metadata) for a
batch of paths — an unfenced traversal here would leak `package.json`/`src/*`
content through the batch summary endpoint. It's now fenced too:

```ts continue
const filesRouterModule = await import("../../src/webapp/trpc/routers/files.js");
const summarizeRes = await filesRouterModule.filesRouter.createCaller(ctx).summarize({
  paths: ["_content/../package.json"],
});
summarizeRes[0]
=> null
```

```ts cleanup
await server.cleanup();
```
