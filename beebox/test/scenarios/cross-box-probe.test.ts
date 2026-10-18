// # Cross-box leak probe
//
// beebox's isolation posture is **environment-level, single-OS-user**: every box
// on a server is a directory scope inside one Node process, run by one system
// user, with no per-box process sandbox, container, or filesystem permission
// boundary. What separates box A from box B is: each box's own routes only ever
// touch `ctx.boxRoot` for that box (the per-box auth wall picks it from the URL
// slug), each box's credentials (agent bearer token, secrets grants, event bus)
// are scoped to its own slug/root, and every path a request supplies is expected
// to stay inside `ctx.boxRoot` — enforced piecemeal, route by route.
//
// This file is the regression anchor for that piecemeal enforcement: with only
// box A's own valid credentials in hand, can a request reach box B's data
// through box A's scope, or reach box B's scope directly? It proves that
// specific surfaces fail closed. It does **not** prove the environment-level
// posture itself — a box agent's shell/filesystem tools are not sandboxed away
// from other boxes on the same host, and that is accepted, out of scope here.
// It also does not cover the hub's child-process isolation (`bbx hub` spawning
// per-box `bbx serve` children) — that is `test/hub/supervisor.doctest.md`'s
// job. This file is entirely about ONE server process holding two boxes at
// once, which is exactly `createTwoBoxTestServer`'s shape.
//
// Every probe below holds only **box A's (`alpha`) own credentials** — its
// agent bearer, or (for the owner-gated secrets procedure) a fabricated
// authenticated-owner context for `alpha` — and tries to reach box B
// (`beta`)'s seeded confidential content through `alpha`'s own scope or by
// addressing `beta` directly. tRPC procedures are called the way every other
// router doctest calls them, via `appRouter.createCaller(ctx)` with a `ctx`
// shaped like what the real per-box auth wall would hand a request already
// authenticated to `alpha` (see `test/webapp/trpc/procedures.doctest.md`,
// `test/webapp/trpc/routers/secrets.doctest.md`) — this exercises the SAME procedure
// code the real HTTP/tRPC transport would call after auth admits the request;
// what differs is skipping the transport's own auth-header parsing, which is
// `two-box-fixture.doctest.md`'s job, not this file's. Raw Fastify routes go
// through real `server.inject()` with `alpha`'s actual bearer header.

import { test } from "tap";
import "agent-doctest/tap";
import { printed } from "agent-doctest/check";
import { TRPCError } from "@trpc/server";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { execSync } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTwoBoxTestServer, commitAll } from "../helpers/test-server.js";
import { silentEventBus, trpcContext } from "../helpers/trpc-context.js";
import { createFakeChatBackend } from "../../src/services/claude-chat/core.js";
import { appRouter } from "../../src/webapp/trpc/routers.js";
import { setAndGrantSecret } from "../../src/core/secrets/lifecycle.js";
import { boxSlug } from "../../src/lib/box-slug.js";
import type { EventBus } from "../../src/core/event-bus/core.js";

const BETA_MARKER = "BETA-SECRET-MARKER-9f3c1a";

/** A tRPC caller authenticated to `alpha` (or any given box), the shape the
 *  real per-box auth wall constructs after admitting a request. */
function callerFor(boxRoot: string, eventBus?: EventBus) {
  return appRouter.createCaller(trpcContext({
    boxRoot,
    boxSlug: "alpha",
    eventBus: eventBus ?? silentEventBus,
    user: { email: "owner@example.com", name: "Owner" },
    isAuthenticatedOwner: true,
  }));
}

/** Run a tRPC call, reporting either its result or the error code. */
async function attempt<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; code: string | undefined }> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    return { ok: false, code: e instanceof TRPCError ? e.code : undefined };
  }
}

