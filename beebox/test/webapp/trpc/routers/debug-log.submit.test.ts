// # `debugLog.submit` — tagged, capped, strictly-durable log forwarding
//
// Extends the existing web-only `debugLog.submit` sink (`ts [level] message`
// lines + a 200-entry ring buffer) to accept native-forwarded entries: an
// optional per-batch `source` slug, a closed `level` enum, a per-entry `at`
// device timestamp, and hard caps (≤100 entries, message ≤4000 chars). See
// `docs/implemented-plans/ios-log-forwarding.md` chunk 1 and `docs/mobile-contract.md` §5.7.
//
// Rendering stays `ts [level] message` when there's no `source` (today's web
// shape, unchanged except control-character normalization); gains a `[source]`
// tag when present, and `[source@<at>]` once `at` drifts more than 5s from the
// server's receipt time — the case where a queued entry flushes long after the
// incident it describes.
//
// Durability changes too: this route now writes through
// `appendRollingLogStrict`, so a filesystem failure makes the mutation reject
// (rather than silently 200) — the mobile client only clears its queued copy on
// a real 2xx.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { isoDate, str } from "@ianbicking/tap-check/check";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { TRPCError } from "@trpc/server";
import { appRouter } from "../../../../src/webapp/trpc/routers.js";
import type { TrpcContext } from "../../../../src/webapp/trpc/context.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";
import { trpcContext } from "../../../helpers/trpc-context.js";
import { makeTestServer, type TestServer } from "../../../helpers/test-route-server.js";

const FIXTURES_DIR = join(import.meta.dirname, "..", "..", "..", "mobile-contract", "fixtures", "debug-log-submit");

function loadSubmitFixtures() {
  return readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith(".json"))
    .toSorted()
    .map((file) => ({ file, fixture: JSON.parse(readFileSync(join(FIXTURES_DIR, file), "utf-8")) }));
}

// POST every fixture's `expected` body exactly as the phone would send it.
async function postSubmitFixtures(server: TestServer, fixtures: ReturnType<typeof loadSubmitFixtures>) {
  const lines: string[] = [];
  for (const { file, fixture } of fixtures) {
    const res = await server.request({
      method: "POST",
      url: "/api/trpc/debugLog.submit",
      payload: fixture.expected,
    });
    lines.push(`${file} ${res.statusCode} ${JSON.stringify(res.body)}`);
  }
  return lines.join("\n");
}

function caller(boxRoot: string) {
  const ctx: TrpcContext = trpcContext({ boxRoot, isAuthenticatedOwner: true });
  return appRouter.createCaller(ctx);
}

async function code(p: Promise<unknown>) {
  return p.then(() => "none", (e: unknown) => (e instanceof TRPCError ? e.code : String(e)));
}

type Caller = ReturnType<typeof caller>;

// Deliberately malformed batches: the route's zod schema is what rejects (or
// strips) them, so this one helper steps around the static input type.
function submitRaw(c: Caller, input: unknown) {
  // @ts-expect-error -- deliberately malformed input: the zod schema behind this procedure is what rejects or strips it
  return c.debugLog.submit(input);
}

const LOG_PATH = ".beebox/client-debug.log";

// ## Web-shaped input (no `source`) renders exactly as before, modulo control-char normalization
void test("Web-shaped input (no `source`) renders exactly as before, modulo control-char normalization", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  const c = caller(box.root);

  await c.debugLog.submit({
    entries: [
      { level: "error", message: "Something broke" },
      { level: "warn", message: "multiline\nmessage\rwith\tcontrol chars" },
    ],
  });

  const lines = (await box.read(LOG_PATH)).trim().split("\n");
  t.check(lines, [
    str`${isoDate()} [error] Something broke`,
    // CR/LF/tab all collapse to single spaces -- a crafted message can't forge
    // extra log lines.
    str`${isoDate()} [warn] multiline message with control chars`,
  ]);

  // The in-memory ring buffer (`debugLog.get`) is untouched by the tagging
  // change when there's no `source`.

  const got = await c.debugLog.get();
  t.check(got.entries, [
    { ts: isoDate(), level: "error", message: "Something broke" },
    { ts: isoDate(), level: "warn", message: "multiline message with control chars" },
  ]);
});

// ## iOS-shaped input: `source` tags every line; `at` only surfaces once it drifts >5s from receipt
void test("iOS-shaped input: `source` tags every line; `at` only surfaces once it drifts >5s from receipt", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  const c = caller(box.root);

  const recentAt = new Date(Date.now() - 1000).toISOString(); // 1s ago: no tag
  const staleAt = new Date(Date.now() - 3600_000).toISOString(); // 1h ago: tagged

  await c.debugLog.submit({
    source: "ios",
    entries: [
      { level: "error", message: "capture: upload failed", at: recentAt },
      { level: "warn", message: "capture: retrying after failure", at: staleAt },
    ],
  });

  const lines = (await box.read(LOG_PATH)).trim().split("\n");
  t.check(lines, [
    str`${isoDate()} [error] [ios] capture: upload failed`,
    str`${isoDate()} [warn] [ios@${staleAt}] capture: retrying after failure`,
  ]);

  // The ring buffer entry's `message` carries the same `[source]`/`[source@<at>]`
  // tag baked in -- `debugLog.get` stays a flat `{ts,level,message}` shape.

  const got = await c.debugLog.get();
  t.check(got.entries, [
    { ts: isoDate(), level: "error", message: "[ios] capture: upload failed" },
    { ts: isoDate(), level: "warn", message: `[ios@${staleAt}] capture: retrying after failure` },
  ]);
});

