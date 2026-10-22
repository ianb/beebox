// # chat.bootstrap
//
// Opening `/chat` used to take three serial round trips: `chat.defaultSession` to
// learn the session id, a client navigation, then `chat.history` + `chat.status`
// (both need a concrete id server-side, so they can't go out sooner).
// `chat.bootstrap` resolves the session and answers all three at once. It also
// carries the session's editorial `label` (the husk card's `title`, or null
// when the session has no real name yet) — the chat page's session chip needs
// it, and no other chat-page query has one. A resumable session also carries
// its `contextDir`, the answer `chat.directoryFor` gives, so the page does not
// spend another round trip asking for it.
//
// It composes the same implementations the three procedures use, so it can't
// report anything different from them.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import assert from "node:assert/strict";
import { any } from "@ianbicking/tap-check/check";
import { appRouter } from "../../../../src/webapp/trpc/routers.js";
import { makeTestServer } from "../../../helpers/test-route-server.js";
import { trpcContext } from "../../../helpers/trpc-context.js";
import type { TestServer } from "../../../helpers/test-route-server.js";
import type { TrpcContext } from "../../../../src/webapp/trpc/context.js";
import { getSessionDir } from "../../../../src/core/chat/session/transcript-paths.js";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A real server, because `chat.status` reads the live per-box chat runtime
// that `registerChatRoutes` installs.
function caller(server: TestServer) {
  const ctx: TrpcContext = trpcContext({
    boxRoot: server.boxRoot,
    eventBus: server.eventBus,
    isAuthenticatedOwner: true,
  });
  return appRouter.createCaller(ctx);
}

type Bootstrap = Awaited<ReturnType<ReturnType<typeof caller>["chat"]["bootstrap"]>>;

// Deliberately invalid wire input, as it would arrive from a client.
function wire(json: string) {
  return JSON.parse(json);
}

// The fields an example is about: the full status payload is chat.status's own
// contract, covered in its tests, so only its session/run flags are kept.
function shape(r: Bootstrap) {
  const { status, history, ...rest } = r;
  return {
    ...rest,
    history,
    status: { sessionId: status.sessionId, running: status.running, busy: status.busy },
  };
}

// The chat page's request shape: a bounded tail window.
const TAIL = { mode: "tail", tail: 200, minRealUserMessages: 2 } as const;

// The idle `chat.status` payload of a fresh box, which offers only `claude`.
// Model ids rotate, so they are patterns.
function idleStatus(sessionId: string | null) {
  return {
    sessionId,
    running: false,
    busy: false,
    model: any(String),
    source: "default" as const,
    boxDefault: any(String),
    pendingModel: null,
    engine: "claude" as const,
    enabledEngines: ["claude" as const],
    boxEngine: "claude" as const,
    glmAvailable: false,
    addedModels: [],
  };
}

const TRANSCRIPT = [
  JSON.stringify({
    type: "user",
    uuid: "u1",
    timestamp: "2026-01-01T00:00:00Z",
    message: { role: "user", content: [{ type: "text", text: "Hello" }] },
  }),
  JSON.stringify({
    type: "assistant",
    uuid: "a1",
    timestamp: "2026-01-01T00:00:01Z",
    message: { role: "assistant", content: [{ type: "text", text: "Hi there!" }] },
  }),
].join("\n");

