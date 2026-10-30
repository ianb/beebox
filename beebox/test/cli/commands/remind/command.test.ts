// `bbx remind` (`src/cli/commands/remind/command.ts`), driven through
// `runRemind(boxRoot, run)`, which returns the exit code. The reminder form
// writes and commits a card in a temp box; the check-in form calls a fake of the
// server's `chat.addCheckIn` / `chat.cancelCheckIn`. The host zone is set to one
// no box uses, so a box-zone result cannot come from the host by accident.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { TRPCClientError } from "@trpc/client";
import { runRemind, type RemindCliOptions } from "../../../../src/cli/commands/remind/command.js";
import { runCancelCheckIn, serverCheckIns, type CheckInClient, type CheckInInput } from "../../../../src/cli/commands/remind/check-in.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";
import { addSubscription } from "../../../../src/core/push-subscriptions.js";
import { boxSlug } from "../../../../src/lib/box-slug.js";
import { createFakePush } from "../../../../src/services/push.js";
import type { NotifyServices } from "../../../../src/core/notify-boxholder.js";
import { cardFields, parseCardText } from "../../../../src/core/card-io.js";
import { createCardSchemaMap } from "../../../../src/schemas.js";
import { parseScheduledScript, ScheduledScriptSchema } from "../../../../src/schemas/scheduled-script/schema.js";
import { isDue } from "../../../../src/schemas/scheduled-script/due.js";
import { loadScriptState, saveScriptState } from "../../../../src/core/schedule/state.js";
import { ok } from "../../../../src/shared/result.js";
import { buildProgram } from "../../../../src/cli/entry/program.js";
import { loadCommands } from "../../../../src/cli/entry/load-commands.js";
import { clearBoxConfigCache } from "../../../../src/core/box/config.js";

process.env.TZ = "Asia/Tokyo";
process.env.BBX_TIME = "2026-10-18T14:00:00Z";
process.env.BBX_PUSH_STORE_DIR = path.join(os.tmpdir(), `bbx-remind-cli-${process.pid}-${Date.now()}`);
for (const name of ["BBX_SERVER_URL", "BBX_BOX_NAME", "BBX_AGENT_TOKEN", "BBX_VAPID_PUBLIC_KEY", "BBX_VAPID_PRIVATE_KEY", "BBX_PUSH_FAKE", "BBX_APNS_KEY_PATH", "BBX_APNS_KEY_ID", "BBX_APNS_TEAM_ID", "BBX_APNS_BUNDLE_ID"]) delete process.env[name];
process.env.BBX_NOTIFY_FAKE = "1";

async function chicagoBox() {
  const box = await makeTmpBox({ git: true });
  await fs.writeFile(path.join(box.root, "_config", "box.json"), JSON.stringify({ timezone: "America/Chicago" }));
  clearBoxConfigCache(box.root);
  execFileSync("git", ["-C", box.root, "add", "_config/box.json"]);
  execFileSync("git", ["-C", box.root, "commit", "-qm", "timezone"]);
  return box;
}

const SUFFIX = /-[2-7a-z]{6}\.scheduled-script\.card/g;

async function run(root: string, opts: { text: string; options: RemindCliOptions; services?: NotifyServices; sessionId?: string | null; client?: CheckInClient }) {
  const out: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...args) => { out.push(args.join(" ")); };
  console.error = (...args) => { out.push(`stderr: ${args.join(" ")}`); };
  let code: number | undefined;
  try {
    code = await runRemind(root, {
      text: opts.text,
      options: opts.options,
      sessionId: opts.sessionId ?? null,
      checkIns: ok(opts.client ?? fakeCheckIns().client),
      services: opts.services,
    });
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
  return [...out.map((line) => line.replace(SUFFIX, "-<rand>.scheduled-script.card")), `exit ${code}`].join("\n");
}

async function reminderCards(root: string): Promise<string[]> {
  const dir = path.join(root, "_config", "schedules");
  return (await fs.readdir(dir)).filter((f) => f.startsWith("remind-")).toSorted();
}

function git(root: string, ...args: string[]): string {
  return execFileSync("git", ["-C", root, ...args]).toString().trim();
}

