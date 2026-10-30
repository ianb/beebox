// # Reminders are not held back, and a delivered one is not sent twice
//
// A `notify:` card runs no agent and no shell, so an active chat and an engine
// quota episode do not hold it back; `runs:` cards still wait. A send that
// failed is a `failure` even during a quota episode. A send that got through
// stays `success` when its housekeeping (the `once` deletion) fails, so the
// reminder's retry does not send it again.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, str } from "@ianbicking/tap-check/check";
import { execSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { runTick } from "../../../src/cli/commands/tick.js";
import {
  acquireChatActiveLock,
  loadScriptState,
  releaseChatActiveLock,
} from "../../../src/core/schedule/state.js";
import { recordEngineUnavailability } from "../../../src/core/agent/engine-availability-store.js";
import { readRecent } from "../../../src/core/notification/log.js";
import { makeTmpBox, type TmpBox } from "../../helpers/test-helpers.js";

process.env.BBX_NOTIFY_FAKE = "1";

const REMINDER = `---
at: 2020-10-02T08:30
once: true
notify:
  title: Call back
---
`;

const COMMAND = `---
at: 2020-10-02T08:30
runs: echo hi
---
`;

async function boxWith(cards: Record<string, string>): Promise<TmpBox> {
  const box = await makeTmpBox({ git: true });
  for (const [name, text] of Object.entries(cards)) {
    await box.write(`_config/schedules/${name}.scheduled-script.card`, text);
  }
  box.commitAll("add cards");
  return box;
}

async function lastRuns(box: TmpBox, names: string[]) {
  return Object.fromEntries(await Promise.all(names.map(async (n) => {
    const state = await loadScriptState(box.root, n);
    return [n, state.lastResult];
  })));
}

void test("with a chat active, a due reminder sends and a due command waits", async (t) => {
  process.env.BBX_ENGINE_AVAILABILITY_FILE = "/nonexistent/engine-availability.json";
  const box = await boxWith({ "remind-call": REMINDER, "nightly-echo": COMMAND });
  const lock = await acquireChatActiveLock({ boxRoot: box.root, lockId: "chat-run-1", sessionId: "s-1" });
  t.teardown(async () => {
    await releaseChatActiveLock(lock);
    await box.cleanup();
  });

  const result = await runTick(box.root, { quiet: true });
  t.check(result.scripts, [{ name: "nightly-echo", status: "skipped", reason: "system busy: chat:s-1 (only notify: cards run)" }, { name: "remind-call", status: "ran", command: "notify: Call back", durationMs: any(Number).int() }]);
  t.check(await lastRuns(box, ["remind-call", "nightly-echo"]), { "remind-call": "success", "nightly-echo": null });
  t.check((await readRecent(box.root, { days: 36500 })).map((s) => s.intent.title), ["Call back"]);
  // The `once` card is deleted, but the housekeeping commit waits for the chat:
  t.check(execSync("git log -1 --format=%s", { cwd: box.root }).toString().trim(), "add cards");
});

void test("during a quota episode a reminder still runs, and its failed send is a failure", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tick-reminder-engine-"));
  process.env.BBX_ENGINE_AVAILABILITY_FILE = path.join(dir, "engine-availability.json");
  delete process.env.BBX_NOTIFY_FAKE; // no channel can carry it
  const box = await boxWith({ "remind-call": REMINDER, "nightly-echo": COMMAND });
  t.teardown(async () => {
    process.env.BBX_NOTIFY_FAKE = "1";
    process.env.BBX_ENGINE_AVAILABILITY_FILE = "/nonexistent/engine-availability.json";
    await fs.rm(dir, { recursive: true, force: true });
    await box.cleanup();
  });
  // A record detected "during" the send's span: the engine-wait classifier
  // would call a failure in this span `deferred`.
  const soon = Date.now() + 60 * 60 * 1000;
  await recordEngineUnavailability({
    provider: "claude", reason: "quota-exhausted", retryAtSource: "parsed",
    detectedAt: new Date(soon).toISOString(), retryAt: new Date(soon + 60 * 60 * 1000).toISOString(),
    message: "Claude AI usage limit reached",
  });

  const result = await runTick(box.root, { quiet: true });
  t.check(result.scripts.map((s) => `${s.name} ${s.status}`), ["nightly-echo skipped", "remind-call error"]);
  const state = await loadScriptState(box.root, "remind-call");
  t.check(`${state.lastResult} ×${state.consecutiveFailures}: ${state.lastError}`, str`failure ×1: Not delivered: ${any(String)}`);
});

void test("a sent reminder whose card cannot be deleted stays sent and is not sent again", async (t) => {
  process.env.BBX_ENGINE_AVAILABILITY_FILE = "/nonexistent/engine-availability.json";
  const box = await boxWith({ "remind-call": REMINDER });
  const schedules = path.join(box.root, "_config/schedules");
  const errors: unknown[][] = [];
  const consoleError = console.error;
  console.error = (...args: unknown[]) => { errors.push(args); };
  t.teardown(async () => {
    console.error = consoleError;
    await fs.chmod(schedules, 0o755);
    await box.cleanup();
  });
  // State lives in `.state/` inside the schedules directory; with that made,
  // a read-only schedules directory fails only the `once` deletion.
  await fs.mkdir(path.join(schedules, ".state"));
  await fs.chmod(schedules, 0o555);

  const first = await runTick(box.root, { quiet: true });
  const second = await runTick(box.root, { quiet: true });
  t.check([first.ranCount, second.ranCount], [1, 0]);
  t.check((await loadScriptState(box.root, "remind-call")).lastResult, "success");
  t.check((await readRecent(box.root, { days: 36500 })).map((s) => s.intent.title), ["Call back"]);
  t.check(errors.map((args) => String(args[0])), ["Schedule remind-call: notification sent, but its housekeeping failed:"]);
});
