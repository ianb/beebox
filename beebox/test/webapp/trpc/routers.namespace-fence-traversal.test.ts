// # The box namespace fence resolves the RESOLVED path, not the raw request string
//
// Every route that serves, writes, lists, or deletes a box-relative path from a
// request now resolves it via `resolveBoxNamespacePath` (`src/lib/box-namespace-resolve.ts`),
// which checks the namespace fence against the RESOLVED filesystem path. Before
// this fix, several routes checked `isInBoxNamespace` on the raw, un-normalized
// request string instead — a traversal form like `_content/../package.json`
// starts with `_content` (so the raw-string check passed) but *resolves* to
// `package.json`, outside the namespace (`docs/implemented-plans/one-root-box-layout.md`
// Track B).
//
// A normal HTTP client (including Fastify's own `inject()`) collapses a literal
// `../` in a URL before the request line is built, so it can't reach the
// vulnerable un-normalized code path over HTTP — the traversal has to arrive
// percent-encoded (`%2e%2e` / `%2f`) so Fastify's router doesn't normalize it
// away, and only decodes it into the wildcard param that the route handler
// actually sees. This mirrors how a real attacker (or a non-normalizing proxy)
// would reach it, and is enough to prove the fix without a raw socket.

import { test } from "tap";
import "agent-doctest/tap";
import { mkdir, readFile, writeFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { makeTestServer } from "../../helpers/test-route-server.js";
import { trpcContext } from "../../helpers/trpc-context.js";
import { cardRouter } from "../../../src/webapp/trpc/routers/card.js";
import { statusRouter } from "../../../src/webapp/trpc/routers/status.js";
import { historyRouter } from "../../../src/webapp/trpc/routers/history.js";
import type { TrpcContext } from "../../../src/webapp/trpc/context.js";
import { errorMessage } from "../../../src/shared/error-guards.js";

/** The message a display-form-rejecting tRPC procedure throws, or "ok". */
async function trpcDisplayFormMessage(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "ok";
  } catch (e) {
    return errorMessage(e);
  }
}

/** An owner context for the box at `boxRoot`; the fence under test reads only the path. */
function ownerCtx(boxRoot: string): TrpcContext {
  return trpcContext({ boxRoot, boxSlug: "t", isAuthenticatedOwner: true });
}

/** The `error` string of a JSON error body. */
function errorOf(body: unknown): unknown {
  return typeof body === "object" && body !== null && "error" in body ? body.error : undefined;
}

/** The `cards` array of a browse response body. */
function cardsOf(body: unknown): { name: string; conflict?: boolean }[] {
  if (typeof body !== "object" || body === null || !("cards" in body) || !Array.isArray(body.cards)) {
    throw new Error("browse body has no cards array");
  }
  return body.cards;
}

/** Whether `card.get(cardPath)` throws (any error — the fence rejects with BAD_REQUEST). */
async function cardGetThrows(ctx: TrpcContext, cardPath: string): Promise<boolean> {
  try {
    await cardRouter.createCaller(ctx).get({ path: cardPath });
    return false;
  } catch (_e) {
    return true;
  }
}