// Point session discovery at a fixture dir and write one session's transcript.
async function seedTranscript(server: TestServer, sessionId: string) {
  const dir = getSessionDir(server.boxRoot);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${sessionId}.jsonl`), TRANSCRIPT);
}

// Record the default-session pointer, as sending a message would.
async function setDefaultSession(server: TestServer, sessionId: string) {
  await mkdir(join(server.boxRoot, ".beebox"), { recursive: true });
  await writeFile(
    join(server.boxRoot, ".beebox/chat-session-id.json"),
    JSON.stringify({ sessionId, savedAt: "2026-01-01T00:00:02Z" }),
  );
}

// ## A box with no chat yet: no session, no history
//
// `history` is null exactly when `sessionId` is null — there is nothing to load —
// and `status` reports the idle shape rather than failing.
void test("history is null exactly when sessionId is null — there is nothing to load — a...", async (t) => {
  t.teardown(async () => {
    try {
      delete process.env["BBX_CLAUDE_PROJECTS_DIR"];
      await server.cleanup();
      await rm(projects, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  const projects = await mkdtemp(join(tmpdir(), "bbx-bootstrap-projects-"));
  process.env["BBX_CLAUDE_PROJECTS_DIR"] = projects;
  const server = await makeTestServer();

  const empty = await caller(server).chat.bootstrap({ slice: TAIL });
  t.check(shape(empty), {
    kind: "empty",
    sessionId: null,
    history: null,
    label: null,
    status: { sessionId: null, running: false, busy: false },
    pending: [],
  });

  // The full idle `status` payload, once: the engine fields show a fresh box offers
  // only `claude`. Model ids rotate, so they are wildcards.

  t.check(empty.status, idleStatus(null));

  // ## An explicit session id returns that session's history and status

  await seedTranscript(server, "sess-explicit");

  const got = await caller(server).chat.bootstrap({ session: "sess-explicit", slice: TAIL });
  t.check(got, {
    kind: "resumable",
    sessionId: "sess-explicit",
    history: {
      sessionId: "sess-explicit",
      entries: [
        { uuid: "u1", type: "user", timestamp: "2026-01-01T00:00:00Z", content: [{ type: "text", text: "Hello" }] },
        { uuid: "a1", type: "assistant", timestamp: "2026-01-01T00:00:01Z", content: [{ type: "text", text: "Hi there!" }] },
      ],
      total: 2,
    },
    label: null,
    contextDir: "",
    status: idleStatus("sess-explicit"),
    pending: [],
  });

  // `label` is null here even though the transcript has messages: it is the
  // session's *editorial* title (husk `title` only — see the husk section
  // below), not the pickers' first-message fallback. The session chip shows an
  // icon face until a real title exists.
  //
  // The history slice options are the ones `chat.history` takes:

  const tailed = await caller(server).chat.bootstrap({ session: "sess-explicit", slice: { mode: "tail", tail: 1 } });
  t.check(tailed, {
    kind: "resumable",
    sessionId: "sess-explicit",
    history: {
      sessionId: "sess-explicit",
      entries: [
        { uuid: "a1", type: "assistant", timestamp: "2026-01-01T00:00:01Z", content: [{ type: "text", text: "Hi there!" }] },
      ],
      total: 2,
    },
    label: null,
    contextDir: "",
    status: idleStatus("sess-explicit"),
    pending: [],
  });

  // ## It matches the procedures it replaces
  //
  // With no `session`, bootstrap resolves the default session the way
  // `chat.defaultSession` does, so the client no longer has to ask, navigate, and
  // ask again.

  await setDefaultSession(server, "sess-explicit");

  const c = caller(server);
  const [viaDefault, viaHistory, viaStatus, viaDirectory] = await Promise.all([
    c.chat.defaultSession(),
    c.chat.history({ session: "sess-explicit", slice: TAIL }),
    c.chat.status({ session: "sess-explicit" }),
    c.chat.directoryFor({ sessionId: "sess-explicit" }),
  ]);
  const atomic = await c.chat.bootstrap({ slice: TAIL });

  // `label` and `pending` are bootstrap's own additions — the three procedures it
  // replaces have no equivalent (`pending` reads the acceptance record on the
  // event bus, not the transcript) — so they sit out the comparison.
  assert.equal(atomic.kind, "resumable");
  assert.ok(viaDefault.sessionId);
  const { label: _label, pending: _pending, ...composed } = atomic;
  t.check(composed, {
    kind: "resumable",
    sessionId: viaDefault.sessionId,
    history: viaHistory,
    contextDir: viaDirectory.contextDir,
    status: viaStatus,
  });

  // ## A session id with no transcript reads as empty, not an error
  //
  // An id that hasn't produced a JSONL yet — a brand-new chat, or a turn that
  // errored before writing — is a normal state. `chat.history` already degrades
  // this way; `bootstrap` matches it rather than inventing an error the chat page
  // would have to handle.
  //
  // The label is null — no husk, no editorial title. (The session *lists* fall
  // back to an id prefix for their rows; bootstrap's label deliberately
  // doesn't.)

  const missing = await caller(server).chat.bootstrap({ session: "no-such-session", slice: TAIL });
  t.check(shape(missing), {
    kind: "unavailable",
    reason: "missing-local-transcript",
    transcript: { state: "unknown" },
    huskPath: null,
    sessionId: "no-such-session",
    history: null,
    label: null,
    status: { sessionId: "no-such-session", running: false, busy: false },
    pending: [],
  });

  // Input still validates: a non-string session is rejected before any work, and so
  // is an empty one — `""` is not a session id, and accepting it would report
  // `sessionId: ""` next to a status that correctly says there is no session.

  t.check(await caller(server).chat.bootstrap(wire(`{ "session": 42, "slice": ${JSON.stringify(TAIL)} }`)).then(() => "no error", (e) => e.code), "BAD_REQUEST");

  t.check(await caller(server).chat.bootstrap({ session: "", slice: TAIL }).then(() => "no error", (e) => e.code), "BAD_REQUEST");

  // The slice is a discriminated union with hard bounds, and each arm is strict —
  // a tail request carrying page fields is a different request, not a tail request
  // with extras, and a slice past the retention ceiling is refused at the door
  // rather than served as a bigger read:

  const c2 = caller(server);
  // A fresh object literal would be refused at compile time; a variable is not.
  const tailWithPageFields = { mode: "tail", tail: 1, offset: 0, limit: 40 } as const;
  t.check(
    [
      await c2.chat.history({ session: "sess-explicit", slice: tailWithPageFields }).then(() => "no error", (e) => e.code),
      await c2.chat.history({ session: "sess-explicit", slice: { mode: "tail", tail: 50_000 } }).then(() => "no error", (e) => e.code),
      await c2.chat.history({ session: "sess-explicit", slice: { mode: "page", offset: -1, limit: 10 } }).then(() => "no error", (e) => e.code),
      await c2.chat.history({ session: "sess-explicit", slice: { mode: "tail", tail: 1.5 } }).then(() => "no error", (e) => e.code),
    ],
    ["BAD_REQUEST", "BAD_REQUEST", "BAD_REQUEST", "BAD_REQUEST"],
  );

  // ## The label comes from the husk, like every other session list
  //
  // A husk `title` — hand-set, or written by the nightly chat review — wins over the
  // transcript snippet, so the chip and the pickers can't disagree about what a chat
  // is called.

  await mkdir(join(server.boxRoot, "_content/chat/web"), { recursive: true });
  await writeFile(
    join(server.boxRoot, "_content/chat/web/2026-01-01_sess-exp.chat.card"),
    "---\nsession: sess-explicit\ntitle: Chasing down a duplicate charge\n---\n\n",
  );

  const titled = await caller(server).chat.bootstrap({ session: "sess-explicit", slice: TAIL });
  t.check(titled.label, "Chasing down a duplicate charge");

  // A husk can be renamed freely — the `session` field is what identifies it, and
  // the pickers enumerate by that field. So a husk whose filename no longer carries
  // the id's `_<shortid>` suffix still names its chat; the filename convention is
  // only a fast path for finding it.

  await writeFile(
    join(server.boxRoot, "_content/chat/web/Duplicate_charge_followup.chat.card"),
    "---\nsession: sess-renamed\ntitle: Renamed husk still names its chat\n---\n\n",
  );

  const renamed = await caller(server).chat.bootstrap({ session: "sess-renamed", slice: TAIL });
  t.check(renamed.label, "Renamed husk still names its chat");

  // An empty id in the persisted default-session pointer means "none" too, rather
  // than a session named `""`:

  await setDefaultSession(server, "");
  t.check(shape(await caller(server).chat.bootstrap({ slice: TAIL })), {
    kind: "empty",
    sessionId: null,
    history: null,
    label: null,
    status: { sessionId: null, running: false, busy: false },
    pending: [],
  });
});
