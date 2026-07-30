# Chat Review: a run end to end

`src/core/chat/review/run.ts` walks the husks whose transcripts have grown,
asks a reviewer for a title / `contains` / account, writes them to the husk, and
advances the journal.

The reviewer is behind an interface, so this exercises the whole pipeline with a
scripted fake and no model.

```ts setup
import { mkdir, readFile, utimes, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { makeTmpBox } from "../../../helpers/doctest-helpers.js";
import { getSessionLogPath } from "../../../../src/core/chat/session/transcript-paths.js";
import { runChatReview } from "../../../../src/core/chat/review/run.js";
import { loadReviewState } from "../../../../src/core/chat/review/state.js";
import { getSessionMetadata } from "../../../../src/cli/lib/session.js";

const NOW = new Date("2026-07-28T12:00:00Z");
const HOUR = 60 * 60 * 1000;

/** A reviewer that returns canned output and records what it was asked. */
function fakeReviewer(outputs) {
  const calls = [];
  let i = 0;
  return {
    calls,
    async review(args) {
      calls.push(args);
      const out = outputs[Math.min(i, outputs.length - 1)];
      i += 1;
      if (out instanceof Error) throw out;
      return out;
    },
  };
}

function userEntry(uuid: string, text: string) {
  return {
    type: "user",
    uuid,
    timestamp: "2026-07-28T03:00:00Z",
    message: { role: "user", content: [{ type: "text", text }] },
  };
}

/** Seed a husk card plus a backdated transcript big enough to clear the gate. */
async function seed(box, opts: { sessionId: string; husk: string; entries: object[] }) {
  await box.write(`store/chat/web/2026-07-28_${opts.sessionId}.chat.card`,
    `---\nsession: ${opts.sessionId}\n${opts.husk}---\n\n`);
  const logPath = getSessionLogPath(box.root, opts.sessionId);
  await mkdir(dirname(logPath), { recursive: true });
  await writeFile(logPath, opts.entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
  const when = new Date(NOW.getTime() - 5 * HOUR);
  await utimes(logPath, when, when);
  return `store/chat/web/2026-07-28_${opts.sessionId}.chat.card`;
}

/** Enough rendered text to clear REVIEW_CHAR_THRESHOLD. */
function bulk(uuid: string) {
  return userEntry(uuid, "a".repeat(4000));
}

const OUTPUT = {
  title: "Sorting out a recurring billing problem",
  contains: "Working through a repeated billing error and how to stop it.",
  notes: [
    { kind: "decision", text: "cancel the duplicate subscription" },
    { kind: "follow-up", text: "check next month's statement" },
  ],
};
```

## A qualifying session gets titled, summarized, and journalled

```ts
const box = await makeTmpBox();
process.env["CB_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");

const huskPath = await seed(box, {
  sessionId: "sess1234",
  husk: "",
  entries: [bulk("u1"), userEntry("u2", "and another thing"), bulk("u3")],
});

const reviewer = fakeReviewer([OUTPUT]);
const summary = await runChatReview(box.root, {
  reviewer, maxSessions: 10, now: NOW, ownerEmail: null,
});
JSON.stringify({ reviewed: summary.reviewed, bootstrapped: summary.bootstrapped })
=> {"reviewed":1,"bootstrapped":1}
```

The husk carries all four fields, and the reviewer was told this was a bootstrap
pass with no prior account.

```ts continue
const card = await readFile(box.path(huskPath), "utf8");
[
  card.includes("title: Sorting out a recurring billing problem"),
  card.includes("contains: Working through a repeated billing error"),
  card.includes("decision: cancel the duplicate subscription"),
  card.includes("review-span:"),
].join(",")
=> true,true,true,true

JSON.stringify({ bootstrap: reviewer.calls[0].bootstrap, account: reviewer.calls[0].currentAccount })
=> {"bootstrap":true,"account":null}
```

## Running again immediately does nothing

The journal has advanced to the end of the transcript, so there is no new span
and no model call.

```ts continue
const second = fakeReviewer([OUTPUT]);
const again = await runChatReview(box.root, {
  reviewer: second, maxSessions: 10, now: NOW, ownerEmail: null,
});
JSON.stringify({ reviewed: again.reviewed, calls: second.calls.length })
=> {"reviewed":0,"calls":0}
```

## Growth is an increment, and the previous account is the input

```ts continue
const logPath = getSessionLogPath(box.root, "sess1234");
const grown = [bulk("u1"), userEntry("u2", "and another thing"), bulk("u3"), bulk("u4"), bulk("u5")];
await writeFile(logPath, grown.map((e) => JSON.stringify(e)).join("\n") + "\n");
const when = new Date(NOW.getTime() - 5 * HOUR);
await utimes(logPath, when, when);

const third = fakeReviewer([{ ...OUTPUT, title: "" }]);
await runChatReview(box.root, { reviewer: third, maxSessions: 10, now: NOW, ownerEmail: null });

// Only the new entry was sent, and the prior account came along.
// The whole transcript renders to >16k chars; the span sent is only the two
// new entries, so it is far smaller.
JSON.stringify({
  bootstrap: third.calls[0].bootstrap,
  spanIsIncrementOnly: third.calls[0].span.length < 9000,
  carriedAccount: third.calls[0].currentAccount.includes("cancel the duplicate subscription"),
})
=> {"bootstrap":false,"spanIsIncrementOnly":true,"carriedAccount":true}
```

