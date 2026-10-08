# Title freshness — the cheap gate in front of the title pass

One Jev noul — *does the current title still name what the recent messages
are about?* — decides whether a grown chat needs a reviewer call at all
(`src/core/chat/review/freshness.ts`, `docs/implemented-plans/chat-titles.md` § Track B).
A confident yes keeps the title and advances the journal for free.

```ts setup
import { mkdir, utimes, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { makeTmpBox } from "../../../helpers/doctest-helpers.js";
import { getSessionLogPath } from "../../../../src/core/chat/session/transcript-paths.js";
import {
  createJevFreshnessChecker,
  resolveFreshnessChecker,
  stillFitsQuestion,
  titleKeeps,
} from "../../../../src/core/chat/review/freshness.js";
import { createFakeJev } from "../../../../src/services/jev.js";
import { runChatReview } from "../../../../src/core/chat/review/run/core.js";
import { loadReviewState } from "../../../../src/core/chat/review/state.js";
import { contentHash } from "../../../../src/lib/content-hash.js";

/**
 * Seed review state as a pass that already titled the chat: `generated`
 * ownership with our hash, no journal yet (the next span bootstraps). A title
 * merely written on the card would classify as a hand edit — hands-off —
 * which is a different (also tested) behavior.
 */
async function seedGeneratedTitle(box, sessionId, title) {
  await box.write(".beebox/chat-review/state.json", JSON.stringify({
    lastRunAt: null,
    sessions: {
      [sessionId]: { applied: {}, titleOwner: "generated", titleHash: contentHash(title), attempts: 0 },
    },
  }, null, 2) + "\n");
}

const NOW = new Date("2026-07-28T12:00:00Z");
const HOUR = 60 * 60 * 1000;

/** The noul the checker sends, exactly as the wire sees it (minus situation text). */
const QUESTION = stillFitsQuestion();
```

## The decision is one threshold on the noul's probability

```ts
[titleKeeps({ probability: 0.75 }), titleKeeps({ probability: 0.74 })].join(",")
=> true,false
```

The question is a noul with a true/false criterion pair — the shape
`services/jev-judge.ts` serializes and strictly validates.

```ts continue
JSON.stringify([QUESTION.type, Object.keys(QUESTION.criteria).sort()])
=> ["noul",["false","true"]]
```

## A confident "still fits" keeps the title with zero model calls

The whole pipeline, with a fake Jev scripted to a confident yes: the
reviewer's `title` is never called, the title stands unchanged, and the title
journal still advances past the span.

```ts
const box = await makeTmpBox();
process.env["BBX_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");

const sessionId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
await box.write("_content/chat/web/2026-07-28_session.chat.card",
  `---\nsession: ${sessionId}\ntitle: Planning a small birthday dinner\n---\n\n`);
await seedGeneratedTitle(box, sessionId, "Planning a small birthday dinner");
const logPath = getSessionLogPath(box.root, sessionId);
await mkdir(dirname(logPath), { recursive: true });
const entries = [
  { type: "user", uuid: "g1", timestamp: "2026-07-28T03:00:00Z",
    message: { role: "user", content: [{ type: "text", text: "please help me plan a small birthday dinner for saturday, eight people, one vegetarian. ".repeat(4) }] } },
  { type: "user", uuid: "g2", timestamp: "2026-07-28T03:30:00Z",
    message: { role: "user", content: [{ type: "text", text: "great, now what about dessert? something make-ahead, not too sweet. ".repeat(4) }] } },
];
await writeFile(logPath, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
const when = new Date(NOW.getTime() - 5 * HOUR);
await utimes(logPath, when, when);

// A scripted confident YES, through the real checker and the real parser.
const jev = createFakeJev({ answers: () => ({ type: "noul", probability: 0.97 }) });
const freshness = createJevFreshnessChecker(jev, box.root);
const reviewer = {
  calls: 0,
  titleCalls: 0,
  async review() { this.calls += 1; throw new Error("must not run"); },
  async title() { this.titleCalls += 1; throw new Error("must not run"); },
};

const summary = await runChatReview(box.root, {
  reviewer, maxSessions: 10, now: NOW, ownerEmail: null, freshness,
});
JSON.stringify({ calls: reviewer.calls, titleCalls: reviewer.titleCalls, kept: summary.titlesKept })
=> {"calls":0,"titleCalls":0,"kept":1}

// One Jev judgment was made, over the title and the recent messages.
jev.judgeCalls.length
=> 1

const state = await loadReviewState(box.root);
state.sessions[sessionId].applied["title"].endUuid
=> g2
```

The card is untouched — same title, nothing added.

