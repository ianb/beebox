# Chat Review: a title right after a turn

A chat used to keep "New conversation" until the nightly chat-review run
titled it, and a fresh box never ran that pass
(issues/closed/bugs/2026-10-08-conversation-keeps-placeholder-title.md).
`src/core/chat/review/after-turn.ts` runs the title pass for one session as
soon as a turn completes. It shares the title journal and the run lock with
the nightly run, so a chat it titled is not titled again until it grows.

The reviewer is a scripted fake; no model is called.

```ts setup
import { mkdir, readFile, utimes, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { once } from "node:events";
import { execFileSync } from "node:child_process";
import { makeTmpBox } from "../../../helpers/doctest-helpers.js";
import { appendSessionManifest } from "../../../../src/core/agent/manifest.js";
import { getSessionLogPath } from "../../../../src/core/chat/session/transcript-paths.js";
import {
  afterTurnTitleGate,
  FIRST_TURN_TITLE_CHARS,
  titleChatAfterTurn,
  wireAfterTurnTitling,
} from "../../../../src/core/chat/review/after-turn.js";
import { runChatReview } from "../../../../src/core/chat/review/run/core.js";
import { loadReviewState } from "../../../../src/core/chat/review/state.js";
import { ChatSession } from "../../../../src/core/chat/session/run/core.js";
import { createFakeChatBackend } from "../../../../src/services/claude-chat/core.js";
import { tick, plainTestPrompt } from "../../../helpers/chat-session-spawner-helpers.js";

const NOW = new Date("2026-07-28T12:00:00Z");
const A = "aaaaaaaa-1111-4111-8111-111111111111";
const B = "bbbbbbbb-2222-4222-8222-222222222222";

function fakeReviewer(title: string) {
  const titleCalls = [];
  return {
    titleCalls,
    async review() { throw new Error("the after-turn path never runs the full review"); },
    async title(args) { titleCalls.push(args.sessionId); return { title }; },
  };
}

function user(uuid: string, text: string) {
  return { type: "user", uuid, timestamp: "2026-07-28T11:59:00Z",
    message: { role: "user", content: [{ type: "text", text }] } };
}

function agent(uuid: string, text: string) {
  return { type: "assistant", uuid, timestamp: "2026-07-28T11:59:30Z",
    message: { role: "assistant", content: [{ type: "text", text }] } };
}

const REPLY = "Here is a plan for the evening, with a menu that works for everyone. ".repeat(6);

/** A husk plus a transcript written just now (the turn that just finished). */
async function seed(box, sessionId: string, entries: object[]) {
  const huskPath = `_content/chat/web/2026-07-28_${sessionId}.chat.card`;
  await box.write(huskPath, `---\nsession: ${sessionId}\n---\n\n`);
  const logPath = getSessionLogPath(box.root, sessionId);
  await mkdir(dirname(logPath), { recursive: true });
  await writeFile(logPath, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
  // The transcript is newer than the review's quiescence window would allow.
  await utimes(logPath, NOW, NOW);
  return huskPath;
}

async function freshBox() {
  const box = await makeTmpBox();
  process.env["BBX_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");
  await writeFile(box.path("origin-id"), "11111111-2222-4333-8444-555555555555\n");
  process.env["BBX_ORIGIN_ID_FILE"] = box.path("origin-id");
  return box;
}
```

## The gate: one substantial exchange, or two

A chat qualifies once the person has sent two messages, or after one when the
first message alone is at least `FIRST_TURN_TITLE_CHARS` characters, about one
sentence naming a subject. There is no span-size gate: two short exchanges
are enough.

```ts
FIRST_TURN_TITLE_CHARS
=> 40

[
  afterTurnTitleGate({ userTurns: 1, firstMessage: "Help me plan a birthday dinner for Saturday" }),
  afterTurnTitleGate({ userTurns: 1, firstMessage: "hi, can you help me?" }),
  afterTurnTitleGate({ userTurns: 2, firstMessage: "hi" }),
  afterTurnTitleGate({ userTurns: 0, firstMessage: null }),
]
=> [true, false, true, false]
```

## A substantial first exchange is titled at once, and only that session

Two chats have finished a substantial first turn. Titling after session A's
turn writes A's title and journal and leaves B alone.

```ts
const box = await freshBox();
const first = "Help me plan a birthday dinner for Saturday, eight people, one vegetarian.";
const huskA = await seed(box, A, [user("a1", first), agent("a2", REPLY)]);
const huskB = await seed(box, B, [user("b1", first), agent("b2", REPLY)]);

const reviewer = fakeReviewer("Saturday birthday dinner for eight");
await titleChatAfterTurn(box.root, { sessionId: A, reviewer, now: NOW, ownerEmail: null })
=> { kind: "titled", title: "Saturday birthday dinner for eight" }

reviewer.titleCalls
=> ["aaaaaaaa-1111-4111-8111-111111111111"]

const state = await loadReviewState(box.root);
({
  a: state.sessions[A]?.applied["title"]?.endUuid,
  owner: state.sessions[A]?.titleOwner,
  b: state.sessions[B] ?? null,
  huskB: (await readFile(box.path(huskB), "utf8")).includes("title:"),
})
=> { a: "a2", owner: "generated", b: null, huskB: false }
```

The next turn finds the title journal and makes no call; refreshing the title
is the nightly run's job.

```ts continue
const again = fakeReviewer("Something else");
await titleChatAfterTurn(box.root, { sessionId: A, reviewer: again, now: NOW, ownerEmail: null })
=> { kind: "skipped", reason: "has-title-journal" }

again.titleCalls.length
=> 0
```

The nightly run does not redo it either. Session A has one user turn, below
the nightly two-turn minimum, and session B is still inside the quiescence
window.