void test("a reminder writes the card, commits it, and echoes the box-zone time", async (t) => {
  const box = await chicagoBox();
  t.teardown(() => box.cleanup());
  await t.checkText(await run(box.root, { text: "Did Tomas return the stepladder?", options: { in: "30d" } }), `Reminder scheduled for Tue 2026-11-17 08:00 CST: "Did Tomas return the stepladder?" (_config/schedules/remind-did-tomas-return-the-stepladder-<rand>.scheduled-script.card)
To cancel it, remove the card: bbx rm _config/schedules/remind-did-tomas-return-the-stepladder-<rand>.scheduled-script.card
exit 0`);
  const [card] = await reminderCards(box.root);
  // No `loudness`: the scheduler's default for `requested-by: boxholder` (loud) applies.
  await t.checkText(await fs.readFile(path.join(box.root, "_config", "schedules", card ?? ""), "utf-8"), `---
at: 2026-11-17T08:00:00-06:00
once: true
requested-by: boxholder
reason: Asked for in chat on 2026-10-18
notify:
  title: Did Tomas return the stepladder?
  target: chat:new
---`);
  t.check([git(box.root, "log", "-1", "--format=%s%n%(trailers:only)"), git(box.root, "status", "--short")], ["Reminder: Did Tomas return the stepladder?\nCreated-By: bbx remind", ""]);
});

// The box zone (Chicago) reads the wall time, not the host's (Tokyo).
void test("an offset-less --at in a box whose zone differs from the host's", async (t) => {
  const box = await chicagoBox();
  t.teardown(() => box.cleanup());
  await t.checkText(await run(box.root, { text: "Call the vet", options: { at: "2026-11-18T09:00", body: "About Pepper's shots", loudness: "quiet", context: "_config/box.card" } }), `stderr: Not set: --context _config/box.card does not exist; give the path of a card in this box (_content/…).
exit 1`);
  await fs.mkdir(path.join(box.root, "_content", "pets"), { recursive: true });
  await fs.writeFile(path.join(box.root, "_content", "pets", "pepper.todo.card"), "---\ntitle: Pepper\n---\n");
  await t.checkText(await run(box.root, { text: "Call the vet", options: { at: "2026-11-18T09:00", body: "About Pepper's shots", loudness: "quiet", context: "_content/pets/pepper.todo.card" } }), `Reminder scheduled for Wed 2026-11-18 09:00 CST: "Call the vet" (_config/schedules/remind-call-the-vet-<rand>.scheduled-script.card)
To cancel it, remove the card: bbx rm _config/schedules/remind-call-the-vet-<rand>.scheduled-script.card
exit 0`);
  const [card] = await reminderCards(box.root);
  await t.checkText(await fs.readFile(path.join(box.root, "_config", "schedules", card ?? ""), "utf-8"), `---
at: 2026-11-18T09:00:00-06:00
once: true
requested-by: boxholder
reason: Asked for in chat on 2026-10-18
notify:
  title: Call the vet
  body: About Pepper's shots
  loudness: quiet
  target: chat:new
  context: _content/pets/pepper.todo.card
---`);
});

// Scheduler state is keyed by the filename stem, and an `at` card is due only
// while it has never run: a reused name would never fire again.
void test("the same title twice gives two cards, and the second is due after the first ran", async (t) => {
  const box = await chicagoBox();
  t.teardown(() => box.cleanup());
  await run(box.root, { text: "Stretch", options: { in: "1h" } });
  const [first] = await reminderCards(box.root);
  const firstStem = (first ?? "").replace(".scheduled-script.card", "");
  await saveScriptState({ boxRoot: box.root, scriptName: firstStem, state: { ...(await loadScriptState(box.root, firstStem)), lastRun: "2026-10-18T15:00:00.000Z", lastResult: "success" } });
  await run(box.root, { text: "Stretch", options: { in: "2h" } });
  const cards = await reminderCards(box.root);
  const second = cards.find((c) => c !== first) ?? "";
  t.check(cards.map((c) => c.replace(SUFFIX, "-<rand>.scheduled-script.card")), ["remind-stretch-<rand>.scheduled-script.card", "remind-stretch-<rand>.scheduled-script.card"]);
  const content = await fs.readFile(path.join(box.root, "_config", "schedules", second), "utf-8");
  const parsed = parseScheduledScript(cardFields(parseCardText(content, { source: second, schemas: await createCardSchemaMap(box.root) }), ScheduledScriptSchema));
  const state = await loadScriptState(box.root, second.replace(".scheduled-script.card", ""));
  t.check(isDue(parsed, { lastRun: state.lastRun, lastResult: state.lastResult, consecutiveFailures: state.consecutiveFailures, lastFailureFinal: state.lastFailureFinal === true, now: new Date("2026-10-18T16:00:01Z") }), true);
});