```ts continue
(await (await import("node:fs/promises")).readFile(box.path("_content/chat/web/2026-07-28_session.chat.card"), "utf8")).includes("title: Planning a small birthday dinner")
=> true

await box.cleanup();
```

## A low "still fits" runs the reviewer and takes its title

```ts
const box = await makeTmpBox();
process.env["BBX_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");

const sessionId = "11111111-2222-4333-8444-555555555555";
await box.write("_content/chat/web/2026-07-28_session.chat.card",
  `---\nsession: ${sessionId}\ntitle: Planning a small birthday dinner\n---\n\n`);
await seedGeneratedTitle(box, sessionId, "Planning a small birthday dinner");
const logPath = getSessionLogPath(box.root, sessionId);
await mkdir(dirname(logPath), { recursive: true });
const entries = [
  { type: "user", uuid: "d1", timestamp: "2026-07-28T03:00:00Z",
    message: { role: "user", content: [{ type: "text", text: "forget the dinner — the roof started leaking, can you help me find an emergency roofer? ".repeat(4) }] } },
  { type: "user", uuid: "d2", timestamp: "2026-07-28T03:30:00Z",
    message: { role: "user", content: [{ type: "text", text: "and what should I move out of the upstairs room while we wait? ".repeat(4) }] } },
];
await writeFile(logPath, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
const when = new Date(NOW.getTime() - 5 * HOUR);
await utimes(logPath, when, when);

const freshness = createJevFreshnessChecker(
  createFakeJev({ answers: () => ({ type: "noul", probability: 0.2 }) }),
  box.root,
);
const titleCalls = [];
const summary = await runChatReview(box.root, {
  reviewer: {
    async review() { throw new Error("must not run"); },
    async title(args) {
      titleCalls.push(args);
      return { title: "Emergency roof leak and the upstairs room" };
    },
  },
  maxSessions: 10, now: NOW, ownerEmail: null, freshness,
});
JSON.stringify({ kept: summary.titlesKept, titled: summary.titled, asked: titleCalls.length })
=> {"kept":0,"titled":1,"asked":1}

(await (await import("node:fs/promises")).readFile(box.path("_content/chat/web/2026-07-28_session.chat.card"), "utf8")).includes("title: Emergency roof leak")
=> true

await box.cleanup();
```

## A failing Jev call falls back to the reviewer, loudly

The expensive path is the correct fallback; the warning keeps the degradation
visible.

```ts
const box = await makeTmpBox();
process.env["BBX_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");

const sessionId = "99999999-8888-4777-8666-555555555555";
await box.write("_content/chat/web/2026-07-28_session.chat.card",
  `---\nsession: ${sessionId}\ntitle: Planning a small birthday dinner\n---\n\n`);
await seedGeneratedTitle(box, sessionId, "Planning a small birthday dinner");
const logPath = getSessionLogPath(box.root, sessionId);
await mkdir(dirname(logPath), { recursive: true });
const entries = [
  { type: "user", uuid: "x1", timestamp: "2026-07-28T03:00:00Z",
    message: { role: "user", content: [{ type: "text", text: "one more thing about the party: can we add a signature cocktail? ".repeat(4) }] } },
  { type: "user", uuid: "x2", timestamp: "2026-07-28T03:30:00Z",
    message: { role: "user", content: [{ type: "text", text: "something with vermouth, ideally make-ahead in a batch. ".repeat(4) }] } },
];
await writeFile(logPath, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
const when = new Date(NOW.getTime() - 5 * HOUR);
await utimes(logPath, when, when);

const failing = {
  async check() { throw new Error("jev unavailable"); },
};
const summary = await runChatReview(box.root, {
  reviewer: {
    async review() { throw new Error("must not run"); },
    async title() { return { title: "" }; },  // "keep" — a title exists
  },
  maxSessions: 10, now: NOW, ownerEmail: null, freshness: failing,
});
JSON.stringify({ kept: summary.titlesKept, titled: summary.titled })
=> {"kept":0,"titled":1}

await box.cleanup();
```

## `BBX_JEV_FAKE` resolves a working checker; a bad value degrades to none

```ts
const box = await makeTmpBox();
const yes = await resolveFreshnessChecker(box.root, { ...process.env, BBX_JEV_FAKE: "1" });
JSON.stringify({ fake: yes?.fake, keeps: yes === null ? null : await yes.checker.check({ title: "T", recent: "r", sessionId: "s" }) })
=> {"fake":true,"keeps":{"keeps":true}}

(await resolveFreshnessChecker(box.root, { BBX_JEV_FAKE: "banana" })) === null
=> true
```

An unconfigured box (no fake, no OpenRouter key) also resolves to null — the
run then titles with the reviewer instead, which the CLI says when it happens.

```ts cleanup
await box.cleanup();
```