```ts continue
const nightly = fakeReviewer("Nightly title");
const summary = await runChatReview(box.root, { reviewer: nightly, maxSessions: 10, now: NOW, ownerEmail: null });
({ titled: summary.titled, calls: nightly.titleCalls.length })
=> { titled: 0, calls: 0 }

(await readFile(box.path(huskA), "utf8")).includes("title: Saturday birthday dinner for eight")
=> true
```

```ts cleanup
await box.cleanup();
```

## The title run commits its usage line

A real title pass is a model session, and every model session appends a line
to the tracked usage manifest (`_bookkeeping/usage/session-manifest.jsonl`).
The title run writes nothing else that a commit picks up, so the manifest used
to stay dirty after every chat's first title, until an unrelated commit swept
it in under that commit's name
(`issues/closed/bugs/2026-10-09-chat-title-run-leaves-usage-manifest-uncommitted.md`).
The after-turn path now commits the manifest alone; the husk and the
transcript are not part of that commit.

```ts
const box = await freshBox();
const first = "Help me plan a birthday dinner for Saturday, eight people, one vegetarian.";
await seed(box, A, [user("a1", first), agent("a2", REPLY)]);
const reviewer = {
  async review() { throw new Error("unused"); },
  async title(args) {
    appendSessionManifest(box.root, { sessionId: "title-run-1", task: `chat-title:${args.sessionId}`, timestamp: NOW.toISOString() });
    return { title: "Saturday birthday dinner for eight" };
  },
};

(await titleChatAfterTurn(box.root, { sessionId: A, reviewer, now: NOW, ownerEmail: null })).kind
=> titled

const git = (...args: string[]) => execFileSync("git", args, { cwd: box.root, encoding: "utf8" }).trim();
({
  subject: git("log", "-1", "--format=%s"),
  source: git("log", "-1", "--format=%(trailers:key=Commit-Source,valueonly)"),
  files: git("show", "--name-only", "--format=", "HEAD").split("\n"),
  manifestDirty: git("status", "--porcelain", "--", "_bookkeeping/usage/session-manifest.jsonl"),
})
=> {
  subject: "Usage: record chat-title session",
  source: "chat-title",
  files: ["_bookkeeping/usage/session-manifest.jsonl"],
  manifestDirty: "",
}
```

```ts cleanup
await box.cleanup();
```

## A greeting waits for the second exchange

A first message of "hi there" names nothing, so the first turn is skipped;
the second exchange qualifies on the two-turn rule, though the whole chat is
far below the nightly 400-character title gate.

```ts
const box = await freshBox();
const entries = [user("g1", "hi there"), agent("g2", "Hello!")];
await seed(box, A, entries);
const reviewer = fakeReviewer("Planning a birthday dinner");

await titleChatAfterTurn(box.root, { sessionId: A, reviewer, now: NOW, ownerEmail: null })
=> { kind: "skipped", reason: "below-gate" }

await seed(box, A, [...entries, user("g3", "help me plan dinner"), agent("g4", "What day?")]);
await titleChatAfterTurn(box.root, { sessionId: A, reviewer, now: NOW, ownerEmail: null })
=> { kind: "titled", title: "Planning a birthday dinner" }
```

```ts cleanup
await box.cleanup();
```

## A title someone typed is left alone

The husk already carries a title nobody generated, so the pass records it as
`manual` and makes no model call.

```ts
const box = await freshBox();
const huskPath = await seed(box, A, [user("m1", "Help me plan a birthday dinner for Saturday please"), agent("m2", REPLY)]);
await writeFile(box.path(huskPath), `---\nsession: ${A}\ntitle: Dana's party\n---\n\n`);
const reviewer = fakeReviewer("Generated");

await titleChatAfterTurn(box.root, { sessionId: A, reviewer, now: NOW, ownerEmail: null })
=> { kind: "skipped", reason: "not-titled" }

({ calls: reviewer.titleCalls.length, owner: (await loadReviewState(box.root)).sessions[A]?.titleOwner })
=> { calls: 0, owner: "manual" }
```

```ts cleanup
await box.cleanup();
```

## A completed turn triggers titling for its own session

`wireAfterTurnTitling` listens for a chat session's `done` and titles that
session. The fake backend plays one turn for session A; session B, also
eligible, is not touched.

```ts
const box = await freshBox();
const first = "Help me plan a birthday dinner for Saturday, eight people, one vegetarian.";
await seed(box, A, [user("a1", first), agent("a2", REPLY)]);
const huskB = await seed(box, B, [user("b1", first), agent("b2", REPLY)]);

const backend = createFakeChatBackend();
const session = new ChatSession(box.root, { backend, systemPrompt: plainTestPrompt, skipBootstrap: true });
const reviewer = fakeReviewer("Saturday birthday dinner for eight");
const titled = [];
wireAfterTurnTitling(session, {
  boxRoot: box.root, reviewer, now: () => NOW, ownerEmail: () => null,
  onTitled: (event) => { titled.push(event); },
});

await session.send("hello");
await tick();
const run = backend.lastRun();
const done = once(session, "done");
run.emitSessionInit(A);
run.emitAssistantText("plain reply");
run.emitResult();
await done;
await eventually(() => titled.length === 1, { label: "session A is titled" });

titled
=> [{ sessionId: "aaaaaaaa-1111-4111-8111-111111111111", title: "Saturday birthday dinner for eight" }]

({ calls: reviewer.titleCalls, huskB: (await readFile(box.path(huskB), "utf8")).includes("title:") })
=> { calls: ["aaaaaaaa-1111-4111-8111-111111111111"], huskB: false }
```

```ts cleanup
session.stop();
await box.cleanup();
```
