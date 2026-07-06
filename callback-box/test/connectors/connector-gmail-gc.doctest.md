# Gmail garbage collection

When a thread's triggering label is removed upstream (the user archives it or
drops the label), the box still holds a pending card under `box/inbox/email/`.
A reconciliation pass full-lists the currently-matching messages, diffs the
matching Gmail **thread** ids against the pending cards, and withdraws the
orphans to `store/trash/`.

Reconciliation runs on a cadence (`gcIntervalHours`, default 24); the tests set
it to `0` to reconcile on every sync. Only threads still in `box/inbox/email/`
are candidates — *location is state*, so a thread an agent has moved out is
invisible to GC.

```ts setup
import { join } from "node:path";
import { readFile, readdir, rename, mkdir, access } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { initBox } from "../../src/core/box/index.js";
import { splitCardContent } from "../../src/cards/index.js";
import {
  createFakeGoogleGmail,
  type GmailMessage,
} from "../../src/services/google-gmail.js";
import { createGmailConnector } from "../../src/connectors/gmail.js";
import { createIntakeJobTemplate } from "../../src/schemas/intake-job.js";

function makeGmailMessage(opts: {
  id: string;
  subject: string;
  labelIds: string[];
}): GmailMessage {
  return {
    id: opts.id,
    threadId: `t-${opts.id}`,
    labelIds: opts.labelIds,
    internalDate: "1600000000000",
    payload: {
      mimeType: "text/plain",
      headers: [
        { name: "Message-ID", value: `<${opts.id}@example.com>` },
        { name: "From", value: "alice@example.com" },
        { name: "To", value: "me@example.com" },
        { name: "Subject", value: opts.subject },
      ],
      body: { data: "SGVsbG8" },
    },
  };
}

function frontmatter(text: string): Record<string, unknown> {
  const split = splitCardContent(text);
  return parseYaml(split.frontmatterText) ?? {};
}

/** Sorted thread-ids of the cards still pending in box/inbox/email. */
async function pendingThreads(root: string): Promise<string[]> {
  const dir = join(root, "box/inbox/email");
  let files: string[];
  try {
    files = await readdir(dir);
  } catch (_e) {
    return [];
  }
  const ids: string[] = [];
  for (const f of files) {
    if (!f.endsWith(".email-thread.card")) continue;
    const id = frontmatter(await readFile(join(dir, f), "utf-8"))["thread-id"];
    if (typeof id === "string") ids.push(id);
  }
  return ids.sort();
}

/** Count email-thread cards sitting in store/trash. */
async function trashedThreads(root: string): Promise<number> {
  let files: string[];
  try {
    files = await readdir(join(root, "store/trash"));
  } catch (_e) {
    return 0;
  }
  return files.filter((f) => f.endsWith(".email-thread.card")).length;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (_e) {
    return false;
  }
}
```

## A withdrawn label evicts the pending thread; matching threads stay

Two callback-labeled messages import as two threads. Drop the label from one
and the next sync withdraws only that thread.

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
await box.seed(
  "config/connectors/gmail.json",
  JSON.stringify({ labels: ["callback"], gcIntervalHours: 0 }),
);
box.commitAll("init box");

const gmail = createFakeGoogleGmail({
  labels: [{ id: "Label_7", name: "callback", type: "user" }],
  messages: [
    makeGmailMessage({ id: "m1", subject: "First", labelIds: ["Label_7"] }),
    makeGmailMessage({ id: "m2", subject: "Second", labelIds: ["Label_7"] }),
  ],
});
const connector = createGmailConnector(box.root, gmail);
await connector.sync();
JSON.stringify(await pendingThreads(box.root))
=> ["t-m1","t-m2"]
```

The user archives m1 (label removed). The import half sees nothing new
(`labelsRemoved` isn't consumed); reconciliation full-lists, finds t-m1 no
longer matches, and trashes it. t-m2 still matches and is untouched.

```ts continue
gmail.removeLabelsFromMessage({ id: "m1", labelIds: ["Label_7"] });
await connector.sync();
JSON.stringify(await pendingThreads(box.root))
=> ["t-m2"]

await trashedThreads(box.root)
=> 1
```

A further sync with everything still matching withdraws nothing and makes no
new trash — a quiet no-op.

```ts continue
await connector.sync();
JSON.stringify(await pendingThreads(box.root))
=> ["t-m2"]

await trashedThreads(box.root)
=> 1
```

```ts cleanup
await box.cleanup();
```

## Location is state: a thread moved out of the inbox is never touched

Once an agent moves a thread out of `box/inbox/email/`, GC can't see it — so
removing its label upstream does not withdraw it.

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
await box.seed(
  "config/connectors/gmail.json",
  JSON.stringify({ labels: ["callback"], gcIntervalHours: 0 }),
);
box.commitAll("init box");

const gmail = createFakeGoogleGmail({
  labels: [{ id: "Label_7", name: "callback", type: "user" }],
  messages: [makeGmailMessage({ id: "m1", subject: "Acted on", labelIds: ["Label_7"] })],
});
const connector = createGmailConnector(box.root, gmail);
await connector.sync();

// Simulate an agent archiving the thread: move the card + attach scope out.
const inboxDir = join(box.root, "box/inbox/email");
const card = (await readdir(inboxDir)).find((f) => f.endsWith(".email-thread.card")) ?? "";
const base = card.slice(0, -".email-thread.card".length);
const archiveDir = join(box.root, "store/archive/email");
await mkdir(archiveDir, { recursive: true });
await rename(join(inboxDir, card), join(archiveDir, card));
await rename(join(inboxDir, `${base}.attach`), join(archiveDir, `${base}.attach`));

gmail.removeLabelsFromMessage({ id: "m1", labelIds: ["Label_7"] });
await connector.sync();

// Not withdrawn — it lives in the archive, outside GC's reach.
await trashedThreads(box.root)
=> 0

await exists(join(archiveDir, card))
=> true
```

```ts cleanup
await box.cleanup();
```

## Withdrawing prunes the thread's ref from pending intake jobs

A pending intake job that referenced only the withdrawn thread is itself
trashed, so no job is left pointing at a vanished card.

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
await box.seed(
  "config/connectors/gmail.json",
  JSON.stringify({ labels: ["callback"], gcIntervalHours: 0 }),
);
box.commitAll("init box");

const gmail = createFakeGoogleGmail({
  labels: [{ id: "Label_7", name: "callback", type: "user" }],
  messages: [makeGmailMessage({ id: "m1", subject: "Jobbed", labelIds: ["Label_7"] })],
});
const connector = createGmailConnector(box.root, gmail);
await connector.sync();

const inboxDir = join(box.root, "box/inbox/email");
const card = (await readdir(inboxDir)).find((f) => f.endsWith(".email-thread.card")) ?? "";
const ref = `box/inbox/email/${card}`;
await box.seed(
  "box/jobs/triage.intake-job.card",
  createIntakeJobTemplate({
    source: "gmail",
    description: "Triage 1 inbox item",
    items: [ref],
  }),
);
box.commitAll("queue intake job");

gmail.removeLabelsFromMessage({ id: "m1", labelIds: ["Label_7"] });
await connector.sync();

// Thread withdrawn, and its now-empty job is gone too.
await trashedThreads(box.root)
=> 1

(await readdir(join(box.root, "box/jobs"))).filter((f) => f.endsWith("job.card")).length
=> 0
```

```ts cleanup
await box.cleanup();
```
