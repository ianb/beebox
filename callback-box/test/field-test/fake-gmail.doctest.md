# File-backed fake Gmail

Email intake runs in CLI subprocesses, so a field run hands the Gmail connector
a mailbox on disk instead of an injected service: `CB_FAKE_GMAIL=<state file>`.
The file carries the fake's whole state — messages, labels, attachments, and
the history machinery — and the gate that honors it is fail-closed.

```ts setup
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initBox } from "../../src/core/box/index.js";
import { createGmailConnector } from "../../src/connectors/gmail.js";
import { runConnectors } from "../../src/cli/commands/wakeup-connectors.js";
import { createFakeGoogleGmail } from "../../src/services/google-gmail-fake.js";
import type { GmailMessage } from "../../src/services/google-gmail-types.js";
import { loadEmailFixture } from "../../src/field-test/email-fixture.js";
import { TEST_BOX_MARKER } from "../../src/field-test/run-box.js";
import {
  appendMessageToState,
  createFakeGmailFromState,
  emptyFakeGmailState,
  loadFakeGmailState,
  saveFakeGmailState,
} from "../../src/field-test/fake-gmail-state.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

const labels = [{ id: "INBOX", name: "INBOX", type: "system" }];

function message(opts: { id: string; subject: string }): GmailMessage {
  return {
    id: opts.id,
    threadId: `t-${opts.id}`,
    labelIds: ["INBOX"],
    internalDate: "1785596400000",
    snippet: `Snippet ${opts.id}`,
    payload: {
      mimeType: "text/plain",
      headers: [
        { name: "Message-ID", value: `<${opts.id}@example.com>` },
        { name: "From", value: "sender@example.com" },
        { name: "To", value: "box@example.com" },
        { name: "Subject", value: opts.subject },
      ],
      body: { data: Buffer.from(`Body ${opts.id}`).toString("base64url") },
    },
  };
}

/** A scratch directory for state files and fixtures, outside any box. */
async function scratch(): Promise<string> {
  return mkdtemp(join(tmpdir(), "cb-fake-gmail-"));
}

/** Seed a rule that tracks anything in INBOX, so an arriving message shows up
 *  as cards rather than as a silently advanced cursor. */
const trackInbox = JSON.stringify({
  rules: [{
    name: "inbox",
    query: "label:INBOX",
    action: { type: "track", budget: { threads: 5, window: "7d" } },
  }],
});
```

## A saved mailbox reloads with its history intact

Constructor-seeded mail predates history; `addMessage` appends a record at a
fresh checkpoint. A state file that went through save/load behaves exactly like
an in-memory fake built the same way — including which messages `listHistory`
reports from the pre-injection checkpoint.

```ts
const dir = await scratch();
const statePath = join(dir, "gmail.json");

const inMemory = createFakeGoogleGmail({ labels, messages: [message({ id: "old", subject: "Old" })] });
inMemory.addMessage(message({ id: "new", subject: "New" }));

const state = appendMessageToState({
  state: { ...emptyFakeGmailState(), labels, messages: [message({ id: "old", subject: "Old" })] },
  message: message({ id: "new", subject: "New" }),
});
await saveFakeGmailState(statePath, state);
const reloaded = createFakeGmailFromState(await loadFakeGmailState(statePath));

JSON.stringify(await reloaded.getProfile()) === JSON.stringify(await inMemory.getProfile())
=> true

JSON.stringify(await reloaded.listMessages({})) === JSON.stringify(await inMemory.listMessages({}))
=> true

JSON.stringify(await reloaded.listHistory({ startHistoryId: "1" }))
  === JSON.stringify(await inMemory.listHistory({ startHistoryId: "1" }))
=> true
```

The cursor is persisted, not derived — the reloaded fake continues from the
file's checkpoint rather than restarting at the message count.

```ts continue
(await reloaded.getProfile()).historyId
=> 2

(await reloaded.listHistory({ startHistoryId: "1" })).history.length
=> 1
```

## A malformed state file fails loudly

Every way the file can be wrong surfaces as one error naming the path — never
an empty mailbox that looks like "no new mail".

```ts
const dir = await scratch();
const missing = join(dir, "absent.json");
await loadFakeGmailState(missing)
=> throws FakeGmailStateError

await writeFile(join(dir, "torn.json"), "{\"version\": 1, \"messages\": [");
await loadFakeGmailState(join(dir, "torn.json"))
=> throws FakeGmailStateError

await writeFile(join(dir, "wrong.json"), JSON.stringify({ ...emptyFakeGmailState(), historyId: "2" }));
await loadFakeGmailState(join(dir, "wrong.json")).catch((e) => e.message.split(" — ")[1])
=> historyId: Invalid input: expected number, received string
```

## Injecting mail appends a message and its history record

`cb field-test inject-email` is this, plus reading and writing the file: the
fixture becomes a Gmail message, and the message becomes one `messagesAdded`
record at the next checkpoint.

