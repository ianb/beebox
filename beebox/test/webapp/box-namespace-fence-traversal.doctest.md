# The box namespace fence resolves the RESOLVED path, not the raw request string

Every route that serves, writes, lists, or deletes a box-relative path from a
request now resolves it via `resolveBoxNamespacePath` (`src/lib/box-namespace-resolve.ts`),
which checks the namespace fence against the RESOLVED filesystem path. Before
this fix, several routes checked `isInBoxNamespace` on the raw, un-normalized
request string instead — a traversal form like `_content/../package.json`
starts with `_content` (so the raw-string check passed) but *resolves* to
`package.json`, outside the namespace (`docs/implemented-plans/one-root-box-layout.md`
Track B).

A normal HTTP client (including Fastify's own `inject()`) collapses a literal
`../` in a URL before the request line is built, so it can't reach the
vulnerable un-normalized code path over HTTP — the traversal has to arrive
percent-encoded (`%2e%2e` / `%2f`) so Fastify's router doesn't normalize it
away, and only decodes it into the wildcard param that the route handler
actually sees. This mirrors how a real attacker (or a non-normalizing proxy)
would reach it, and is enough to prove the fix without a raw socket.

```ts setup
import { mkdir, readFile, writeFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { makeTestServer, TEST_SLUG } from "../helpers/doctest-server.js";
import { cardRouter } from "../../src/webapp/trpc/routers/card.js";
import { statusRouter } from "../../src/webapp/trpc/routers/status.js";
import { historyRouter } from "../../src/webapp/trpc/routers/history.js";
import { errorMessage } from "../../src/lib/error-guards.js";

/** The message a display-form-rejecting tRPC procedure throws, or "ok". */
async function trpcDisplayFormMessage(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "ok";
  } catch (e) {
    return errorMessage(e);
  }
}

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

## `card.get` suggests the bare display form's canonical path on refusal

A bare content path (`recipes/Soup.recipe.card`, the boxholder's display
vocabulary) names nothing inside any underscore area, so `card.get`'s
canonical `path` input refuses it as an escape — but when
`/_content/<path>` genuinely exists, the refusal message suggests it
(`docs/plans/display-path-guard.subplan.md`):

```ts continue
await server.seed("_content/recipes/Soup.recipe.card", "---\ntype: doc\ntitle: Soup\n---\n");
await trpcDisplayFormMessage(() => cardRouter.createCaller(ctx).get({ path: "recipes/Soup.recipe.card" }))
=> Invalid card path — did you mean `/_content/recipes/Soup.recipe.card`?
```

No suggestion when the content-form path doesn't exist either:

```ts continue
await trpcDisplayFormMessage(() => cardRouter.createCaller(ctx).get({ path: "nowhere/at/all.card" }))
=> Invalid card path
```

## Display-form paths (`docs/plans/display-path-guard.subplan.md`)

`Config:box.json` (the boxholder's CONVERSATION vocabulary — never a
canonical path) is rejected with 400 / `BAD_REQUEST` and a message naming
the canonical form, at every choke point above — distinct from the generic
403/empty-listing a genuine namespace escape gets:

```ts continue
const filesDisplayRes = await server.request({ method: "GET", url: "/api/files/Config:box.json" });
filesDisplayRes.statusCode
=> 400

filesDisplayRes.body.error
=> `Config:box.json` is the boxholder's display form; write `/_config/box.json`

const browseDisplayRes = await server.request({ method: "GET", url: "/api/browse/Config:box.json" });
browseDisplayRes.statusCode
=> 400

const imageDisplayRes = await server.request({ method: "GET", url: "/api/image/Config:box.json" });
imageDisplayRes.statusCode
=> 400

const figureDisplayRes = await server.request({ method: "GET", url: "/api/figure/module.js?path=Config:box.json" });
figureDisplayRes.statusCode
=> 400
```

```ts continue
await trpcDisplayFormMessage(() => cardRouter.createCaller(ctx).get({ path: "Config:box.json" }))
=> `Config:box.json` is the boxholder's display form; write `/_config/box.json`

await trpcDisplayFormMessage(() => statusRouter.createCaller(ctx).browse({ path: "Bookkeeping:jobs/x.job.card" }))
=> `Bookkeeping:jobs/x.job.card` is the boxholder's display form; write `/_bookkeeping/jobs/x.job.card`

await trpcDisplayFormMessage(() =>
  historyRouter.createCaller(ctx).list({ filter: { path: "Config:box.json" } })
)
=> `Config:box.json` is the boxholder's display form; write `/_config/box.json`
```

```ts cleanup
await server.cleanup();
```

## The `_content/pkg` → package-root SYMLINK escape (one-root layout)

Percent-encoded `..` (above) is one way to reach outside the namespace; the
one-root layout adds a second: a SYMLINK. `_content/pkg` here is a real
symlink pointing at `..` — the box root, which in this layout is ALSO the npm
package root (`package.json`, `src/`, `node_modules/`). No lexical `..`
appears in the request path at all, so this is a genuinely different attack
from the traversal-string one above; it needs the on-disk (`realpath`) check,
not just the resolved-path check. Every verb — read, write, browse, and
`card.get` — is refused:

```ts
const symServer = await makeTestServer();
await writeFile(join(symServer.boxRoot, "package.json"), '{"name":"secret-marker-2"}');
await symlink("..", join(symServer.boxRoot, "_content/pkg"));

const symGetRes = await symServer.request({ method: "GET", url: "/api/files/_content/pkg/package.json" });
symGetRes.statusCode
=> 403

const symPutRes = await symServer.request({
  method: "PUT",
  url: "/api/files/_content/pkg/package.json",
  payload: { content: "pwned-via-symlink" },
});
symPutRes.statusCode
=> 403
```

`package.json` on disk is untouched by the write attempt:

```ts continue
const symPkgJsonPath = join(symServer.boxRoot, "package.json");
const symPkgJsonAfter = await readFile(symPkgJsonPath, "utf-8");
symPkgJsonAfter.includes("secret-marker-2")
=> true
```

Browsing straight into the symlinked directory (the browse target itself IS
the symlink) is refused too — not just deeper paths through it:

```ts continue
const symBrowseRes = await symServer.request({ method: "GET", url: "/api/browse/_content/pkg" });
symBrowseRes.statusCode
=> 403

const symBrowseDeeperRes = await symServer.request({ method: "GET", url: "/api/browse/_content/pkg/src" });
symBrowseDeeperRes.statusCode
=> 403
```

`card.get` (tRPC) refuses the same path:

```ts continue
const symCtx: TestCtx = { boxRoot: symServer.boxRoot, boxSlug: "t", user: null, authed: true, isOwner: true };
await cardGetThrows(symCtx, "_content/pkg/package.json")
=> true
```

`status.browse` (tRPC) refuses it too — an empty listing, not the package
directory's contents:

```ts continue
const symStatusBrowseRes = await statusRouter.createCaller(symCtx).browse({ path: "_content/pkg" });
JSON.stringify(symStatusBrowseRes)
=> {"path":"_content/pkg","dirs":[],"cards":[],"files":[]}
```

`files.summarize` (tRPC) refuses it — no `package.json` content leaks through
the batch summary endpoint:

```ts continue
const symFilesRouterModule = await import("../../src/webapp/trpc/routers/files.js");
const symSummarizeRes = await symFilesRouterModule.filesRouter.createCaller(symCtx).summarize({
  paths: ["_content/pkg/package.json"],
});
symSummarizeRes[0]
=> null
```

```ts cleanup
await symServer.cleanup();
```

## Annex-style leaf symlinks still serve on read (no regression)

The on-disk fence must not break the shape git-annex actually uses: a raw box
file whose leaf component is itself a symlink resolving OUTSIDE the box
(`.git/annex/objects/...`) still serves its bytes on a plain GET — only a
directory symlink partway down the path (above) is refused, not a leaf file
symlink:

```ts
const annexServer = await makeTestServer();
await mkdir(join(annexServer.boxRoot, ".git/annex/objects/xx/yy"), { recursive: true });
await writeFile(join(annexServer.boxRoot, ".git/annex/objects/xx/yy/real.txt"), "real annexed bytes");
await mkdir(join(annexServer.boxRoot, "_content/inbox"), { recursive: true });
await symlink(
  join(annexServer.boxRoot, ".git/annex/objects/xx/yy/real.txt"),
  join(annexServer.boxRoot, "_content/inbox/annexed.txt"),
);

const annexGetRes = await annexServer.rawRequest({ method: "GET", url: "/api/files/_content/inbox/annexed.txt" });
annexGetRes.statusCode
=> 200

annexGetRes.payload
=> real annexed bytes
```

The same leaf symlink refuses a write or delete through it — an existing leaf
symlink resolving outside the box is never writable, only readable:

```ts continue
const annexPutRes = await annexServer.request({
  method: "PUT",
  url: "/api/files/_content/inbox/annexed.txt",
  payload: { content: "overwritten" },
});
annexPutRes.statusCode
=> 403

const annexDeleteRes = await annexServer.request({ method: "DELETE", url: "/api/files/_content/inbox/annexed.txt" });
annexDeleteRes.statusCode
=> 403
```

```ts cleanup
await annexServer.cleanup();
```

## Round-6 hardening: a browse CHILD symlink can't leak out-of-namespace frontmatter

The directory fence above (`/api/browse/_content/pkg`) only checks the
listing TARGET. A separate hazard: the target directory itself is fine, but
one CHILD entry inside it is a symlink whose target resolves outside the
namespace (e.g. `_content/alias.memo.card -> ../src/private.memo.card`) —
before this fix, the child loop's `loadCardFrontmatter` followed that symlink
and returned the external card's frontmatter straight into the listing. The
escaping child is now silently omitted; a normal sibling card still lists.

```ts
const escServer = await makeTestServer();
await mkdir(join(escServer.boxRoot, "src"), { recursive: true });
await writeFile(
  join(escServer.boxRoot, "src", "private.memo.card"),
  '---\nstatus: secret\ncreated: "2026-01-01T00:00:00.000Z"\n---\nPrivate.\n',
);
await escServer.seed("_content/Normal.memo.card", '---\nstatus: new\ncreated: "2026-01-01T00:00:00.000Z"\n---\nNormal.\n');
await symlink(join("..", "src", "private.memo.card"), join(escServer.boxRoot, "_content", "alias.memo.card"));

const escBrowseRes = await escServer.request({ method: "GET", url: "/api/browse/_content" });
JSON.stringify({
  names: escBrowseRes.body.cards.map((c) => c.name).sort(),
  statuses: escBrowseRes.body.cards.map((c) => c.status),
})
=> {"names":["Normal"],"statuses":["new"]}
```

```ts cleanup
await escServer.cleanup();
```