const server = await makeTestServer();
async function writePackageMarker(boxRoot: string, marker: string): Promise<void> {
  const packagePath = join(boxRoot, "package.json");
  const packageJson = await readFile(packagePath, "utf-8");
  await writeFile(packagePath, packageJson.replace(/"name": "[^"]+"/, `"name": "${marker}"`));
}
await writePackageMarker(server.boxRoot, "secret-marker");

// ## `/api/files/*` (GET, PUT, POST, DELETE)
//
// A traversal form that starts inside `_content/` but resolves to `package.json`
// is refused on every verb — not served, not written, not deleted:
void test("A traversal form that starts inside content/ but resolves to package.json is...", async (t) => {
  t.teardown(async () => {
    try {
      await server.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L85
  const getRes = await server.request({ method: "GET", url: "/api/files/_content%2f..%2fpackage.json" });
  t.check(getRes.statusCode, 403);

  // doctest:L89
  const putRes = await server.request({
    method: "PUT",
    url: "/api/files/_content%2f..%2fpackage.json",
    payload: { content: "pwned" },
  });
  t.check(putRes.statusCode, 403);

  // doctest:L97
  const deleteRes = await server.request({ method: "DELETE", url: "/api/files/_content%2f..%2fpackage.json" });
  t.check(deleteRes.statusCode, 403);

  // `package.json` on disk is untouched by the write attempt:

  // doctest:L105
  const pkgJsonPath = join(server.boxRoot, "package.json");
  const packageJsonAfter = await readFile(pkgJsonPath, "utf-8");
  await t.checkText(packageJsonAfter.includes("secret-marker"), "true");

  // ## `/api/files-commit`

  // doctest:L114
  const commitRes = await server.request({
    method: "POST",
    url: "/api/files-commit",
    payload: { path: "_content%2f..%2fpackage.json", message: "pwn" },
  });
  t.check(commitRes.statusCode, 403);

  // ## `/api/browse/*`
  //
  // A traversal that resolves to `src/` (outside the namespace) 403s rather than
  // listing it:

  // doctest:L129
  const browseRes = await server.request({ method: "GET", url: "/api/browse/_content%2f..%2fsrc" });
  t.check(browseRes.statusCode, 403);

  // ## `/api/image/*`

  // doctest:L137
  await server.seed("_content/photo.jpg", "fake-jpeg-bytes");
  const imageRes = await server.request({ method: "GET", url: "/api/image/_content%2f..%2fpackage.json" });
  t.check(imageRes.statusCode, 403);

  // ## `/api/figure/module.js`

  // doctest:L146
  const figureRes = await server.request({ method: "GET", url: "/api/figure/module.js?path=_content%2f..%2fpackage.json" });
  t.check(figureRes.statusCode, 400);

  // ## `/api/history/blob/:hash/*`
  //
  // The history blob route has no filesystem resolve step (`git show` treats the
  // path as repo-root-relative), so the fence normalizes with
  // `path.posix.normalize` instead — same bypass shape, same fix:

  // doctest:L158
  server.commitAll("seed commit");
  const hash = execFileSync("git", ["rev-parse", "HEAD"], { cwd: server.boxRoot, encoding: "utf-8" }).trim();
  const historyUrl = "/api/history/blob/" + hash + "/_content%2f..%2fpackage.json";
  const historyRes = await server.rawRequest({ method: "GET", url: historyUrl });
  t.check(historyRes.statusCode, 403);

  // ## `card.get` / `card.inboundRefs` / `card.trash` (tRPC)
  //
  // tRPC input travels as a plain string (no URL encoding involved), so the raw
  // traversal string reaches `resolveCardPath` directly:

  // doctest:L172
  const ctx = ownerCtx(server.boxRoot);
  t.check(await cardGetThrows(ctx, "_content/../package.json"), true);

  // ## `status.browse` (tRPC)

  // doctest:L180
  const statusBrowseRes = await statusRouter.createCaller(ctx).browse({ path: "_content/../src" });
  t.check(statusBrowseRes, {
    path: "_content/../src",
    dirs: [],
    cards: [],
    files: [],
    background: false,
  });

  // ## `files.summarize` (tRPC) — the straggler
  //
  // `files.summarize` reads arbitrary file CONTENT (not just metadata) for a
  // batch of paths — an unfenced traversal here would leak `package.json`/`src/*`
  // content through the batch summary endpoint. It's now fenced too:

  // doctest:L192
  const filesRouterModule = await import("../../../src/webapp/trpc/routers/files/router.js");
  const summarizeRes = await filesRouterModule.filesRouter.createCaller(ctx).summarize({
    paths: ["_content/../package.json"],
  });
  t.check(summarizeRes[0], null);

  // ## `card.get` suggests the bare display form's canonical path on refusal
  //
  // A bare content path (`recipes/Soup.recipe.card`, the boxholder's display
  // vocabulary) names nothing inside any underscore area, so `card.get`'s
  // canonical `path` input refuses it as an escape — but when
  // `/_content/<path>` genuinely exists, the refusal message suggests it
  // (`docs/plans/display-path-guard.subplan.md`):

  // doctest:L209
  await server.seed("_content/recipes/Soup.recipe.card", "---\ntype: doc\ntitle: Soup\n---\n");
  t.check(await trpcDisplayFormMessage(() => cardRouter.createCaller(ctx).get({ path: "recipes/Soup.recipe.card" })), "Invalid card path — did you mean `/_content/recipes/Soup.recipe.card`?");

  // No suggestion when the content-form path doesn't exist either:

  // doctest:L217
  t.check(await trpcDisplayFormMessage(() => cardRouter.createCaller(ctx).get({ path: "nowhere/at/all.card" })), "Invalid card path");

  // ## Display-form paths (`docs/plans/display-path-guard.subplan.md`)
  //
  // `Config:box.json` (the boxholder's CONVERSATION vocabulary — never a
  // canonical path) is rejected with 400 / `BAD_REQUEST` and a message naming
  // the canonical form, at every choke point above — distinct from the generic
  // 403/empty-listing a genuine namespace escape gets:

  // doctest:L229
  const filesDisplayRes = await server.request({ method: "GET", url: "/api/files/Config:box.json" });
  t.check(filesDisplayRes.statusCode, 400);

  // doctest:L233
  t.check(errorOf(filesDisplayRes.body), "`Config:box.json` is the boxholder's display form; write `/_config/box.json`");

  // doctest:L236
  const browseDisplayRes = await server.request({ method: "GET", url: "/api/browse/Config:box.json" });
  t.check(browseDisplayRes.statusCode, 400);

  // doctest:L240
  const imageDisplayRes = await server.request({ method: "GET", url: "/api/image/Config:box.json" });
  t.check(imageDisplayRes.statusCode, 400);

  // doctest:L244
  const figureDisplayRes = await server.request({ method: "GET", url: "/api/figure/module.js?path=Config:box.json" });
  t.check(figureDisplayRes.statusCode, 400);

  // doctest:L250
  t.check(await trpcDisplayFormMessage(() => cardRouter.createCaller(ctx).get({ path: "Config:box.json" })), "`Config:box.json` is the boxholder's display form; write `/_config/box.json`");

  // doctest:L253
  t.check(await trpcDisplayFormMessage(() => statusRouter.createCaller(ctx).browse({ path: "Bookkeeping:jobs/x.job.card" })), "`Bookkeeping:jobs/x.job.card` is the boxholder's display form; write `/_bookkeeping/jobs/x.job.card`");

  // doctest:L256
  t.check(
    await trpcDisplayFormMessage(() =>
      historyRouter.createCaller(ctx).list({ filter: { path: "Config:box.json" } })
    ),
    "`Config:box.json` is the boxholder's display form; write `/_config/box.json`",
  );
});

// ## The `_content/pkg` → package-root SYMLINK escape (one-root layout)
//
// Percent-encoded `..` (above) is one way to reach outside the namespace; the
// one-root layout adds a second: a SYMLINK. `_content/pkg` here is a real
// symlink pointing at `..` — the box root, which in this layout is ALSO the npm
// package root (`package.json`, `src/`, `node_modules/`). No lexical `..`
// appears in the request path at all, so this is a genuinely different attack
// from the traversal-string one above; it needs the on-disk (`realpath`) check,
// not just the resolved-path check. Every verb — read, write, browse, and
// `card.get` — is refused:
void test("Percent-encoded .. (above) is one way to reach outside the namespace; the one...", async (t) => {
  t.teardown(async () => {
    try {
      await symServer.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L278
  const symServer = await makeTestServer();
  await writePackageMarker(symServer.boxRoot, "secret-marker-2");
  await symlink("..", join(symServer.boxRoot, "_content/pkg"));

  // doctest:L282
  const symGetRes = await symServer.request({ method: "GET", url: "/api/files/_content/pkg/package.json" });
  t.check(symGetRes.statusCode, 403);

  // doctest:L286
  const symPutRes = await symServer.request({
    method: "PUT",
    url: "/api/files/_content/pkg/package.json",
    payload: { content: "pwned-via-symlink" },
  });
  t.check(symPutRes.statusCode, 403);

  // `package.json` on disk is untouched by the write attempt:

  // doctest:L298
  const symPkgJsonPath = join(symServer.boxRoot, "package.json");
  const symPkgJsonAfter = await readFile(symPkgJsonPath, "utf-8");
  await t.checkText(symPkgJsonAfter.includes("secret-marker-2"), "true");

  // Browsing straight into the symlinked directory (the browse target itself IS
  // the symlink) is refused too — not just deeper paths through it:

  // doctest:L308
  const symBrowseRes = await symServer.request({ method: "GET", url: "/api/browse/_content/pkg" });
  t.check(symBrowseRes.statusCode, 403);

  // doctest:L312
  const symBrowseDeeperRes = await symServer.request({ method: "GET", url: "/api/browse/_content/pkg/src" });
  t.check(symBrowseDeeperRes.statusCode, 403);

  // `card.get` (tRPC) refuses the same path:

  // doctest:L320
  const symCtx = ownerCtx(symServer.boxRoot);
  t.check(await cardGetThrows(symCtx, "_content/pkg/package.json"), true);

  // `status.browse` (tRPC) refuses it too — an empty listing, not the package
  // directory's contents:

  // doctest:L329
  const symStatusBrowseRes = await statusRouter.createCaller(symCtx).browse({ path: "_content/pkg" });
  t.check(symStatusBrowseRes, {
    path: "_content/pkg",
    dirs: [],
    cards: [],
    files: [],
    background: false,
  });

  // `files.summarize` (tRPC) refuses it — no `package.json` content leaks through
  // the batch summary endpoint:

  // doctest:L338
  const symFilesRouterModule = await import("../../../src/webapp/trpc/routers/files/router.js");
  const symSummarizeRes = await symFilesRouterModule.filesRouter.createCaller(symCtx).summarize({
    paths: ["_content/pkg/package.json"],
  });
  t.check(symSummarizeRes[0], null);
});

// ## Annex-style leaf symlinks still serve on read (no regression)
//
// The on-disk fence must not break the shape git-annex actually uses: a raw box
// file whose leaf component is itself a symlink resolving OUTSIDE the box
// (`.git/annex/objects/...`) still serves its bytes on a plain GET — only a
// directory symlink partway down the path (above) is refused, not a leaf file
// symlink:
void test("The on-disk fence must not break the shape git-annex actually uses:", async (t) => {
  t.teardown(async () => {
    try {
      await annexServer.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L359
  const annexServer = await makeTestServer();
  await mkdir(join(annexServer.boxRoot, ".git/annex/objects/xx/yy"), { recursive: true });
  await writeFile(join(annexServer.boxRoot, ".git/annex/objects/xx/yy/real.txt"), "real annexed bytes");
  await mkdir(join(annexServer.boxRoot, "_content/inbox"), { recursive: true });
  await symlink(
    join(annexServer.boxRoot, ".git/annex/objects/xx/yy/real.txt"),
    join(annexServer.boxRoot, "_content/inbox/annexed.txt"),
  );

  // doctest:L368
  const annexGetRes = await annexServer.rawRequest({ method: "GET", url: "/api/files/_content/inbox/annexed.txt" });
  t.check(annexGetRes.statusCode, 200);

  // doctest:L372
  t.check(annexGetRes.payload, "real annexed bytes");

  // The same leaf symlink refuses a write or delete through it — an existing leaf
  // symlink resolving outside the box is never writable, only readable:

  // doctest:L380
  const annexPutRes = await annexServer.request({
    method: "PUT",
    url: "/api/files/_content/inbox/annexed.txt",
    payload: { content: "overwritten" },
  });
  t.check(annexPutRes.statusCode, 403);

  // doctest:L388
  const annexDeleteRes = await annexServer.request({ method: "DELETE", url: "/api/files/_content/inbox/annexed.txt" });
  t.check(annexDeleteRes.statusCode, 403);
});

// ## Round-6 hardening: a browse CHILD symlink can't leak out-of-namespace frontmatter
//
// The directory fence above (`/api/browse/_content/pkg`) only checks the
// listing TARGET. A separate hazard: the target directory itself is fine, but
// one CHILD entry inside it is a symlink whose target resolves outside the
// namespace (e.g. `_content/alias.doc.card -> ../src/private.doc.card`) —
// before this fix, the child loop's `loadCardFrontmatter` followed that symlink
// and returned the external card's frontmatter straight into the listing. The
// escaping child is now silently omitted; a normal sibling card still lists.
void test("The directory fence above (/api/browse/content/pkg) only checks the listing T...", async (t) => {
  t.teardown(async () => {
    try {
      await escServer.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L408
  const escServer = await makeTestServer();
  await mkdir(join(escServer.boxRoot, "src"), { recursive: true });
  await writeFile(
    join(escServer.boxRoot, "src", "private.doc.card"),
    "---\nconflict: true\ntitle: Private\n---\nPrivate.\n",
  );
  await escServer.seed("_content/Normal.doc.card", "---\ntitle: Normal\n---\nNormal.\n");
  await symlink(join("..", "src", "private.doc.card"), join(escServer.boxRoot, "_content", "alias.doc.card"));

  // doctest:L417
  const escBrowseRes = await escServer.request({ method: "GET", url: "/api/browse/_content" });
  t.check(
    {
      names: cardsOf(escBrowseRes.body).map((c) => c.name).toSorted(),
      conflicts: cardsOf(escBrowseRes.body).map((c) => c.conflict === true),
    },
    {
    names: [
      "Normal",
    ],
    conflicts: [
      false,
    ],
  },
  );
});