```ts
const dir = await scratch();
await writeFile(join(dir, "dentist.yaml"), [
  "from: Bright Smiles Dental <appointments@example.com>",
  "to: boxholder@example.com",
  "subject: Your appointment on Thursday",
  "date: 2026-03-02T09:00:00Z",
  "body: |",
  "  See you at 2pm.",
  "",
].join("\n"));

const fixture = await loadEmailFixture(join(dir, "dentist.yaml"));
JSON.stringify({ id: fixture.message.id, threadId: fixture.message.threadId })
=> {"id":"dentist","threadId":"t-dentist"}

const state = appendMessageToState({ state: emptyFakeGmailState(), message: fixture.message });
JSON.stringify(state.historyRecords)
=> [{"id":"2","messagesAdded":[{"message":{"id":"dentist","threadId":"t-dentist","labelIds":["INBOX"]}}]}]

JSON.stringify(state.labels)
=> [{"id":"INBOX","name":"INBOX","type":"system"}]
```

An attachment travels as a base64 record keyed by message and attachment id,
which is what `getAttachment` serves.

```ts continue
await writeFile(join(dir, "flyer.pdf"), "PDF-ish bytes");
await writeFile(join(dir, "school.yaml"), [
  "from: Elementary School <office@example.com>",
  "to: boxholder@example.com",
  "subject: Spring flyer",
  "body: |",
  "  Attached.",
  "attachments:",
  "  - filename: flyer.pdf",
  "    mimeType: application/pdf",
  "    path: flyer.pdf",
  "",
].join("\n"));
const withAttachment = await loadEmailFixture(join(dir, "school.yaml"));
const withState = appendMessageToState({
  state,
  message: withAttachment.message,
  attachments: withAttachment.attachments,
});
Object.keys(withState.attachments).join(",")
=> school:att-1

const fake = createFakeGmailFromState(withState);
Buffer.from((await fake.getAttachment("school", "att-1")).data, "base64url").toString("utf-8")
=> PDF-ish bytes
```

A fixture that would produce mail nobody can address is rejected at load, not
injected: the id becomes the `Message-ID` header, and `Buffer.from(x,"base64")`
would otherwise skip unrecognized characters and hand over corrupt bytes.

```ts continue
await writeFile(join(dir, "school trip.yaml"), [
  "from: Elementary School <office@example.com>",
  "to: boxholder@example.com",
  "subject: Trip",
  "body: nope",
  "",
].join("\n"));
await loadEmailFixture(join(dir, "school trip.yaml"))
=> throws EmailFixtureError

await writeFile(join(dir, "bad-data.yaml"), [
  "from: Elementary School <office@example.com>",
  "to: boxholder@example.com",
  "subject: Trip",
  "body: nope",
  "attachments:",
  "  - filename: flyer.pdf",
  "    mimeType: application/pdf",
  "    data: not base64!",
  "",
].join("\n"));
await loadEmailFixture(join(dir, "bad-data.yaml"))
=> throws EmailFixtureError
```

## The gate refuses a box that is not a field-test box

`CB_FAKE_GMAIL` against a box with no `config/test-box` marker throws at sync.
It never falls back to the real Gmail service, and never warns and continues —
silently diverting a real box's mail is the failure this gate exists to
prevent.

```ts
const dir = await scratch();
const statePath = join(dir, "gmail.json");
await saveFakeGmailState(statePath, { ...emptyFakeGmailState(), labels });
const box = await makeTmpBox({ git: true });
await initBox(box.root);
await box.seed("config/connectors/gmail.json", trackInbox);
box.commitAll("initialize box");
process.env.CB_FAKE_GMAIL = statePath;

await createGmailConnector(box.root).sync()
=> throws FakeGmailNotPermittedError
```

`cb wakeup`'s connector loop absorbs sync failures so one flaky service cannot
stop a cycle — but this is a misconfiguration, not a failed sync, so it is a
`ConnectorFatalError` and the loop rethrows instead of printing a line and
carrying on into intake, the reactor and push.

```ts continue
await runConnectors(box.root, { connector: "gmail" })
=> throws FakeGmailNotPermittedError
```

With the marker in place the same box syncs from the file. A first sync only
establishes the checkpoint and baselines the rule; the injected message then
arrives as cards, and nothing else does.

```ts continue
await box.seed(TEST_BOX_MARKER, "field-test box\n");
box.commitAll("mark as a field-test box");

(await createGmailConnector(box.root).sync()).created.length
=> 0

await saveFakeGmailState(statePath, appendMessageToState({
  state: await loadFakeGmailState(statePath),
  message: message({ id: "arrived", subject: "Arrived" }),
}));
const result = await createGmailConnector(box.root).sync();
JSON.stringify(result.created.map((p) => p.split(".").slice(-2).join(".")).sort())
=> ["body.txt","email-message.card","email-thread.card"]

const messageCard = result.created.find((p) => p.endsWith(".email-message.card")) ?? "";
const card = await readFile(join(box.root, messageCard), "utf-8");
card.includes("Arrived")
=> true
```

```ts cleanup
delete process.env.CB_FAKE_GMAIL;
await box.cleanup();
```

## An unset env var leaves the real path alone

Without `CB_FAKE_GMAIL` the connector behaves exactly as before: a box with no
Google access syncs to a no-op rather than reaching for a fake.

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
box.commitAll("initialize box");
JSON.stringify(await createGmailConnector(box.root).sync())
=> {"success":true,"created":[],"updated":[]}
```

```ts cleanup
await box.cleanup();
```
