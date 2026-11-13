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
// per-box `bbx serve` children) — that is `test/hub/supervisor.test.ts`'s
// job. This file is entirely about ONE server process holding two boxes at
// once, which is exactly `createTwoBoxTestServer`'s shape.
//
// Every probe below holds only **box A's (`alpha`) own credentials** — its
// agent bearer, or (for the owner-gated secrets procedure) a fabricated
// authenticated-owner context for `alpha` — and tries to reach box B
// (`beta`)'s seeded confidential content through `alpha`'s own scope or by
// addressing `beta` directly. tRPC procedures are called the way every other
// router test calls them, via `appRouter.createCaller(ctx)` with a `ctx`
// shaped like what the real per-box auth wall would hand a request already
// authenticated to `alpha` (see `test/webapp/trpc/procedures.test.ts`,
// `test/webapp/trpc/routers/secrets.test.ts`) — this exercises the SAME procedure
// code the real HTTP/tRPC transport would call after auth admits the request;
// what differs is skipping the transport's own auth-header parsing, which is
// `test/scenarios/two-box-fixture.test.ts`'s job, not this file's. Raw Fastify routes go
// through real `server.inject()` with `alpha`'s actual bearer header.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any } from "@ianbicking/tap-check/check";
import { TRPCError } from "@trpc/server";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { execFileSync, execSync } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTwoBoxTestServer, commitAll } from "../helpers/test-server.js";
import { silentEventBus, trpcContext } from "../helpers/trpc-context.js";
import { consoleLines } from "../helpers/console-lines.js";
import { createFakeChatBackend } from "../../src/services/claude-chat/core.js";
import { appRouter } from "../../src/webapp/trpc/routers.js";
import { setAndGrantSecret } from "../../src/core/secrets/lifecycle.js";
import { boxSlug } from "../../src/lib/box-slug.js";
import type { EventBus } from "../../src/core/event-bus/core.js";
import { addSubscription } from "../../src/core/push-subscriptions.js";
import { saveQuestionLatch } from "../../src/core/question-alert.js";

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
  t.teardown(async () => {
    try {
      await ctx.cleanup();
      await fs.rm(tmpRoot, { recursive: true, force: true });
      await fs.rm(secretsDir, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  const ctx = await createTwoBoxTestServer();

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

  // A task-output file for beta, at the exact shape `isTaskOutputPathForBox`
  // expects (see test/webapp/routes/commands.task-output.test.ts, which owns this surface — this
  // file includes one line so it stands as a complete anchor on its own).
  const { encodeProjectDir } = await import("../../src/core/chat/session/transcript-paths.js");
  const tmpRoot = await mkdtemp(join(tmpdir(), "claude-cross-box-probe-"));
  const taskDir = path.join(tmpRoot, encodeProjectDir(await fs.realpath(ctx.b.boxRoot)), "sess-1", "tasks");
  await fs.mkdir(taskDir, { recursive: true });
  const betaTaskOutput = path.join(taskDir, "t1.output");
  await fs.writeFile(betaTaskOutput, BETA_MARKER);

  // A secret granted to beta only (isolated store — see BBX_SECRETS_FILE in
  // test/helpers/isolate-secret-store.ts; this file points it at its own dir
  // so it doesn't collide with any other test's grants).
  const secretsDir = await mkdtemp(join(tmpdir(), "bbx-cross-box-secrets-"));
  process.env["BBX_SECRETS_FILE"] = join(secretsDir, "secrets.json");
  const betaSlug = await boxSlug(ctx.b.boxRoot);
  await setAndGrantSecret({ name: "beta-only-key", value: "placeholder-not-a-real-secret", slug: betaSlug, access: "agent" });

  // Relative path from alpha's box root into beta's, computed from the real
  // (randomly-suffixed) boxRoots — never hardcoded "../..". The one-root
  // layout makes alpha and beta direct siblings (each `boxRoot` is its own
  // mkdtemp), so this is exactly one ".." segment.
  const relIntoBeta = path.relative(ctx.a.boxRoot, ctx.b.boxRoot);
  const relToBetaMarker = path.relative(ctx.a.boxRoot, path.join(ctx.b.boxRoot, "_content", "Marker.doc.card"));

  // ## 1. `GET /beta/api/files/*` and `GET /beta/api/browse/*` with A's bearer
  //
  // Alpha's bearer is unrecognized on beta's wall, and there is no session
  // cookie either — the same 401 `test/scenarios/two-box-fixture.test.ts` proves for
  // `/api/health`.

  const filesRes = await ctx.server.inject({
    method: "GET",
    url: "/beta/api/files/Marker.doc.card",
    headers: { authorization: ctx.a.agentBearerHeader() },
  });
  const browseRes = await ctx.server.inject({
    method: "GET",
    url: "/beta/api/browse/",
    headers: { authorization: ctx.a.agentBearerHeader() },
  });
  t.check({ files: filesRes.statusCode, browse: browseRes.statusCode }, { files: 401, browse: 401 });

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

  const filesTraversalUrl = `/alpha/api/files/${relToBetaMarker.split(path.sep).join("/")}`;
  const filesTraversal = await ctx.server.inject({
    method: "GET",
    url: filesTraversalUrl,
    headers: { authorization: ctx.a.agentBearerHeader() },
  });
  // The payload echoes the (harmless) normalized path it bounced off of, which is
  // not B's confidential content; the marker's absence is the point.
  t.check({ status: filesTraversal.statusCode, body: filesTraversal.json() }, { status: 404, body: { error: "Not found" } });

  // The `?path=` form (figure/module.js) reaches its own handler directly (no
  // wildcard-segment normalization to hide behind), and its own containment
  // check rejects it explicitly.
  const figureRes = await ctx.server.inject({
    method: "GET",
    url: `/alpha/api/figure/module.js?path=${encodeURIComponent(relToBetaMarker)}`,
    headers: { authorization: ctx.a.agentBearerHeader() },
  });
  t.check({ status: figureRes.statusCode, body: figureRes.json() }, { status: 400, body: { error: "Path outside box" } });

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

  const caller = callerFor(ctx.a.boxRoot, ctx.a.eventBus);
  const betaMarkerAbs = path.join(ctx.b.boxRoot, "_content", "Marker.doc.card");

  const cardGetRel = await attempt(() => caller.card.get({ path: relToBetaMarker }));
  t.check(cardGetRel, { ok: false, code: "BAD_REQUEST" });

  const cardGetAbs = await attempt(() => caller.card.get({ path: betaMarkerAbs }));
  t.check(cardGetAbs, { ok: false, code: "BAD_REQUEST" });

  const browse = await caller.status.browse({ path: relIntoBeta });
  t.check(browse, { path: relIntoBeta, dirs: [], cards: [], files: [], background: false });

  const historyList = await attempt(() => caller.history.list({ filter: { path: relToBetaMarker } }));
  t.check(historyList, { ok: false, code: "BAD_REQUEST" });

  const warnings = consoleLines(t, "warn");
  const viewsRef = await caller.views.resolveRef({ ref: relToBetaMarker, basePath: "" });
  t.check(viewsRef, { path: relToBetaMarker, title: "Marker", type: "doc", exists: false });
  // The server log names the ref that tried to leave the box:
  t.check(warnings(), [`views.resolveRef: ref "${relToBetaMarker}" (base "") escapes the box`]);

  const landmarksForDir = await attempt(() => caller.landmarks.forDir({ dir: `${relIntoBeta}/_content/sub` }));
  t.check(landmarksForDir, { ok: false, code: "BAD_REQUEST" });

  const collectionsQuery = await attempt(() =>
    caller.collections.query({ collection: "todos", query: { here: relIntoBeta, params: { status: ["open"] } } })
  );
  t.check(collectionsQuery, { ok: false, code: "BAD_REQUEST" });

  // ### `files.summarize`
  //
  // `summarizePath` in `src/webapp/trpc/routers/files/router.ts` once normalized only
  // absolute inputs; it now runs every input through
  // `resolveBoxNamespacePathOnDisk`, which fences both `..`-relative escapes and
  // the box namespace. This step is the regression anchor: the result must hold
  // none of B's content.

  const summarized = await caller.files.summarize({ paths: [relToBetaMarker] });
  t.check(summarized, [null]);

  // ### `files.kind`
  //
  // Answers only file, directory or missing, but "missing" versus "file" for a
  // sibling's path would still reveal that box's layout. The namespace guard
  // rejects the path before any `stat`.

  const kindProbe = await attempt(() => caller.files.kind({ path: relToBetaMarker }));
  t.check(kindProbe, { ok: false, code: "BAD_REQUEST" });

  // ## 4. `chatControl.reserveSession`, `chat.newFeatures` — the Deliverable 1 fix

  const reserve = await attempt(() =>
    caller.chat.reserveSession({ sessionId: "11111111-1111-4111-8111-111111111111", contextDir: `${relIntoBeta}/_content/sub` }),
  );
  t.check(reserve, { ok: false, code: "BAD_REQUEST" });

  const newFeatures = await attempt(() => caller.chat.newFeatures({ contextDir: `${relIntoBeta}/_content/sub` }));
  t.check(newFeatures, { ok: false, code: "BAD_REQUEST" });

  // ## 5. `GET /alpha/api/task-output?file=<B's task output>`
  //
  // Full coverage (including the `..`-in-path and symlink-escape variants) lives
  // in `test/webapp/routes/commands.task-output.test.ts`; one line here keeps
  // this file a complete anchor.

  const taskOutputRes = await ctx.server.inject({
    method: "GET",
    url: `/alpha/api/task-output?file=${encodeURIComponent(betaTaskOutput)}`,
    headers: { authorization: ctx.a.agentBearerHeader() },
  });
  t.check(taskOutputRes.statusCode, 403);

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

  const mediaRes = await ctx.server.inject({
    method: "GET",
    url: "/alpha/api/session-media/aaaaaaaa-1111-4111-8111-000000000000/some-entry-uuid/0",
    headers: { authorization: ctx.a.agentBearerHeader() },
  });
  t.check(mediaRes.statusCode, 404);

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

  const backend = createFakeChatBackend();
  const ctx2 = await createTwoBoxTestServer({ chatBackend: backend });
  const relIntoBeta2 = path.relative(ctx2.a.boxRoot, ctx2.b.boxRoot);

  const sendRes = await ctx2.server.inject({
    method: "POST",
    url: "/alpha/api/chat/send",
    headers: { authorization: ctx2.a.agentBearerHeader(), "content-type": "application/json" },
    payload: { message: "hi", session: "new", contextDir: `${relIntoBeta2}/_content/sub` },
  });
  t.check(sendRes.statusCode, 400);
  await ctx2.cleanup();

  // ## 8. `history.diff` / `GET /alpha/api/history/blob/<hash>/...` with a hash that exists only in B
  //
  // Git runs in A's own repo (`simpleGit(ctx.boxRoot)`), so B's object is simply
  // absent from it — B's blob hash reaches alpha's git the same as any unknown
  // hash.

  const diff = await caller.history.diff({ hash: betaHash });
  t.check(diff, { hash: betaHash, diff: "" });
  // The server log says git has no such commit (git's message ends in a newline):
  t.check(warnings(), [`Failed to get diff for commit ${betaHash}; returning empty diff: Error: fatal: bad object ${betaHash}\n`]);

  const blobRes = await ctx.server.inject({
    method: "GET",
    url: `/alpha/api/history/blob/${betaHash}/_content/Marker.doc.card`,
    headers: { authorization: ctx.a.agentBearerHeader() },
  });
  t.check(blobRes.statusCode, 404);

  // ## 9. `POST /beta/api/secrets/resolve` with A's bearer; `secrets.boxStatus` never lists B's grant

  const resolveRes = await ctx.server.inject({
    method: "POST",
    url: "/beta/api/secrets/resolve",
    headers: { authorization: ctx.a.agentBearerHeader(), "content-type": "application/json" },
    payload: { name: "beta-only-key", purpose: "agent-self-note" },
  });
  const alphaBoxStatus = await caller.secrets.boxStatus();
  t.check(resolveRes.statusCode, 401);
  t.check(alphaBoxStatus, {
    slug: await boxSlug(ctx.a.boxRoot),
    granted: [],
    emptySlots: [],
    danglingGrants: [],
    declaredHere: [],
  });

  // ## 10. Events: alpha's subscriber never sees an event emitted on beta's bus
  //
  // Each box gets its own `EventBus` instance (`createTwoBoxTestServer`); an
  // emit on one never reaches a reader of the other.

  ctx.b.eventBus.emit("file-change", { event: "created", path: "BETA-MARKER.card", timestamp: "2026-10-18T00:00:00.000Z" });
  t.check(ctx.a.eventBus.readSince(0), []);

  // `createdAt` is stamped by the event store's clock.
  t.check(ctx.b.eventBus.readSince(0), [
    {
      id: 1,
      event: "file-change",
      data: { event: "created", path: "BETA-MARKER.card", timestamp: "2026-10-18T00:00:00.000Z" },
      createdAt: any(String).matches(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/),
    },
  ]);
});

// ## 11. Shared-host state files stay owner-only, whatever the umask
//
// The push store (`keys.auth` per endpoint, every box's opt-ins in one file)
// and a box's question latch (pending card paths) are written 0600 even from
// a process whose umask is 002, and a rewrite tightens a file an older build
// left 0664 (the 2026-11-06 leak-scan finding on both).

void test("shared-host state files are written 0600", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "bbx-probe-modes-"));
  const priorStoreDir = process.env.BBX_PUSH_STORE_DIR;
  const priorUmask = process.umask(0o002);
  process.env.BBX_PUSH_STORE_DIR = dir;
  t.teardown(async () => {
    process.umask(priorUmask);
    if (priorStoreDir === undefined) delete process.env.BBX_PUSH_STORE_DIR;
    else process.env.BBX_PUSH_STORE_DIR = priorStoreDir;
    await fs.rm(dir, { recursive: true, force: true });
  });
  const modeOf = async (file: string) => ((await fs.stat(file)).mode & 0o777).toString(8);

  const storeFile = join(dir, "push-subscriptions.json");
  await fs.writeFile(storeFile, "{}\n", { mode: 0o664 });
  await fs.chmod(storeFile, 0o664);
  await addSubscription({
    boxSlug: "alpha",
    subscription: { endpoint: "https://push.example/1", keys: { p256dh: "p", auth: "a" } },
    now: new Date("2026-11-06T00:00:00.000Z"),
  });

  const latchFile = join(dir, "box", ".beebox", "notified-questions.json");
  await fs.mkdir(path.dirname(latchFile), { recursive: true });
  await fs.writeFile(latchFile, "{}\n");
  await fs.chmod(latchFile, 0o664);
  await saveQuestionLatch(join(dir, "box"), { paths: ["_content/Q.question.card"], nudged: {} });

  t.check({ store: await modeOf(storeFile), latch: await modeOf(latchFile) }, { store: "600", latch: "600" });
});

