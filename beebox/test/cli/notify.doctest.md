# `bbx notify`: reach the boxholder from an agent

`src/cli/commands/notify.ts` parses the flags, reads the body, and calls
`notifyBoxholder`. `runNotify(boxRoot, run)` is driven directly and returns the
exit code (same approach as `test/cli/todos.doctest.md`): 0 when the
notification reached the person, 1 when it reached nobody, 2 on a bad flag or
target.

```ts setup
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { runNotify } from "../../src/cli/commands/notify.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { boxSlug } from "../../src/lib/box-slug.js";
import { addSubscription } from "../../src/core/push-subscriptions.js";
import { createFakePush } from "../../src/services/push.js";
import { createFakeTelegram } from "../../src/services/telegram.js";
import { readRecent } from "../../src/core/notification/log.js";

const storeDir = path.join(os.tmpdir(), `bbx-notify-cli-${process.pid}-${Date.now()}`);
process.env.BBX_PUSH_STORE_DIR = storeDir;
for (const name of ["BBX_VAPID_PUBLIC_KEY", "BBX_VAPID_PRIVATE_KEY", "BBX_PUSH_FAKE", "BBX_PUBLIC_URL", "PUBLIC_URL"]) delete process.env[name];

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
async function run(title, options, stdin, services = { tg, push }) {
  const out = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...args) => { out.push(args.join(" ")); };
  console.error = (...args) => { out.push(`stderr: ${args.join(" ")}`); };
  let code;
  try {
    code = await runNotify(box.root, {
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

## The body comes from piped stdin when no `--body` is given; `quiet` is the default

```ts
await run("Weekly summary", { target: "dashboard" }, "Three cards changed.\n")
=>
<id>: apns skipped (no-audience), web-push sent, telegram sent
exit 0

const summary = await lastIntent();
JSON.stringify([summary.body, summary.loudness, summary.source])
=> ["Three cards changed.","quiet","doctest"]
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

```ts cleanup
await box.cleanup();
await fs.rm(storeDir, { recursive: true, force: true });
```