// ## Seed box B with recognizable confidential content
//
// A card with a unique marker string, a landmark card (with a distinctive
// feature flag) in a subdirectory, and a git commit so history/blob probes have
// a real hash that exists only in B's repo.
void test("A card with a unique marker string, a landmark card (with a distinctive featu...", async (t) => {
  const out = printed();
  const print = out.print;
  t.teardown(async () => {
    try {
      await ctx.cleanup();
      await fs.rm(tmpRoot, { recursive: true, force: true });
      await fs.rm(secretsDir, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L84
  const ctx = await createTwoBoxTestServer();

  // doctest:L86
  await fs.mkdir(path.join(ctx.b.boxRoot, "_content"), { recursive: true });
  await fs.writeFile(
    path.join(ctx.b.boxRoot, "_content", "Marker.doc.card"),
    `---\ntitle: Beta marker title\n---\n${BETA_MARKER}\n`,
  );
  await fs.mkdir(path.join(ctx.b.boxRoot, "_content", "sub"), { recursive: true });
  await fs.writeFile(
    path.join(ctx.b.boxRoot, "_content", "sub", "Landmark.landmark.card"),
    "---\nnavigation:\n  label: BetaLandmark\n  chat-app:\n    narration: on\n---\n",
  );
  await commitAll(ctx.b.boxRoot, "seed beta marker + landmark");
  const betaHash = execSync("git log -1 --format=%H", { cwd: ctx.b.boxRoot, encoding: "utf-8" }).trim();

  // doctest:L99
  // A task-output file for beta, at the exact shape `isTaskOutputPathForBox`
  // expects (see task-output-route.doctest.md, which owns this surface — this
  // file includes one line so it stands as a complete anchor on its own).
  const { encodeProjectDir } = await import("../../src/core/chat/session/transcript-paths.js");
  const tmpRoot = await mkdtemp(join(tmpdir(), "claude-cross-box-probe-"));
  const taskDir = path.join(tmpRoot, encodeProjectDir(ctx.b.boxRoot), "sess-1", "tasks");
  await fs.mkdir(taskDir, { recursive: true });
  const betaTaskOutput = path.join(taskDir, "t1.output");
  await fs.writeFile(betaTaskOutput, BETA_MARKER);

  // doctest:L109
  // A secret granted to beta only (isolated store — see BBX_SECRETS_FILE in
  // test/helpers/isolate-secret-store.ts; this file points it at its own dir
  // so it doesn't collide with any other doctest's grants).
  const secretsDir = await mkdtemp(join(tmpdir(), "bbx-cross-box-secrets-"));
  process.env["BBX_SECRETS_FILE"] = join(secretsDir, "secrets.json");
  const betaSlug = await boxSlug(ctx.b.boxRoot);
  await setAndGrantSecret({ name: "beta-only-key", value: "placeholder-not-a-real-secret", slug: betaSlug, access: "agent" });

  // doctest:L117
  // Relative path from alpha's box root into beta's, computed from the real
  // (randomly-suffixed) boxRoots — never hardcoded "../..". The one-root
  // layout makes alpha and beta direct siblings (each `boxRoot` is its own
  // mkdtemp), so this is exactly one ".." segment.
  const relIntoBeta = path.relative(ctx.a.boxRoot, ctx.b.boxRoot);
  const relToBetaMarker = path.relative(ctx.a.boxRoot, path.join(ctx.b.boxRoot, "_content", "Marker.doc.card"));

  // doctest:L124
  await t.checkText(out.with(print("seeded")), "seeded");

  // ## 1. `GET /beta/api/files/*` and `GET /beta/api/browse/*` with A's bearer
  //
  // Alpha's bearer is unrecognized on beta's wall, and there is no session
  // cookie either — the same 401 `two-box-fixture.doctest.md` proves for
  // `/api/health`.

  // doctest:L136
  const filesRes = await ctx.server.inject({
    method: "GET",
    url: "/beta/api/files/Marker.doc.card",
    headers: { authorization: ctx.a.agentBearerHeader() },
  });
  print(`beta/api/files with alpha's bearer: ${filesRes.statusCode}`);

  // doctest:L143
  const browseRes = await ctx.server.inject({
    method: "GET",
    url: "/beta/api/browse/",
    headers: { authorization: ctx.a.agentBearerHeader() },
  });
  await t.checkText(out.with(print(`beta/api/browse with alpha's bearer: ${browseRes.statusCode}`)), `beta/api/files with alpha's bearer: 401
beta/api/browse with alpha's bearer: 401`);

  // ## 2. `GET /alpha/api/files/../../<into B>` and `?path=` on `/alpha/api/figure/module.js`
  //
  // The literal `..` segments in a `/api/files/*` wildcard path never reach the
  // route handler at all: Fastify's router (`find-my-way`) normalizes dot
  // segments before matching. The one-root layout makes alpha and beta direct
  // siblings, so `relToBetaMarker` climbs out with exactly one `..` — enough to
  // cancel `files` but not to leave `/api/*` — so
  // `/alpha/api/files/../<sibling>/_content/Marker.doc.card` collapses to
  // `/alpha/api/<sibling>/_content/Marker.doc.card`, an unmatched route under
  // `/api/*` that gets a plain JSON 404 rather than the browser-auth redirect a
  // path landing outside `/api/*` would get. Either way B's content is never
  // read or returned.

  // doctest:L168
  const filesTraversalUrl = `/alpha/api/files/${relToBetaMarker.split(path.sep).join("/")}`;
  const filesTraversal = await ctx.server.inject({
    method: "GET",
    url: filesTraversalUrl,
    headers: { authorization: ctx.a.agentBearerHeader() },
  });
  print(`files traversal: ${filesTraversal.statusCode}, contains marker: ${filesTraversal.payload.includes(BETA_MARKER)}`);
  // The redirect's `returnTo` echoes the (harmless) normalized filename it
  // bounced off of — that is not B's confidential content, only a path
  // fragment, so the load-bearing check is the marker's absence above.

  // doctest:L179
  // The `?path=` form (figure/module.js) reaches its own handler directly (no
  // wildcard-segment normalization to hide behind), and its own containment
  // check rejects it explicitly.
  const figureRes = await ctx.server.inject({
    method: "GET",
    url: `/alpha/api/figure/module.js?path=${encodeURIComponent(relToBetaMarker)}`,
    headers: { authorization: ctx.a.agentBearerHeader() },
  });
  await t.checkText(out.with(print(`figure ?path= traversal: ${figureRes.statusCode} ${figureRes.payload}`)), `files traversal: 404, contains marker: false
figure ?path= traversal: 400 {"error":"Path outside box"}`);

  // ## 3. tRPC on alpha: paths climbing into B
  //
  // `card.get`, `history.list` (its `filter.path`), and `landmarks.forDir` all
  // reject the escape outright (`BAD_REQUEST`). `status.browse`, `views.resolveRef`,
  // and `collections.query` degrade to an empty/not-found answer rather than throwing —
  // asserted as "does not contain B's marker" since an empty result is still a
  // safe result. An absolute path into B (rather than a `..`-relative one) is
  // included for `card.get`: `card.ts`'s `resolveCardPath` calls `boxRelativePath`
  // first, which only strips a *leading* slash (`src/shared/box-path.ts`), so the
  // absolute path becomes a nested box-relative lookup
  // (`<boxRoot>/tmp/.../_content/Marker...`) — but `resolveCardPath` then runs
  // that through the box namespace fence
  // (`resolveBoxNamespacePathOnDisk`, `docs/implemented-plans/one-root-box-layout.md` Track
  // B), and a path whose first segment is `tmp` rather than an underscore area
  // fails the namespace check before any filesystem read, so this shape 400s
  // (`BAD_REQUEST`) same as the relative-`..` shape. Still fail-closed either way
  // — B's card is never read.

  // doctest:L212
  const caller = callerFor(ctx.a.boxRoot, ctx.a.eventBus);
  const betaMarkerAbs = path.join(ctx.b.boxRoot, "_content", "Marker.doc.card");

  // doctest:L215
  const cardGetRel = await attempt(() => caller.card.get({ path: relToBetaMarker }));
  print(`card.get (relative ..): ${cardGetRel.ok ? "SUCCEEDED" : cardGetRel.code}`);

  // doctest:L218
  const cardGetAbs = await attempt(() => caller.card.get({ path: betaMarkerAbs }));
  print(`card.get (absolute): ${cardGetAbs.ok ? "SUCCEEDED" : cardGetAbs.code}`);

  // doctest:L221
  const browse = await caller.status.browse({ path: relIntoBeta });
  print(`status.browse: dirs=${browse.dirs.length} cards=${browse.cards.length} files=${browse.files.length}`);

  // doctest:L224
  const historyList = await attempt(() => caller.history.list({ filter: { path: relToBetaMarker } }));
  print(`history.list (filter.path): ${historyList.ok ? "SUCCEEDED" : historyList.code}`);

  // doctest:L227
  const viewsRef = await caller.views.resolveRef({ ref: relToBetaMarker, basePath: "" });
  print(`views.resolveRef: exists=${viewsRef.exists} title-is-filename-only=${viewsRef.title === "Marker"}`);

  // doctest:L230
  const landmarksForDir = await attempt(() => caller.landmarks.forDir({ dir: `${relIntoBeta}/_content/sub` }));
  print(`landmarks.forDir: ${landmarksForDir.ok ? "SUCCEEDED" : landmarksForDir.code}`);

  // doctest:L233
  const collectionsQuery = await attempt(() =>
    caller.collections.query({ collection: "todos", query: { here: relIntoBeta, params: { status: ["open"] } } })
  );
  await t.checkText(out.with(print(`collections.query (here): ${collectionsQuery.ok ? "SUCCEEDED" : collectionsQuery.code}`)), `card.get (relative ..): BAD_REQUEST
card.get (absolute): BAD_REQUEST
status.browse: dirs=0 cards=0 files=0
history.list (filter.path): BAD_REQUEST
views.resolveRef: exists=false title-is-filename-only=true
landmarks.forDir: BAD_REQUEST
collections.query (here): BAD_REQUEST`);

  // ### `files.summarize`
  //
  // `summarizePath` in `src/webapp/trpc/routers/files/router.ts` once normalized only
  // absolute inputs; it now runs every input through
  // `resolveBoxNamespacePathOnDisk`, which fences both `..`-relative escapes and
  // the box namespace. This step is the regression anchor and must keep printing
  // `false`.

  // doctest:L256
  const summarized = await caller.files.summarize({ paths: [relToBetaMarker] });
  const leaked = JSON.stringify(summarized).includes(BETA_MARKER) || JSON.stringify(summarized).includes("Beta marker title");
  await t.checkText(out.with(print(`files.summarize leaks beta's card: ${leaked}`)), "files.summarize leaks beta's card: false");

  // ### `files.kind`
  //
  // Answers only file, directory or missing, but "missing" versus "file" for a
  // sibling's path would still reveal that box's layout. The namespace guard
  // rejects the path before any `stat`.

  // doctest:L270
  const kindProbe = await attempt(() => caller.files.kind({ path: relToBetaMarker }));
  await t.checkText(out.with(print(`files.kind on beta's card: ${kindProbe.ok ? kindProbe.value.kind : kindProbe.code}`)), "files.kind on beta's card: BAD_REQUEST");

  // ## 4. `chatControl.reserveSession`, `chat.newFeatures` — the Deliverable 1 fix

  // doctest:L279
  const reserve = await attempt(() =>
    caller.chat.reserveSession({ sessionId: "11111111-1111-4111-8111-111111111111", contextDir: `${relIntoBeta}/_content/sub` }),
  );
  print(`chatControl.reserveSession: ${reserve.ok ? "SUCCEEDED" : reserve.code}`);

  // doctest:L284
  const newFeatures = await attempt(() => caller.chat.newFeatures({ contextDir: `${relIntoBeta}/_content/sub` }));
  await t.checkText(out.with(print(`chat.newFeatures: ${newFeatures.ok ? "SUCCEEDED" : newFeatures.code}`)), `chatControl.reserveSession: BAD_REQUEST
chat.newFeatures: BAD_REQUEST`);

  // ## 5. `GET /alpha/api/task-output?file=<B's task output>`
  //
  // Full coverage (including the `..`-in-path and symlink-escape variants) lives
  // in `test/webapp/routes/commands.task-output.doctest.md`; one line here keeps
  // this file a complete anchor.

  // doctest:L298
  const taskOutputRes = await ctx.server.inject({
    method: "GET",
    url: `/alpha/api/task-output?file=${encodeURIComponent(betaTaskOutput)}`,
    headers: { authorization: ctx.a.agentBearerHeader() },
  });
  await t.checkText(out.with(print(`task-output on beta's file, with alpha's bearer: ${taskOutputRes.statusCode}`)), "task-output on beta's file, with alpha's bearer: 403");

  // ## 6. `GET /alpha/api/session-media/...` — the ref format cannot name another box
  //
  // `parseSessionMediaRef` (`src/shared/session-media.ts`) constrains both ids to
  // `SAFE_ID_RE = /^[\w-]{1,64}$/` — no `.` or `/` — because both are interpolated
  // into a filesystem path. There is no way to write a ref containing a `/` or
  // `..`: the route is `/api/session-media/<sessionId>/<entryUuid>/<index>`, and
  // `sessionId` is then resolved via `resolveSessionLogPath(ctx.boxRoot, sessionId)`
  // — always against THIS box's own session history, never a caller-supplied
  // directory. So the surface can't even be pointed at another box's directory
  // by construction; the only thing to demonstrate is that a syntactically valid
  // ref naming a session alpha doesn't know about 404s rather than falling back
  // to reading anything.

  // doctest:L322
  const mediaRes = await ctx.server.inject({
    method: "GET",
    url: "/alpha/api/session-media/aaaaaaaa-1111-4111-8111-000000000000/some-entry-uuid/0",
    headers: { authorization: ctx.a.agentBearerHeader() },
  });
  await t.checkText(out.with(print(`session-media, unknown-to-alpha ref: ${mediaRes.statusCode}`)), "session-media, unknown-to-alpha ref: 404");

  // ## 7. `POST /alpha/api/chat/send` with `contextDir` climbing into B
  //
  // Fixed alongside Deliverable 1: `sendBodySchema.contextDir` (`chat-helpers.ts`)
  // now uses the same shared `boxRelativePathSchema`, so the request 400s before
  // `resolveSendTargetForRoute` ever runs. (Depth note, not asserted here: even
  // before that fix, the chat subprocess's cwd is always `ctx.boxRoot` —
  // `core/chat/session/thread.ts:169` hardcodes `cwd: this.boxRoot` — so an
  // escaping `contextDir` could never redirect the agent's own filesystem reach;
  // the only real exposure it opened was the landmark-feature seed, closed by
  // Deliverable 1's `readLandmarkFeaturesForDir` fix.)

  // doctest:L344
  const backend = createFakeChatBackend();
  const ctx2 = await createTwoBoxTestServer({ chatBackend: backend });
  const relIntoBeta2 = path.relative(ctx2.a.boxRoot, ctx2.b.boxRoot);

  // doctest:L348
  const sendRes = await ctx2.server.inject({
    method: "POST",
    url: "/alpha/api/chat/send",
    headers: { authorization: ctx2.a.agentBearerHeader(), "content-type": "application/json" },
    payload: { message: "hi", session: "new", contextDir: `${relIntoBeta2}/_content/sub` },
  });
  print(`chat/send with escaping contextDir: ${sendRes.statusCode}`);
  await t.checkText(out.with(await ctx2.cleanup()), "chat/send with escaping contextDir: 400");

  // ## 8. `history.diff` / `GET /alpha/api/history/blob/<hash>/...` with a hash that exists only in B
  //
  // Git runs in A's own repo (`simpleGit(ctx.boxRoot)`), so B's object is simply
  // absent from it — B's blob hash reaches alpha's git the same as any unknown
  // hash.

  // doctest:L367
  const diff = await caller.history.diff({ hash: betaHash });
  print(`history.diff on alpha with beta's hash: diff empty=${diff.diff === ""}`);

  // doctest:L370
  const blobRes = await ctx.server.inject({
    method: "GET",
    url: `/alpha/api/history/blob/${betaHash}/_content/Marker.doc.card`,
    headers: { authorization: ctx.a.agentBearerHeader() },
  });
  await t.checkText(out.with(print(`history/blob on alpha with beta's hash: ${blobRes.statusCode}`)), `history.diff on alpha with beta's hash: diff empty=true
history/blob on alpha with beta's hash: 404`);

  // ## 9. `POST /beta/api/secrets/resolve` with A's bearer; `secrets.boxStatus` never lists B's grant

  // doctest:L384
  const resolveRes = await ctx.server.inject({
    method: "POST",
    url: "/beta/api/secrets/resolve",
    headers: { authorization: ctx.a.agentBearerHeader(), "content-type": "application/json" },
    payload: { name: "beta-only-key", purpose: "agent-self-note" },
  });
  print(`beta/api/secrets/resolve with alpha's bearer: ${resolveRes.statusCode}`);

  // doctest:L392
  const alphaBoxStatus = await caller.secrets.boxStatus();
  await t.checkText(out.with(print(`alpha's secrets.boxStatus granted names: ${JSON.stringify(alphaBoxStatus.granted.map((g) => g.name))}`)), `beta/api/secrets/resolve with alpha's bearer: 401
alpha's secrets.boxStatus granted names: []`);

  // ## 10. Events: alpha's subscriber never sees an event emitted on beta's bus
  //
  // Each box gets its own `EventBus` instance (`createTwoBoxTestServer`); an
  // emit on one never reaches a reader of the other.

  // doctest:L405
  ctx.b.eventBus.emit("file-change", { event: "created", path: "BETA-MARKER.card", timestamp: new Date().toISOString() });
  const alphaEvents = ctx.a.eventBus.readSince(0);
  print(`alpha sees beta's emit: ${alphaEvents.length > 0}`);

  // doctest:L409
  const betaEvents = ctx.b.eventBus.readSince(0);
  await t.checkText(out.with(print(`beta sees its own emit: ${betaEvents.length > 0}`)), `alpha sees beta's emit: false
beta sees its own emit: true`);
});