// ## 12. A deploy's box install leaves node_modules closed to other accounts
//
// `deploy/server-bin/bbx-box-install` runs each box's `pnpm install` as the box
// user through `bash -l`, whose login umask is 002. That left
// `explorations/box/node_modules` 0775 on prod (the 2026-11-13 leak-scan
// finding). Here the real helper runs under umask 002 with `sudo`, `pnpm` and
// `box-engine-link` stubbed: a fresh install makes node_modules 0770, and a
// tree an older deploy left 0775 loses its "other" bits on the next pass.

void test("a deploy's box install leaves node_modules without other-access", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "bbx-probe-install-"));
  t.teardown(() => fs.rm(root, { recursive: true, force: true }));
  const bin = join(root, "bin");
  const engine = join(root, "engine");
  const boxes = join(root, "boxes");
  const stubs: Record<string, string> = {
    [join(bin, "sudo")]: "#!/usr/bin/env bash\nshift 3\nexec \"$@\"\n",
    [join(bin, "pnpm")]: "#!/usr/bin/env bash\nmkdir -p node_modules/.pnpm\n",
    [join(engine, "bin", "box-engine-link")]: "#!/usr/bin/env bash\nexit 0\n",
  };
  for (const [file, body] of Object.entries(stubs)) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, body, { mode: 0o755 });
  }
  for (const slug of ["fresh", "older"]) {
    await fs.mkdir(join(boxes, slug, "box"), { recursive: true });
    await fs.writeFile(join(boxes, slug, "box", "package.json"), "{}\n");
  }
  const olderModules = join(boxes, "older", "box", "node_modules");
  await fs.mkdir(olderModules);
  await fs.chmod(olderModules, 0o775);

  const helper = path.resolve("deploy/server-bin/bbx-box-install");
  execFileSync("/bin/bash", ["-c", 'umask 002; exec "$0" "$@"', helper, boxes, engine], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` },
    stdio: "pipe",
  });

  const modeOf = async (dir: string) => ((await fs.stat(dir)).mode & 0o777).toString(8);
  t.check(
    { fresh: await modeOf(join(boxes, "fresh", "box", "node_modules")), older: await modeOf(olderModules) },
    { fresh: "770", older: "770" },
  );
});