// ## Caps and the closed level enum are enforced (`BAD_REQUEST`)
void test("Caps and the closed level enum are enforced (`BAD_REQUEST`)", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  const c = caller(box.root);

  t.check(
    // Message over the 4000-char cap.
    await code(c.debugLog.submit({ entries: [{ level: "error", message: "x".repeat(4001) }] })),
    "BAD_REQUEST",
  );

  t.check(
    // Level outside the closed enum.
    await code(submitRaw(c, { entries: [{ level: "debug", message: "hi" }] })),
    "BAD_REQUEST",
  );

  // More than 100 entries in a batch.
  const tooMany = Array.from({ length: 101 }, () => ({ level: "log" as const, message: "x" }));
  t.check(await code(c.debugLog.submit({ entries: tooMany })), "BAD_REQUEST");

  t.check(
    // Bad source slug (uppercase not allowed).
    await code(c.debugLog.submit({ source: "iOS", entries: [{ level: "error", message: "hi" }] })),
    "BAD_REQUEST",
  );

  // Nothing landed in the log file from any of the rejected batches.

  t.check(await box.read(LOG_PATH).catch((e) => e.code), "ENOENT");
});

// ## Unknown extra keys are stripped (forward-compat), entries still land
//
// A plain (non-strict) `z.object` -- old server against a newer client that
// started sending fields it doesn't know yet -- degrades to today's behavior
// instead of rejecting the whole batch.
void test("A plain (non-strict) z.object -- old server against a newer client that start...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  const c = caller(box.root);

  await submitRaw(c, {
    source: "ios",
    futureTopLevelField: "ignored",
    entries: [{ level: "error", message: "still lands", at: new Date().toISOString(), futureEntryField: 123 }],
  });

  const lines = (await box.read(LOG_PATH)).trim().split("\n");
  t.check(lines, [str`${isoDate()} [error] [ios] still lands`]);
});

// ## A filesystem write failure makes the mutation reject (strict durability)
//
// Unlike the old lenient `appendRollingLog`, this route's write goes through
// `appendRollingLogStrict` -- so a 2xx really does mean "durably written," and a
// mobile client that only clears its queue on 2xx never loses entries to a
// swallowed disk error. Simulated here by making the log file's path itself a
// directory, so `fs.appendFile` fails with `EISDIR`.
void test("Unlike the old lenient appendRollingLog, this route's write goes through appe...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  const c = caller(box.root);

  await box.write(`${LOG_PATH}/blocker`, "occupying the path as a directory");

  t.check(await code(c.debugLog.submit({ entries: [{ level: "error", message: "should not silently vanish" }] })), "INTERNAL_SERVER_ERROR");

  // The in-memory ring is committed only after the append succeeds, so a failed
  // batch leaves no trace there either -- otherwise `debugLog.get` would show
  // entries the mutation reported as lost, and the client's retry would duplicate
  // them.

  const got = await c.debugLog.get();
  t.check(got.entries, []);
});

// ## Raw HTTP: the exact Swift-shaped wire body decodes and lands
//
// Pins the non-batched tRPC HTTP-RPC shape a Swift `URLSession` POST actually
// sends -- the input object as the raw JSON body, no `LogForwarder.swift`
// process in the loop.
void test("Pins the non-batched tRPC HTTP-RPC shape a Swift URLSession POST actually sen...", async (t) => {
  t.teardown(async () => {
    try {
      await server.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const server = await makeTestServer();

  const res = await server.request({
    method: "POST",
    url: "/api/trpc/debugLog.submit",
    payload: { source: "ios", entries: [{ level: "error", message: "capture: probe", at: "2026-08-03T12:00:00Z" }] },
  });
  t.check(res.statusCode, 200);

  t.check(res.body, {
    result: {
      data: {
        ok: true,
      },
    },
  });

  const line = (await server.read(LOG_PATH)).trim();
  t.check(line, str`${isoDate()} [error] [ios@2026-08-03T12:00:00Z] capture: probe`);
});

// ## The shared golden fixtures POST verbatim and land
//
// `test/mobile-contract/fixtures/debug-log-submit/` holds the same vectors
// `LogForwarderTests.testFlushPostsTheFixtureWireShape` asserts the Swift encoder
// produces. Here each fixture's `expected` body -- the exact bytes the phone puts
// on the wire -- is POSTed as-is, so a change to either side fails the other's
// suite. Every entry is stale by fixture design (a fixed 2026 timestamp), so all
// of them render with the `[ios@<at>]` incident-time tag.
void test("test/mobile-contract/fixtures/debug-log-submit/ holds the same vectors LogFor...", async (t) => {
  t.teardown(async () => {
    try {
      await server.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const server = await makeTestServer();
  const fixtures = loadSubmitFixtures();

  t.check(fixtures.map(({ file }) => file), ["capture-upload-failure.json", "mixed-level-batch.json"]);

  await t.checkText(await postSubmitFixtures(server, fixtures), `capture-upload-failure.json 200 {"result":{"data":{"ok":true}}}
mixed-level-batch.json 200 {"result":{"data":{"ok":true}}}`);

  // Every fixture entry landed as its own tagged line, in order, with the message
  // the fixture pins.

  const lines = (await server.read(LOG_PATH)).trim().split("\n");
  const expectedMessages = fixtures.flatMap(({ fixture }) => fixture.expected.entries);
  t.check(lines, expectedMessages.map((entry) => str`${isoDate()} [${entry.level}] [ios@${entry.at}] ${entry.message}`));
});