An empty title means "keep the existing one", so it survives.

```ts continue
(await readFile(box.path(huskPath), "utf8")).includes("title: Sorting out a recurring billing problem")
=> true
```

```ts cleanup
await box.cleanup();
```

## A hand-edited title is never overwritten again

The review detects that the title no longer hashes to what it wrote, marks the
field `manual`, and leaves it alone from then on — while still updating
`contains` and the account.

```ts
const box = await makeTmpBox();
process.env["CB_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");
const huskPath = await seed(box, {
  sessionId: "sess5678", husk: "", entries: [bulk("v1"), bulk("v2")],
});

await runChatReview(box.root, {
  reviewer: fakeReviewer([OUTPUT]), maxSessions: 10, now: NOW, ownerEmail: null,
});

// The boxholder retitles it by hand.
const written = await readFile(box.path(huskPath), "utf8");
await writeFile(box.path(huskPath),
  written.replace("title: Sorting out a recurring billing problem", "title: The Acme mess"));

// More conversation arrives.
const logPath = getSessionLogPath(box.root, "sess5678");
await writeFile(logPath, [bulk("v1"), bulk("v2"), bulk("v3"), bulk("v4")].map((e) => JSON.stringify(e)).join("\n") + "\n");
const when = new Date(NOW.getTime() - 5 * HOUR);
await utimes(logPath, when, when);

await runChatReview(box.root, {
  reviewer: fakeReviewer([{ ...OUTPUT, title: "A completely different title" }]),
  maxSessions: 10, now: NOW, ownerEmail: null,
});

const after = await readFile(box.path(huskPath), "utf8");
[after.includes("title: The Acme mess"), after.includes("A completely different title")].join(",")
=> true,false
```

The ownership flag is recorded, so the decision survives a restart.

```ts continue
const state = await loadReviewState(box.root);
state.sessions["sess5678"].titleOwner
=> manual
```

```ts cleanup
await box.cleanup();
```

## A title typed before the first review is not clobbered

At first review there is no stored hash, but the husk may already carry a title:
either the first-message snippet `ensureChatHusk` writes, or something the
boxholder typed. They have to be told apart — the snippet is reproducible, so
anything else is a person's.

```ts
const box = await makeTmpBox();
process.env["CB_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");
const huskPath = await seed(box, {
  sessionId: "sesspre", husk: "title: Notes on the roof leak\n", entries: [bulk("p1"), bulk("p2")],
});

await runChatReview(box.root, {
  reviewer: fakeReviewer([OUTPUT]), maxSessions: 10, now: NOW, ownerEmail: null,
});
const card = await readFile(box.path(huskPath), "utf8");
[card.includes("title: Notes on the roof leak"), card.includes("Sorting out a recurring")].join(",")
=> true,false
```

The rest of the review still lands, and the field is marked `manual` from here on.

```ts continue
card.includes("contains: Working through a repeated billing error")
=> true

(await loadReviewState(box.root)).sessions["sesspre"].titleOwner
=> manual
```

An auto-set snippet title, by contrast, is ours to replace — otherwise the
feature could never improve the titles it exists to improve.

```ts continue
const box2 = await makeTmpBox();
process.env["CB_CLAUDE_PROJECTS_DIR"] = box2.path("claude-projects");
const husk2 = await seed(box2, {
  sessionId: "sesssnip", husk: "", entries: [bulk("q1"), bulk("q2")],
});

// The exact snippet ensureChatHusk would have written, derived the same way.
const meta = await getSessionMetadata({
  sessionId: "sesssnip",
  logPath: getSessionLogPath(box2.root, "sesssnip"),
  snippetMaxLen: 80,
});
await writeFile(box2.path(husk2),
  `---\nsession: sesssnip\ntitle: ${meta.firstUserSnippet}\n---\n\n`);
await runChatReview(box2.root, {
  reviewer: fakeReviewer([OUTPUT]), maxSessions: 10, now: NOW, ownerEmail: null,
});
(await readFile(box2.path(husk2), "utf8")).includes("title: Sorting out a recurring billing problem")
=> true

await box2.cleanup();
```

```ts cleanup
await box.cleanup();
```

## A credential in generated text is dropped, not committed

The leak scan rejects exactly one thing: a credential shape. That is secret
hygiene rather than editorial judgement — an API key in a git-tracked card is a
problem regardless of which field it landed in or who reads it.

Names, addresses, figures and dates are **not** rejected. A title that would
embarrass someone is a real risk, but no regex detects it, so that judgement lives
in the prompt where it can actually be exercised rather than half here.

