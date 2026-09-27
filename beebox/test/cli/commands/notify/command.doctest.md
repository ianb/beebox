# `bbx notify`: reach the boxholder from an agent

`src/cli/commands/notify.ts` parses the flags, reads the body, and calls
`notifyBoxholder`, in this process or, from a box-spawned shell, in the box
server's (last section). `runNotify(boxRoot, run)` is driven directly and returns the
exit code (same approach as `test/cli/todos.doctest.md`): 0 when the
notification reached the person, 1 when it reached nobody, 2 on a bad flag or
target.

```ts setup
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { notifySource, runNotify } from "../../../../src/cli/commands/notify/command.js";
import { makeTmpBox } from "../../../helpers/doctest-helpers.js";
import { boxSlug } from "../../../../src/lib/box-slug.js";
import { addSubscription } from "../../../../src/core/push-subscriptions.js";
import { createFakePush } from "../../../../src/services/push.js";
import { createFakeTelegram } from "../../../../src/services/telegram.js";
import { readRecent } from "../../../../src/core/notification/log.js";
import { writePresence } from "../../../../src/core/notification/presence.js";
import { pairFakePushDevice } from "../../../../src/core/mobile/pairing.js";
import { createFakeApns } from "../../../../src/services/apns.js";
import { makeTestServer, TEST_SLUG } from "../../../helpers/doctest-server.js";
import { getOrCreateAgentToken } from "../../../../src/core/agent/token.js";

const storeDir = path.join(os.tmpdir(), `bbx-notify-cli-${process.pid}-${Date.now()}`);
process.env.BBX_PUSH_STORE_DIR = storeDir;
// No box environment: every section but the last delivers in this process.
for (const name of ["BBX_SERVER_URL", "BBX_BOX_NAME", "BBX_AGENT_TOKEN", "BBX_VAPID_PUBLIC_KEY", "BBX_VAPID_PRIVATE_KEY", "BBX_NOTIFY_FAKE", "BBX_PUSH_FAKE", "BBX_APNS_KEY_PATH", "BBX_APNS_KEY_ID", "BBX_APNS_TEAM_ID", "BBX_APNS_BUNDLE_ID", "BBX_PUBLIC_URL", "PUBLIC_URL"]) delete process.env[name];

// A box whose boxholder subscribed a browser and set a Telegram chat.
const box = await makeTmpBox({ git: true });
await box.seed("_config/box.json", JSON.stringify({ healthAlerts: { telegramChat: "777" } }));
box.commitAll("seed");
await addSubscription({
  boxSlug: await boxSlug(box.root),
  subscription: { endpoint: "https://push.example/phone", keys: { p256dh: "p", auth: "a" } },
  now: new Date(),
});
const tg = createFakeTelegram({ username: "bot" });
const push = createFakePush();

// Run with captured output; ids are random (a letter, then 8 base64url
// characters), so they print as <id>.
const ID = /\bn[\w-]{8}(?=: (apns|web-push|telegram) )/;
async function run(title, options, stdin, services = { tg, push }, root = box.root) {
  const out = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...args) => { out.push(args.join(" ")); };
  console.error = (...args) => { out.push(`stderr: ${args.join(" ")}`); };
  let code;
  try {
    code = await runNotify(root, {
      title,
      options,
      readStdin: stdin === undefined ? null : async () => stdin,
      source: "doctest",
      services,
    });
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
  return [...out.map((line) => line.replace(ID, "<id>")), `exit ${code}`].join("\n");
}

async function lastIntent() {
  const all = await readRecent(box.root, { days: 1 });
  return all.at(-1).intent;
}
```

## `--check` lists the channels that can reach the person

```ts
await run(undefined, { check: true })
=>
apns: no
web-push: yes
telegram: yes
exit 0
```

A subscribed browser and a Telegram chat are not enough on their own: without
VAPID keys a push cannot be sent, and without the bot secret a Telegram
message cannot, so `--check` says no and exits 1:

```ts
await run(undefined, { check: true }, undefined, {})
=>
apns: no
web-push: no
telegram: no
exit 1
```

On a box with no channel it exits 1, so an agent knows not to promise a
reminder:

```ts
const bare = await makeTmpBox({ git: true });
const lines = [];
const origLog = console.log;
console.log = (...args) => { lines.push(args.join(" ")); };
const code = await runNotify(bare.root, { title: undefined, options: { check: true }, readStdin: null, source: "doctest" });
console.log = origLog;
await bare.cleanup();
[...lines, `exit ${code}`].join("\n")
=>
apns: no
web-push: no
telegram: no
exit 1
```

