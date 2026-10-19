// # Field-test run lifecycle
//
// A field run owns a disposable box and a dedicated server
// (`docs/implemented-plans/agent-field-tests.md`, Track 2). This exercises the real thing —
// a real `bbx init`, a real `bbx serve` on a real free port — because the failures
// this module exists to catch (a server that never comes up, a child left
// running after teardown) are all invisible to a mocked version.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any } from "@ianbicking/tap-check/check";
import { mkdtemp, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { createFieldBox, TEST_BOX_MARKER } from "../../src/field-test/run-box.js";
import { startFieldServer, allocateFreePort, serverProcessAlive } from "../../src/field-test/run/server.js";
import { fileExists } from "../../src/lib/file-exists.js";
import { getStatus } from "../../src/lib/git/core/operations.js";

// ## A free port is a real, unbound port
//
// Nothing is asserted about two calls returning different ports — the OS is free
// to hand back the same ephemeral port once it's released, and the guarantee this
// module actually relies on is the readiness probe below, not port uniqueness.
void test("Nothing is asserted about two calls returning different ports — the OS is fre...", async (t) => {
  const port = await allocateFreePort();
  t.check(port, any(Number).between(1025, 65535));
});

// ## Create a box, serve it, tear it down
//
// `createFieldBox` puts the box at `<runDir>/box` (shapeVersion 3, one root)
// and writes the test-box marker relative to that root, which is where the
// `BBX_FAKE_GMAIL` gate (Track 1) will look for it.
void test("createFieldBox puts the box at <runDir>/box (shapeVersion 3, one root) and wr...", async (t) => {
  t.teardown(async () => {
    try {
      await rm(runDir, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  const runDir = await mkdtemp(join(tmpdir(), "bbx-field-run-"));
  const box = await createFieldBox(runDir);
  t.check([relative(runDir, box.boxRoot), box.slug], ["box", "box"]);

  t.check(await fileExists(join(box.boxRoot, TEST_BOX_MARKER)), true);

  // The baseline is committed, so a later `reset` cleanup policy has something to
  // rewind to:

  const status = await getStatus(box.boxRoot);
  t.check(status, { staged: [], modified: [], untracked: [], clean: true });

  // The server is serving THIS box before `startFieldServer` returns — readiness is
  // the box-scoped health query authenticated with the run's own random diagnostic
  // key, so a stray server that won the port cannot satisfy it. `baseUrl` is what
  // the harness hands browse as `BROWSE_BASE_URL`.

  const server = await startFieldServer(box, { env: { BBX_TIME: "2026-08-08T09:00:00Z" } });
  t.check(server.baseUrl, `${server.origin}/${box.slug}`);

  const health = await fetch(`${server.baseUrl}/api/trpc/health.check`, {
    headers: { Authorization: `Bearer ${server.diagKey}` },
  });
  t.check(health.status, 200);

  // The box is really reachable as a page, too.
  const page = await fetch(`${server.origin}/`);
  t.check(page.status, 200);

  // A run restarts its server — after a `reset` cleanup, and at every simulated day
  // boundary — and re-binds the SAME port when told to. That is what keeps the base
  // URL baked into the operator's system prompt (written once, at the start of the
  // run) pointing at something alive.

  await server.stop();
  const restarted = await startFieldServer(box, {
    env: { BBX_TIME: "2026-08-11T09:00:00Z" },
    port: server.port,
  });
  t.check(restarted.baseUrl, server.baseUrl);

  await restarted.stop();

  // Teardown kills the child; nothing is left listening.

  await server.stop();
  t.check(serverProcessAlive(server), false);

  const afterStop = await fetch(`${server.origin}/`).then(() => "still serving", () => "refused");
  t.check(afterStop, "refused");

  // A second run may not reuse the directory: `bbx init` over an existing box is an
  // update, and a run that inherits the last run's state is not a fresh start.

  await t.checkThrows(async () => (await createFieldBox(runDir)), "FieldBoxExistsError");
});

// ## A server that cannot start fails loudly
//
// `bbx serve` on a directory that is not a box exits non-zero. The harness must
// hear about that before an operator session starts, with the child's own output
// attached rather than a bare timeout.
void test("bbx serve on a directory that is not a box exits non-zero.", async (t) => {
  t.teardown(async () => {
    try {
      await rm(emptyDir, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  const emptyDir = await mkdtemp(join(tmpdir(), "bbx-field-empty-"));
  const notABox = { boxRoot: emptyDir, slug: "nope" };

  await t.checkThrows(async () => (await startFieldServer(notABox, { env: {}, readyTimeoutMs: 20_000 })), "FieldServerStartError");
});