void test("a past time and an unreachable box are refused and write nothing", async (t) => {
  const box = await chicagoBox();
  t.teardown(() => box.cleanup());
  await t.checkText(await run(box.root, { text: "Too late", options: { at: "2026-10-18T08:00" } }), `stderr: Not set: Sun 2026-10-18 08:00 CDT is not in the future (now Sun 2026-10-18 09:00 CDT); pick a later time.
exit 1`);
  delete process.env.BBX_NOTIFY_FAKE;
  t.teardown(() => { process.env.BBX_NOTIFY_FAKE = "1"; });
  await t.checkText(await run(box.root, { text: "Nobody hears", options: { in: "1d" }, services: {} }), `stderr: Not set: No notification channel can reach the boxholder at loudness loud; turn one on in Admin → Host → Notifications, then set the reminder.
exit 1`);
  t.check(await reminderCards(box.root).catch(() => []), []);
});

// A dot badges the iPhone app only (`core/notification/channels.ts`), so a box
// reached only by a browser cannot carry one, though a loud reminder works.
void test("a browser-only box refuses --loudness dot", async (t) => {
  const box = await chicagoBox();
  t.teardown(() => box.cleanup());
  delete process.env.BBX_NOTIFY_FAKE;
  t.teardown(() => { process.env.BBX_NOTIFY_FAKE = "1"; });
  await addSubscription({ boxSlug: await boxSlug(box.root), subscription: { endpoint: "https://push.example/laptop", keys: { p256dh: "p", auth: "a" } }, now: new Date() });
  const services = { push: createFakePush() };
  await t.checkText(await run(box.root, { text: "Badge me", options: { in: "1d", loudness: "dot" }, services }), `stderr: Not set: A dot only badges the iPhone app, and no iPhone is paired with this box; use --loudness quiet or loud, or pair the iPhone app in Admin → Host → Notifications.
exit 1`);
  await t.checkText(await run(box.root, { text: "Ring me", options: { in: "1d" }, services }), `Reminder scheduled for Mon 2026-10-19 09:00 CDT: "Ring me" (_config/schedules/remind-ring-me-<rand>.scheduled-script.card)
To cancel it, remove the card: bbx rm _config/schedules/remind-ring-me-<rand>.scheduled-script.card
exit 0`);
});

void test("a card whose commit fails is reported active, not to be recreated", async (t) => {
  const box = await chicagoBox();
  t.teardown(() => box.cleanup());
  const hooks = path.join(box.root, ".git", "refuse-hooks");
  await fs.mkdir(hooks);
  await fs.writeFile(path.join(hooks, "pre-commit"), "#!/bin/sh\necho 'hook says no' >&2\nexit 1\n", { mode: 0o755 });
  git(box.root, "config", "core.hooksPath", hooks);
  const output = await run(box.root, { text: "Water the plants", options: { in: "2d" } });
  await t.checkText(output.replace(/the commit failed: [\S\s]*?\. Do not/, "the commit failed: <git error>. Do not"), `Reminder scheduled for Tue 2026-10-20 09:00 CDT: "Water the plants" (_config/schedules/remind-water-the-plants-<rand>.scheduled-script.card)
To cancel it, remove the card: bbx rm _config/schedules/remind-water-the-plants-<rand>.scheduled-script.card
stderr: Reminder is active (_config/schedules/remind-water-the-plants-<rand>.scheduled-script.card); the commit failed: <git error>. Do not recreate it.
exit 0`);
  t.check((await reminderCards(box.root)).map((c) => c.replace(SUFFIX, "-<rand>.scheduled-script.card")), ["remind-water-the-plants-<rand>.scheduled-script.card"]);
});

function fakeCheckIns(opts?: { addError?: unknown }) {
  const calls: Array<CheckInInput | { sessionId: string; label: string }> = [];
  const client: CheckInClient = {
    add: async (input) => {
      calls.push(input);
      if (opts?.addError !== undefined) throw opts.addError;
      return { id: "s1", label: input.label, firesAt: new Date(Date.parse(process.env.BBX_TIME ?? "") + 20 * 60_000).toISOString() };
    },
    cancel: async (input) => {
      calls.push(input);
      return { ok: input.label === "rice" };
    },
  };
  return { client, calls };
}

void test("--here sets a check-in in this chat", async (t) => {
  const box = await chicagoBox();
  t.teardown(() => box.cleanup());
  const fake = fakeCheckIns();
  await t.checkText(await run(box.root, { text: "Check the rice", options: { here: "20m", alarm: true }, sessionId: "sess-1", client: fake.client }), `Check-in "check-the-rice" in 20m (09:20 CDT), this chat.
exit 0`);
  t.check(fake.calls, [{ sessionId: "sess-1", in: "20m", label: "check-the-rice", alarm: true, announce: null, content: "Check the rice" }]);
});