## A loud notification sends on every reachable channel

```ts
await run("Field trip form due", { target: "card:_content/inbox/field-trip.email.card", loudness: "loud", body: "Sign it by Friday." })
=>
<id>: apns skipped (no-audience), web-push sent, telegram sent
exit 0

const slug = await boxSlug(box.root);
JSON.stringify([tg.sent.at(-1).text.replace(slug, "<box>"), tg.sent.at(-1).silent])
=> ["Field trip form due\nSign it by Friday.\n/<box>/browse/_content/inbox/field-trip.email.card",false]
```

## Stdin is the body only when asked: `--body -` or `--body-file -`; `quiet` is the default

An agent's shell or a schedule's pipeline can hold stdin open with nothing
coming, so `bbx notify` never reads it unasked. With stdin piped and no body
flag, the body is empty and stdin is left alone.

```ts
let stdinReads = 0;
const counted = async () => { stdinReads += 1; return "never read"; };
const quietLog = console.log;
console.log = () => {};
const unasked = await runNotify(box.root, { title: "Unasked", options: { target: "dashboard", channel: "telegram" }, readStdin: counted, source: "doctest", services: { tg, push } });
console.log = quietLog;
JSON.stringify([unasked, (await lastIntent()).body, stdinReads])
=> [0,"",0]

await run("Weekly summary", { target: "dashboard", body: "-" }, "Three cards changed.\n")
=>
<id>: apns skipped (no-audience), web-push sent, telegram sent
exit 0

const summary = await lastIntent();
JSON.stringify([summary.body, summary.loudness, summary.source])
=> ["Three cards changed.","quiet","doctest"]

await run("From stdin", { target: "dashboard", bodyFile: "-", channel: "telegram" }, "Via --body-file -\n")
=>
<id>: telegram sent
exit 0

(await lastIntent()).body
=> Via --body-file -
```

A `-` body with nothing piped, or with stdin already carrying the targets, is
a usage error:

```ts continue
[
  await run("x", { target: "dashboard", body: "-" }),
  await run("x", { targetsFromStdin: true, bodyFile: "-" }, "dashboard\n"),
].join("\n")
=>
stderr: Error: the body is stdin (-), but nothing is piped on stdin
exit 2
stderr: Error: stdin carries the targets with --targets-from-stdin; give the body with --body or --body-file
exit 2
```

## The source: the chat, else the schedule, else the command

From a chat session's shell the source is the chat. In a schedule's pipeline
the tick sets `BBX_SCHEDULE_NAME` to the card's stem (and lets it through to a
procedure's shells), so a notification names the schedule that sent it.

```ts
[
  notifySource({ chatSession: "s1", env: { BBX_SCHEDULE_NAME: "watch-field-trip" } }),
  notifySource({ chatSession: null, env: { BBX_SCHEDULE_NAME: "watch-field-trip" } }),
  notifySource({ chatSession: null, env: {} }),
].join("\n")
=>
chat:s1
schedule:watch-field-trip
bbx notify
```

## `--body-file` reads the body from a file

```ts
const bodyFile = path.join(box.root, "body.txt");
await fs.writeFile(bodyFile, "Line one\nLine two\n");
await run("From a file", { target: "chat:new", bodyFile, loudness: "loud", channel: "telegram" })
=>
<id>: telegram sent
exit 0

(await lastIntent()).body
=>
Line one
Line two
```

## `--targets-from-stdin` sends one notification per target

```ts
await run("Two cards need review", { targetsFromStdin: true, body: "See the card.", loudness: "loud", channel: "web-push" }, "card:_content/a.memo.card\ncard:_content/b.memo.card\n")
=>
<id>: web-push sent
<id>: web-push sent
exit 0
```

## A notification that reaches nobody exits 1 with the delivery detail

Every tried channel failed:

```ts
const failingPush = createFakePush({ failEndpoints: ["https://push.example/phone"] });
const out = [];
const origErr = console.error;
console.error = (...args) => { out.push(args.join(" ")); };
const code = await runNotify(box.root, {
  title: "Will not arrive",
  options: { target: "dashboard", loudness: "loud", channel: "web-push" },
  readStdin: null,
  source: "doctest",
  services: { push: failingPush },
});
console.error = origErr;
[out.join("\n").replace(ID, "<id>"), `exit ${code}`].join("\n")
=>
Not delivered: <id>: web-push failed (no device received the push (sent 0, pruned 0, failed 1))
exit 1
```

