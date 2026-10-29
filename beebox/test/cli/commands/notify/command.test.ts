// # `bbx notify`: reach the boxholder from an agent
//
// `src/cli/commands/notify/command.ts` parses the flags, reads the body, and calls
// `notifyBoxholder`, in this process or, from a box-spawned shell, in the box
// server's (last section). `runNotify(boxRoot, run)` is driven directly and returns the
// exit code (same approach as `test/cli/commands/todos.test.ts`): 0 when the
// notification reached the person, 1 when it reached nobody, 2 on a bad flag or
// target.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { notifySource, runNotify, type NotifyCliOptions } from "../../../../src/cli/commands/notify/command.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";
import { boxSlug } from "../../../../src/lib/box-slug.js";
import type { NotifyServices } from "../../../../src/core/notify-boxholder.js";
import { addSubscription } from "../../../../src/core/push-subscriptions.js";
import { createFakePush } from "../../../../src/services/push.js";
import { readRecent } from "../../../../src/core/notification/log.js";
import { writePresence } from "../../../../src/core/notification/presence.js";
import { pairFakePushDevice } from "../../../../src/core/mobile/pairing.js";
import { createFakeApns } from "../../../../src/services/apns.js";
import { makeTestServer, TEST_SLUG } from "../../../helpers/test-route-server.js";
import { getOrCreateAgentToken } from "../../../../src/core/agent/token.js";

const storeDir = path.join(os.tmpdir(), `bbx-notify-cli-${process.pid}-${Date.now()}`);
process.env.BBX_PUSH_STORE_DIR = storeDir;
// No box environment: every section but the last delivers in this process.
for (const name of ["BBX_SERVER_URL", "BBX_BOX_NAME", "BBX_AGENT_TOKEN", "BBX_VAPID_PUBLIC_KEY", "BBX_VAPID_PRIVATE_KEY", "BBX_NOTIFY_FAKE", "BBX_PUSH_FAKE", "BBX_APNS_KEY_PATH", "BBX_APNS_KEY_ID", "BBX_APNS_TEAM_ID", "BBX_APNS_BUNDLE_ID", "BBX_PUBLIC_URL", "PUBLIC_URL"]) delete process.env[name];

// A box whose boxholder subscribed a browser.
const box = await makeTmpBox({ git: true });
await addSubscription({
  boxSlug: await boxSlug(box.root),
  subscription: { endpoint: "https://push.example/phone", keys: { p256dh: "p", auth: "a" } },
  now: new Date(),
});
const push = createFakePush();

// Run with captured output; ids are random (a letter, then 8 base64url
// characters), so they print as <id>.
const ID = /\bn[\w-]{8}(?=: (apns|web-push) )/;
async function run({ title, options, stdin, services, root }: {
  title: string | undefined;
  options: NotifyCliOptions;
  stdin?: string;
  services?: NotifyServices;
  root?: string;
}) {
  const out: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...args) => { out.push(args.join(" ")); };
  console.error = (...args) => { out.push(`stderr: ${args.join(" ")}`); };
  let code: number | undefined;
  try {
    code = await runNotify(root ?? box.root, {
      title,
      options,
      readStdin: stdin === undefined ? null : async () => stdin,
      source: "test",
      services: services ?? { push },
    });
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
  return [...out.map((line) => line.replace(ID, "<id>")), `exit ${code}`].join("\n");
}

async function lastIntent() {
  const all = await readRecent(box.root, { days: 1 });
  const last = all.at(-1);
  if (last === undefined) throw new Error("no notification was logged");
  return last.intent;
}

// ## `--check` lists the channels that can reach the person
void test("`--check` lists the channels that can reach the person", async (t) => {
  await t.checkText(await run({ title: undefined, options: { check: true } }), `apns: no
web-push: yes
exit 0`);
});

// A subscribed browser is not enough on its own: without VAPID keys a push
// cannot be sent, so `--check` says no and exits 1:
void test("A subscribed browser is not enough on its own:", async (t) => {
  await t.checkText(await run({ title: undefined, options: { check: true }, services: {} }), `apns: no
web-push: no
exit 1`);
});

// On a box with no channel it exits 1, so an agent knows not to promise a
// reminder:
void test("On a box with no channel it exits 1, so an agent knows not to promise a remin...", async (t) => {
  const bare = await makeTmpBox({ git: true });
  const bareCheck = await run({ title: undefined, options: { check: true }, services: {}, root: bare.root });
  await bare.cleanup();
  await t.checkText(bareCheck, `apns: no
web-push: no
exit 1`);
});