```ts
const box = await makeTmpBox();
process.env["CB_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");
const huskPath = await seed(box, {
  sessionId: "sess9999", husk: "", entries: [bulk("w1"), bulk("w2")],
});

const summary = await runChatReview(box.root, {
  reviewer: fakeReviewer([{
    ...OUTPUT,
    title: "Rotating sk-abcdefghijklmnopqrstuvwxyz012345",
  }]),
  maxSessions: 10, now: NOW, ownerEmail: null,
});
summary.rejected.join(",")
=> sess9999:title

const card = await readFile(box.path(huskPath), "utf8");
[card.includes("sk-abcdefghijklmnop"), card.includes("contains: Working through")].join(",")
=> false,true
```

An ordinary title full of specifics sails through — no name-stripping, no
address-stripping.

```ts continue
const box2 = await makeTmpBox();
process.env["CB_CLAUDE_PROJECTS_DIR"] = box2.path("claude-projects");
const husk2 = await seed(box2, {
  sessionId: "sessplain", husk: "", entries: [bulk("v1"), bulk("v2")],
});
const plain = await runChatReview(box2.root, {
  reviewer: fakeReviewer([{
    ...OUTPUT,
    title: "Indigo's custodial account paperwork",
    contains: "Sorting out a clerical error, dana.lin@example.com copied in.",
  }]),
  maxSessions: 10, now: NOW, ownerEmail: null,
});
plain.rejected.length
=> 0

const card2 = await readFile(box2.path(husk2), "utf8");
[card2.includes("Indigo's custodial account paperwork"), card2.includes("dana.lin@example.com")].join(",")
=> true,true

await box2.cleanup();
```

```ts cleanup
await box.cleanup();
```

## A crash between the husk write and the journal write is repaired, not replayed

The husk is written first and the journal second, so a crash in between leaves
the account already extended while the journal still points at the old boundary.
Naively re-running would hand the model the already-extended account *plus* the
same span again — it could fold the same material in twice.

The applied span id on the husk is what prevents that: the next run recomputes
the same id, sees it already recorded, and just advances the journal.

```ts
const box = await makeTmpBox();
process.env["CB_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");
const huskPath = await seed(box, {
  sessionId: "sesscrash", husk: "", entries: [bulk("c1"), bulk("c2")],
});

await runChatReview(box.root, {
  reviewer: fakeReviewer([OUTPUT]), maxSessions: 10, now: NOW, ownerEmail: null,
});
const afterFirst = await readFile(box.path(huskPath), "utf8");

// The marker and the account it claims landed together — the marker is never
// written without them, so it can never certify an account that isn't there.
[afterFirst.includes("review-span:"), afterFirst.includes("contains-evidence:")].join(",")
=> true,true

// Simulate the crash: the husk write landed, the journal did not.
await writeFile(box.path(".callback-box/chat-review/state.json"),
  JSON.stringify({ lastRunAt: null, sessions: {} }, null, 2) + "\n");

const recovery = fakeReviewer([{ ...OUTPUT, title: "Should never be written" }]);
const summary = await runChatReview(box.root, {
  reviewer: recovery, maxSessions: 10, now: NOW, ownerEmail: null,
});
JSON.stringify({ alreadyApplied: summary.alreadyApplied, modelCalls: recovery.calls.length })
=> {"alreadyApplied":1,"modelCalls":0}
```

The card is untouched, and the journal has caught up — so a third run sees
nothing new either.

```ts continue
(await readFile(box.path(huskPath), "utf8")) === afterFirst
=> true

const state = await loadReviewState(box.root);
state.sessions["sesscrash"].applied["metadata"].endUuid
=> c2
```

```ts cleanup
await box.cleanup();
```

## A reviewer failure is counted, not fatal

```ts
const box = await makeTmpBox();
process.env["CB_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");
await seed(box, { sessionId: "sessfail", husk: "", entries: [bulk("x1"), bulk("x2")] });

const summary = await runChatReview(box.root, {
  reviewer: fakeReviewer([new Error("model unavailable")]),
  maxSessions: 10, now: NOW, ownerEmail: null,
});
JSON.stringify({ reviewed: summary.reviewed, failures: summary.reviewerFailures })
=> {"reviewed":0,"failures":1}

const state = await loadReviewState(box.root);
state.sessions["sessfail"].attempts
=> 1
```

```ts cleanup
await box.cleanup();
```

## The husk body is never touched

The account lives in a field, so prose the boxholder wrote in the body survives
every pass.

```ts
const box = await makeTmpBox();
process.env["CB_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");
const huskPath = await seed(box, {
  sessionId: "sessbody", husk: "", entries: [bulk("y1"), bulk("y2")],
});
await writeFile(box.path(huskPath),
  `---\nsession: sessbody\n---\n\nMy own notes about this chat.\n`);

await runChatReview(box.root, {
  reviewer: fakeReviewer([OUTPUT]), maxSessions: 10, now: NOW, ownerEmail: null,
});
(await readFile(box.path(huskPath), "utf8")).includes("My own notes about this chat.")
=> true
```

```ts cleanup
await box.cleanup();
```