## Bad flags and bad targets exit 2 before anything is sent

```ts
const before = (await readRecent(box.root, { days: 1 })).length;
[
  await run("x", {}),
  await run("x", { target: "nowhere" }),
  await run("x", { target: "dashboard", loudness: "shout" }),
  await run("x", { target: "dashboard", channel: "pager" }),
  await run("x", { target: "dashboard", body: "a", bodyFile: "b" }),
  await run("", { target: "dashboard" }),
  await run("x", { targetsFromStdin: true, body: "b" }, "dashboard\ncard:../outside.card\n"),
].join("\n")
=>
stderr: Error: --target is required (or --targets-from-stdin)
exit 2
stderr: Error: Invalid notification target "nowhere": no scheme. Valid targets: chat:<sessionId>, chat:new, card:<path>, question:<path>, admin:<section>, dashboard
exit 2
stderr: Error: --loudness must be one of dot, quiet, loud (got "shout")
exit 2
stderr: Error: --channel must be one of apns, web-push, telegram (got "pager")
exit 2
stderr: Error: give --body or --body-file, not both
exit 2
stderr: Error: a title is required
exit 2
stderr: Error: Invalid notification target "card:../outside.card": the path must name a file inside the box's underscore areas. Valid targets: chat:<sessionId>, chat:new, card:<path>, question:<path>, admin:<section>, dashboard
exit 2

(await readRecent(box.root, { days: 1 })).length === before
=> true
```

## `--dry-run` shows what a send would do, and sends nothing

It prints the intent, who each channel would reach (and whether the server
could send on it), the presence reading, and the channels a send would try
and skip. Nothing is sent and nothing is logged. The paired phone here has a
registration, but the server has no APNs key.

```ts
await pairFakePushDevice(box.root, { label: "test phone" });
await writePresence(box.root, { activeWeb: 0, now: new Date() });
const sentBefore = [push.sent.length, tg.sent.length];
const loggedBefore = (await readRecent(box.root, { days: 1 })).length;
await run("Pick up Sam", { target: "chat:new", loudness: "loud", body: "At 3.", tag: "pickup", dryRun: true })
=>
intent: loud "Pick up Sam" -> chat:new (tag pickup)
body: At 3.
presence: 0 active web sessions (live reading)
audience:
  apns: 1 device (test phone, sandbox) [unconfigured]
  web-push: 1 subscription
  telegram: chat 777
would try: apns, web-push, telegram
would skip: none
dry run: nothing sent, nothing logged
exit 0

JSON.stringify([JSON.stringify([push.sent.length, tg.sent.length]) === JSON.stringify(sentBefore), (await readRecent(box.root, { days: 1 })).length === loggedBefore])
=> [true,true]
```

The dry run applies the same rule a send does, so it shows the effect of the
live presence reading and of `--channel`. `--presence <n>` substitutes a
reading, to preview a `quiet` notification with someone in the app:

```ts continue
await run("Pick up Sam", { target: "chat:new", loudness: "quiet", dryRun: true, presence: "2", channel: "telegram" })
=>
intent: quiet "Pick up Sam" -> chat:new
presence: 2 active web sessions (--presence)
audience:
  apns: 1 device (test phone, sandbox) [unconfigured]
  web-push: 1 subscription
  telegram: chat 777
would try: none
would skip: telegram (present)
dry run: nothing sent, nothing logged
exit 0

[
  await run("x", { target: "dashboard", presence: "1" }),
  await run("x", { target: "dashboard", presence: "some", dryRun: true }),
].join("\n")
=>
stderr: Error: --presence applies only with --dry-run
exit 2
stderr: Error: --presence must be a whole number of active web sessions (got "some")
exit 2
```

A dry run needs no `--target`: it previews `chat:new`, where most
notifications land. A send still requires one.

```ts continue
(await run("Pick up Sam", { dryRun: true })).split("\n")[0]
=> intent: quiet "Pick up Sam" -> chat:new
```

## Fake mode shows in a dry run

Under `BBX_NOTIFY_FAKE=1` every channel is configured through its fake:

```ts continue
process.env.BBX_NOTIFY_FAKE = "1";
const fakeRun = await run("Pick up Sam", { target: "dashboard", loudness: "dot", dryRun: true }, undefined, {});
delete process.env.BBX_NOTIFY_FAKE;
fakeRun
=>
intent: dot "Pick up Sam" -> dashboard
presence: 0 active web sessions (live reading)
fake mode: every channel sends through its fake (BBX_NOTIFY_FAKE)
audience:
  apns: 1 device (test phone, sandbox)
  web-push: 1 subscription
  telegram: chat 777
would try: apns
would skip: none
dry run: nothing sent, nothing logged
exit 0
```

## From a box-spawned shell, the box server delivers

An agent's shell, or a script a schedule runs, has `BBX_SERVER_URL`,
`BBX_BOX_NAME`, and the agent token, and none of the APNs or VAPID keys. There
`bbx notify` asks the box server, which has them, through
`notifications.send` and `notifications.channels`. The server here holds fake
services for every channel; this process holds its own, which must stay
untouched. The auth wall is up, so the agent bearer is doing real work.

```ts
const serverApns = createFakeApns();
const serverPush = createFakePush();
const serverTg = createFakeTelegram({ username: "bot" });
const server = await makeTestServer({ openAccess: false, services: { notify: { apns: serverApns, push: serverPush, tg: serverTg } } });
await fs.writeFile(path.join(server.boxRoot, "_config/box.json"), JSON.stringify({ healthAlerts: { telegramChat: "777" } }));
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
const local = { apns: localApns, push, tg };
const localBefore = [localApns.sent.length, push.sent.length, tg.sent.length];
await run("Pick up Sam", { target: "chat:new", loudness: "loud", body: "At 3." }, undefined, local, server.boxRoot)
=>
<id>: apns sent, web-push sent, telegram sent
exit 0

JSON.stringify({
  server: [serverApns.sent.length, serverPush.sent.length, serverTg.sent.length],
  localUntouched: JSON.stringify([localApns.sent.length, push.sent.length, tg.sent.length]) === JSON.stringify(localBefore),
})
=> {"server":[1,1,1],"localUntouched":true}
```

The server logged it, with this shell's source:

```ts continue
JSON.stringify((await readRecent(server.boxRoot, { days: 1 })).at(-1).intent.source)
=> "doctest"
```

`--check` reports what the server can reach, so an agent never hears "no" for
a channel only the server has keys for. `--verbose` names the path, on stderr;
without it nothing about the path is printed.

```ts continue
(await run(undefined, { check: true, verbose: true }, undefined, {}, server.boxRoot)).replace(process.env.BBX_SERVER_URL, "<server>")
=>
stderr: [notify] via the box server (<server>)
apns: yes
web-push: yes
telegram: yes
exit 0
```

`--dry-run` reads the same audience from the box and takes the channel keys
from the server, so the phone is not `[unconfigured]` here:

```ts continue
await run("Pick up Sam", { target: "chat:new", loudness: "loud", dryRun: true, presence: "0" }, undefined, {}, server.boxRoot)
=>
intent: loud "Pick up Sam" -> chat:new
presence: 0 active web sessions (--presence)
audience:
  apns: 1 device (test phone, sandbox)
  web-push: 1 subscription
  telegram: chat 777
would try: apns, web-push, telegram
would skip: none
dry run: nothing sent, nothing logged
exit 0
```

A server that is named but does not answer is an error: delivering in this
process instead would quietly lose the channels only the server has keys for.

```ts continue
await server.cleanup();
const beforeDown = [localApns.sent.length, push.sent.length, tg.sent.length].join();
const down = await run("Pick up Sam", { target: "dashboard", loudness: "loud" }, undefined, local, server.boxRoot).catch((e) => `threw: ${e.name}: ${e.message.split(":")[0]}`);
JSON.stringify([down, [localApns.sent.length, push.sent.length, tg.sent.length].join() === beforeDown])
=> ["threw: NotifyServerError: The box's server could not be reached",true]
```

With no box environment it delivers in this process again, and `--verbose`
says why:

```ts continue
delete process.env.BBX_SERVER_URL;
delete process.env.BBX_BOX_NAME;
delete process.env.BBX_AGENT_TOKEN;
(await run(undefined, { check: true, verbose: true })).split("\n")[0]
=> stderr: [notify] in this process (BBX_SERVER_URL is not set)
```

```ts cleanup
await box.cleanup();
await fs.rm(storeDir, { recursive: true, force: true });
```
