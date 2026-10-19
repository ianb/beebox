// # A run that fails to start leaves the session usable
//
// When `backend.start()` throws — the real case is an SDK subprocess spawn failing
// with `EBADF` once the process is out of file descriptors
// (`issues/bugs/2026-08-03-intermittent-spawn-ebadf-sdk-chat-run.md`) — the session
// used to be left in the `starting` phase. That reads as permanently busy, and
// neither `stop()` nor `restart()` can clear it because both need a live run to
// close, so every later message queued behind a turn that would never end. The
// observable symptom was a chat that had to be recovered by restarting `bbx serve`.
//
// `openChatRun` now unwinds: it releases the chat-active lock, returns the session
// to `idle`, and rethrows so the caller can report the failure.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { ChatSession } from "../../../../src/core/chat/session/run/core.js";
import { createFakeChatBackend } from "../../../../src/services/claude-chat/core.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";
import { tick } from "../../../helpers/chat-session-spawner-helpers.js";

// ## The failure propagates, and the session goes back to idle
void test("The failure propagates, and the session goes back to idle", async (t) => {
  t.teardown(async () => {
    try {
      session.stop();
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  const backend = createFakeChatBackend();
  const session = new ChatSession(box.root, { backend, skipBootstrap: true });

  backend.failNextStart = Object.assign(new Error("spawn EBADF"), { code: "EBADF" });

  let caught = "none";
  try {
    await session.send("hello");
  } catch (e) {
    caught = e instanceof Error ? e.message : String(e);
  }

  t.check(`${caught} | busy=${session.isBusy()} | running=${session.isRunning()}`, "spawn EBADF | busy=false | running=false");
});

// ## The next send starts a run normally
//
// The point of resetting to `idle`: the very next message works, with no restart
// and no operator intervention.
void test("The point of resetting to idle:", async (t) => {
  t.teardown(async () => {
    try {
      session.stop();
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  const backend = createFakeChatBackend();
  const session = new ChatSession(box.root, { backend, skipBootstrap: true });

  backend.failNextStart = new Error("spawn EBADF");
  await session.send("first").catch(() => null);

  const sent = await session.send("second");
  await tick();

  t.check(`sent=${sent} | runs=${backend.runs.length} | busy=${session.isBusy()}`, "sent=true | runs=1 | busy=true");
});

// ## A failed start does not strand the chat-active run lock
//
// A lock left held would make `bbx tick` defer commits indefinitely against a run
// that never started.
void test("A lock left held would make bbx tick defer commits indefinitely against a run...", async (t) => {
  t.teardown(async () => {
    try {
      session.stop();
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  const backend = createFakeChatBackend();
  const session = new ChatSession(box.root, { backend, skipBootstrap: true });

  backend.failNextStart = new Error("spawn EBADF");
  await session.send("hello").catch(() => null);

  const { readdir } = await import("node:fs/promises");
  const stateDir = await readdir(`${box.root}/.beebox`).catch((): string[] => []);

  t.check(stateDir.filter((f) => f.includes("chat-active")).join(","), "");
});