// ## A loud notification sends on every reachable channel
void test("A loud notification sends on every reachable channel", async (t) => {
  await t.checkText(await run({ title: "Field trip form due", options: { target: "card:_content/inbox/field-trip.email.card", loudness: "loud", body: "Sign it by Friday." } }), `<id>: apns skipped (no-audience), web-push sent
exit 0`);

  const slug = await boxSlug(box.root);
  t.check([push.sent.at(-1)?.payload.body, push.sent.at(-1)?.payload.url.replace(slug, "<box>"), push.sent.at(-1)?.payload.silent], [
    "Sign it by Friday.",
    "/<box>/views/_content/inbox/field-trip.email.card",
    false,
  ]);
});

// ## Stdin is the body only when asked: `--body -` or `--body-file -`; `quiet` is the default
//
// An agent's shell or a schedule's pipeline can hold stdin open with nothing
// coming, so `bbx notify` never reads it unasked. With stdin piped and no body
// flag, the body is empty and stdin is left alone.
void test("An agent's shell or a schedule's pipeline can hold stdin open with nothing co...", async (t) => {
  let stdinReads = 0;
  const counted = async () => { stdinReads += 1; return "never read"; };
  const quietLog = console.log;
  console.log = () => {};
  const unasked = await runNotify(box.root, { title: "Unasked", options: { target: "dashboard", channel: "web-push" }, readStdin: counted, source: "test", services: { push } });
  console.log = quietLog;
  t.check([unasked, (await lastIntent()).body, stdinReads], [
    0,
    "",
    0,
  ]);

  await t.checkText(await run({ title: "Weekly summary", options: { target: "dashboard", body: "-" }, stdin: "Three cards changed.\n" }), `<id>: apns skipped (no-audience), web-push sent
exit 0`);

  const summary = await lastIntent();
  t.check([summary.body, summary.loudness, summary.source], [
    "Three cards changed.",
    "quiet",
    "test",
  ]);

  await t.checkText(await run({ title: "From stdin", options: { target: "dashboard", bodyFile: "-", channel: "web-push" }, stdin: "Via --body-file -\n" }), `<id>: web-push sent
exit 0`);

  t.check((await lastIntent()).body, "Via --body-file -");

  // A `-` body with nothing piped, or with stdin already carrying the targets, is
  // a usage error:

  await t.checkText(
    [
      await run({ title: "x", options: { target: "dashboard", body: "-" } }),
      await run({ title: "x", options: { targetsFromStdin: true, bodyFile: "-" }, stdin: "dashboard\n" }),
    ].join("\n"),
    `stderr: Error: the body is stdin (-), but nothing is piped on stdin
exit 2
stderr: Error: stdin carries the targets with --targets-from-stdin; give the body with --body or --body-file
exit 2`,
  );
});

// ## The source: the chat, else the schedule, else the command
//
// From a chat session's shell the source is the chat. In a schedule's pipeline
// the tick sets `BBX_SCHEDULE_NAME` to the card's stem (and lets it through to a
// procedure's shells), so a notification names the schedule that sent it.
void test("From a chat session's shell the source is the chat.", async (t) => {
  await t.checkText(
    [
      notifySource({ chatSession: "s1", env: { BBX_SCHEDULE_NAME: "watch-field-trip" } }),
      notifySource({ chatSession: null, env: { BBX_SCHEDULE_NAME: "watch-field-trip" } }),
      notifySource({ chatSession: null, env: {} }),
    ].join("\n"),
    `chat:s1
schedule:watch-field-trip
bbx notify`,
  );
});

// ## `--body-file` reads the body from a file
void test("`--body-file` reads the body from a file", async (t) => {
  const bodyFile = path.join(box.root, "body.txt");
  await fs.writeFile(bodyFile, "Line one\nLine two\n");
  await t.checkText(await run({ title: "From a file", options: { target: "chat:new", bodyFile, loudness: "loud", channel: "web-push" } }), `<id>: web-push sent
exit 0`);

  await t.checkText((await lastIntent()).body, `Line one
Line two`);
});

// ## `--targets-from-stdin` sends one notification per target
void test("`--targets-from-stdin` sends one notification per target", async (t) => {
  await t.checkText(await run({ title: "Two cards need review", options: { targetsFromStdin: true, body: "See the card.", loudness: "loud", channel: "web-push" }, stdin: "card:_content/a.doc.card\ncard:_content/b.doc.card\n" }), `<id>: web-push sent
<id>: web-push sent
exit 0`);
});

// ## A notification that reaches nobody exits 1 with the delivery detail
//
// Every tried channel failed:
void test("Every tried channel failed:", async (t) => {
  const failingPush = createFakePush({ failEndpoints: ["https://push.example/phone"] });
  await t.checkText(await run({ title: "Will not arrive", options: { target: "dashboard", loudness: "loud", channel: "web-push" }, services: { push: failingPush } }), `stderr: Not delivered: <id>: web-push failed (no device received the push (sent 0, pruned 0, failed 1))
exit 1`);
});