void test("--here is refused outside a chat, over the cap, and with reminder flags", async (t) => {
  const box = await chicagoBox();
  t.teardown(() => box.cleanup());
  const fake = fakeCheckIns();
  await t.checkText(await run(box.root, { text: "Check the rice", options: { here: "20m" }, sessionId: null, client: fake.client }), `stderr: Not set: this shell is not in a chat (no BBX_CHAT_SESSION_ID), and a check-in comes back to the chat that set it; for a reminder that reaches the person anywhere, use --in or --at without --here.
exit 1`);
  await t.checkText(await run(box.root, { text: "Stepladder", options: { here: "30d" }, sessionId: "sess-1", client: fake.client }), `stderr: Not set: a check-in can be at most 12h (asked for 30d); for longer, set a reminder with bbx remind --in 30d (without --here).
exit 1`);
  await t.checkText(await run(box.root, { text: "Rice", options: { here: "20m", loudness: "loud", in: "1h" }, sessionId: "sess-1", client: fake.client }), `stderr: Not set: --loudness, --in do not apply to a check-in (--here).
exit 1`);
  await t.checkText(await run(box.root, { text: "Rice", options: { in: "1h", alarm: true } }), `stderr: Not set: --alarm does not apply to a reminder; add --here for a check-in in this chat.
exit 1`);
  t.check(fake.calls, []);
});

// No box environment: the refusal names the missing variable (`cli/lib/box-client.ts`).
void test("--here outside a box-spawned shell names the missing variable", async (t) => {
  const box = await chicagoBox();
  t.teardown(() => box.cleanup());
  const lines: string[] = [];
  const origErr = console.error;
  console.error = (...args) => { lines.push(args.join(" ")); };
  const code = await runRemind(box.root, { text: "Rice", options: { here: "20m" }, sessionId: "sess-1", checkIns: serverCheckIns() });
  console.error = origErr;
  t.check({ code, lines }, {
    code: 1,
    lines: ["Not set: Cannot reach this box's server: BBX_SERVER_URL is not set. This command asks the server to do the credentialed work, and that needs the box environment (BBX_SERVER_URL, BBX_BOX_NAME, BBX_AGENT_TOKEN). Run it from a box-spawned shell, or run it on the server host with the box service's environment."],
  });
});

void test("the server's refusals reach the agent as one sentence", async (t) => {
  const box = await chicagoBox();
  t.teardown(() => box.cleanup());
  const trpcError = (code: string, message: string) => new TRPCClientError(message, { result: { error: { message, code: -32600, data: { code } } } });
  const gone = fakeCheckIns({ addError: trpcError("NOT_FOUND", "Cannot schedule work for a conversation being deleted") });
  await t.checkText(await run(box.root, { text: "Rice", options: { here: "20m" }, sessionId: "sess-1", client: gone.client }), `stderr: Not set: this chat is ending or was deleted, so a check-in cannot come back to it; set a reminder with --in or --at instead.
exit 1`);
  const bad = fakeCheckIns({ addError: trpcError("BAD_REQUEST", "\"20q\" is not a duration.") });
  await t.checkText(await run(box.root, { text: "Rice", options: { here: "20m" }, sessionId: "sess-1", client: bad.client }), `stderr: Not set: "20q" is not a duration.
exit 1`);
});

void test("cancel removes only this chat's check-in, by label", async (t) => {
  const fake = fakeCheckIns();
  const lines: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...args) => { lines.push(args.join(" ")); };
  console.error = (...args) => { lines.push(`stderr: ${args.join(" ")}`); };
  const codes = [
    await runCancelCheckIn({ label: "rice", sessionId: "sess-1", client: ok(fake.client) }),
    await runCancelCheckIn({ label: "pasta", sessionId: "sess-1", client: ok(fake.client) }),
  ];
  console.log = origLog;
  console.error = origErr;
  t.check({ codes, lines, calls: fake.calls }, {
    codes: [0, 1],
    lines: [
      "Cancelled check-in \"rice\" in this chat.",
      "stderr: Not cancelled: no check-in labeled \"pasta\" in this chat; a reminder card is removed with bbx rm <card path>.",
    ],
    calls: [{ sessionId: "sess-1", label: "rice" }, { sessionId: "sess-1", label: "pasta" }],
  });
});

// The surface table's smoke run for `remind` is `--help`; the verb is registered
// at the top level, with `cancel` as its one subcommand.
void test("bbx remind is on the agent surface with its help", async (t) => {
  const remind = buildProgram(await loadCommands({ kind: "verb", key: "remind" })).commands.find((c) => c.name() === "remind");
  t.check([remind?.usage(), remind?.commands.map((c) => c.name()), remind?.options.map((o) => o.long)], [
    "[options] [command] [text...]",
    ["cancel"],
    ["--here", "--in", "--at", "--body", "--loudness", "--context", "--label", "--alarm", "--announce"],
  ]);
});