// ## Bad flags and bad targets exit 2 before anything is sent
void test("Bad flags and bad targets exit 2 before anything is sent", async (t) => {
  const before = await readRecent(box.root, { days: 1 });
  await t.checkText(
    [
      await run({ title: "x", options: {} }),
      await run({ title: "x", options: { target: "nowhere" } }),
      await run({ title: "x", options: { target: "dashboard", loudness: "shout" } }),
      await run({ title: "x", options: { target: "dashboard", channel: "pager" } }),
      await run({ title: "x", options: { target: "dashboard", body: "a", bodyFile: "b" } }),
      await run({ title: "", options: { target: "dashboard" } }),
      await run({ title: "x", options: { targetsFromStdin: true, body: "b" }, stdin: "dashboard\ncard:../outside.card\n" }),
    ].join("\n"),
    `stderr: Error: --target is required (or --targets-from-stdin)
exit 2
stderr: Error: Invalid notification target "nowhere": no scheme. Valid targets: chat:<sessionId>, chat:new, card:<path>, question:<path>, admin:<section>, dashboard
exit 2
stderr: Error: --loudness must be one of dot, quiet, loud (got "shout")
exit 2
stderr: Error: --channel must be one of apns, web-push (got "pager")
exit 2
stderr: Error: give --body or --body-file, not both
exit 2
stderr: Error: a title is required
exit 2
stderr: Error: Invalid notification target "card:../outside.card": the path must name a file inside the box's underscore areas. Valid targets: chat:<sessionId>, chat:new, card:<path>, question:<path>, admin:<section>, dashboard
exit 2`,
  );

  t.check(await readRecent(box.root, { days: 1 }), before);
});

// ## `--dry-run` shows what a send would do, and sends nothing
//
// It prints the intent, who each channel would reach (and whether the server
// could send on it), the presence reading, and the channels a send would try
// and skip. Nothing is sent and nothing is logged. The paired phone here has a
// registration, but the server has no APNs key.
void test("It prints the intent, who each channel would reach (and whether the server co...", async (t) => {
  await pairFakePushDevice(box.root, { label: "test phone" });
  await writePresence(box.root, { activeWeb: 0, now: new Date() });
  const sentBefore = [...push.sent];
  const loggedBefore = await readRecent(box.root, { days: 1 });
  await t.checkText(await run({ title: "Pick up Sam", options: { target: "chat:new", loudness: "loud", body: "At 3.", tag: "pickup", dryRun: true } }), `intent: loud "Pick up Sam" -> chat:new (tag pickup)
body: At 3.
presence: 0 active web sessions (live reading)
audience:
  apns: 1 device (test phone, sandbox) [unconfigured]
  web-push: 1 subscription
would try: apns, web-push
would skip: none
dry run: nothing sent, nothing logged
exit 0`);

  t.check([push.sent, await readRecent(box.root, { days: 1 })], [sentBefore, loggedBefore]);

  // The dry run applies the same rule a send does, so it shows the effect of the
  // live presence reading and of `--channel`. `--presence <n>` substitutes a
  // reading, to preview a `quiet` notification with someone in the app:

  await t.checkText(await run({ title: "Pick up Sam", options: { target: "chat:new", loudness: "quiet", dryRun: true, presence: "2", channel: "web-push" } }), `intent: quiet "Pick up Sam" -> chat:new
presence: 2 active web sessions (--presence)
audience:
  apns: 1 device (test phone, sandbox) [unconfigured]
  web-push: 1 subscription
would try: none
would skip: web-push (present)
dry run: nothing sent, nothing logged
exit 0`);

  await t.checkText(
    [
      await run({ title: "x", options: { target: "dashboard", presence: "1" } }),
      await run({ title: "x", options: { target: "dashboard", presence: "some", dryRun: true } }),
    ].join("\n"),
    `stderr: Error: --presence applies only with --dry-run
exit 2
stderr: Error: --presence must be a whole number of active web sessions (got "some")
exit 2`,
  );

  // A dry run needs no `--target`: it previews `chat:new`, where most
  // notifications land. A send still requires one.

  t.check((await run({ title: "Pick up Sam", options: { dryRun: true } })).split("\n")[0], "intent: quiet \"Pick up Sam\" -> chat:new");

  // ## Fake mode shows in a dry run
  //
  // Under `BBX_NOTIFY_FAKE=1` every channel is configured through its fake:

  process.env.BBX_NOTIFY_FAKE = "1";
  const fakeRun = await run({ title: "Pick up Sam", options: { target: "dashboard", loudness: "dot", dryRun: true }, services: {} });
  delete process.env.BBX_NOTIFY_FAKE;
  await t.checkText(fakeRun, `intent: dot "Pick up Sam" -> dashboard
presence: 0 active web sessions (live reading)
fake mode: every channel sends through its fake (BBX_NOTIFY_FAKE)
audience:
  apns: 1 device (test phone, sandbox)
  web-push: 1 subscription
would try: apns
would skip: none
dry run: nothing sent, nothing logged
exit 0`);
});

// ## From a box-spawned shell, the box server delivers
//
// An agent's shell, or a script a schedule runs, has `BBX_SERVER_URL`,
// `BBX_BOX_NAME`, and the agent token, and none of the APNs or VAPID keys. There
// `bbx notify` asks the box server, which has them, through
// `notifications.send` and `notifications.channels`. The server here holds fake
// services for every channel; this process holds its own, which must stay
// untouched. The auth wall is up, so the agent bearer is doing real work.
void test("An agent's shell, or a script a schedule runs, has BBXSERVERURL, BBXBOXNAME,...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
      await fs.rm(storeDir, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  const serverApns = createFakeApns();
  const serverPush = createFakePush();
  const server = await makeTestServer({ openAccess: false, services: { notify: { apns: serverApns, push: serverPush } } });
  await pairFakePushDevice(server.boxRoot, { label: "test phone" });
  await addSubscription({
    boxSlug: await boxSlug(server.boxRoot),
    subscription: { endpoint: "https://push.example/phone", keys: { p256dh: "p", auth: "a" } },
    now: new Date(),
  });
  process.env.BBX_SERVER_URL = await server.server.listen({ port: 0, host: "127.0.0.1" });
  process.env.BBX_BOX_NAME = TEST_SLUG;
  process.env.BBX_AGENT_TOKEN = getOrCreateAgentToken(server.boxRoot);

  const localApns = createFakeApns();
  const local = { apns: localApns, push };
  const localBefore = [localApns.sent.length, push.sent.length];
  await t.checkText(await run({ title: "Pick up Sam", options: { target: "chat:new", loudness: "loud", body: "At 3." }, services: local, root: server.boxRoot }), `<id>: apns sent, web-push sent
exit 0`);

  t.check(
    {
      server: [serverApns.sent.length, serverPush.sent.length],
      localUntouched: JSON.stringify([localApns.sent.length, push.sent.length]) === JSON.stringify(localBefore),
    },
    {
    server: [
      1,
      1,
    ],
    localUntouched: true,
  },
  );

  // The server logged it, with this shell's source:

  t.check((await readRecent(server.boxRoot, { days: 1 })).at(-1)?.intent.source, "test");

  // `--check` reports what the server can reach, so an agent never hears "no" for
  // a channel only the server has keys for. `--verbose` names the path, on stderr;
  // without it nothing about the path is printed.

  await t.checkText((await run({ title: undefined, options: { check: true, verbose: true }, services: {}, root: server.boxRoot })).replace(process.env.BBX_SERVER_URL, "<server>"), `stderr: [notify] via the box server (<server>)
apns: yes
web-push: yes
exit 0`);

  // `--dry-run` reads the same audience from the box and takes the channel keys
  // from the server, so the phone is not `[unconfigured]` here:

  await t.checkText(await run({ title: "Pick up Sam", options: { target: "chat:new", loudness: "loud", dryRun: true, presence: "0" }, services: {}, root: server.boxRoot }), `intent: loud "Pick up Sam" -> chat:new
presence: 0 active web sessions (--presence)
audience:
  apns: 1 device (test phone, sandbox)
  web-push: 1 subscription
would try: apns, web-push
would skip: none
dry run: nothing sent, nothing logged
exit 0`);

  // A server that is named but does not answer is an error: delivering in this
  // process instead would quietly lose the channels only the server has keys for.

  await server.cleanup();
  const beforeDown = [[...localApns.sent], [...push.sent]];
  const down = await run({ title: "Pick up Sam", options: { target: "dashboard", loudness: "loud" }, services: local, root: server.boxRoot }).catch((e) => `threw: ${e.name}: ${e.message.split(":")[0]}`);
  t.check([down, [localApns.sent, push.sent]], [
    "threw: NotifyServerError: The box's server could not be reached",
    beforeDown,
  ]);

  // With no box environment it delivers in this process again, and `--verbose`
  // says why:

  delete process.env.BBX_SERVER_URL;
  delete process.env.BBX_BOX_NAME;
  delete process.env.BBX_AGENT_TOKEN;
  t.check((await run({ title: undefined, options: { check: true, verbose: true } })).split("\n")[0], "stderr: [notify] in this process (BBX_SERVER_URL is not set)");
});
