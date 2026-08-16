# Chat Review: what discovery hands on

`src/core/chat/review/discovery.ts` decides which husks are worth reviewing
tonight. It has to parse each transcript to answer that — but it must not *keep*
what it parsed.

Discovery holds every qualified session at once and `runChatReview` caps the run
only afterwards, so a retained transcript array per session is N × 5000 fat
`SessionEntry` objects resident simultaneously (whole `tool_use.input` bodies,
base64 image payloads) — the allocation class that OOM'd `cb serve`. A
`QualifiedSession` is therefore scalars only.

```ts setup
import { mkdir, utimes, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { makeTmpBox } from "../../../helpers/doctest-helpers.js";
import { getSessionLogPath } from "../../../../src/core/chat/session/transcript-paths.js";
import {
  discoverSessions,
  readSessionWindow,
  QUIESCENCE_MS,
} from "../../../../src/core/chat/review/discovery.js";
import { loadReviewState, saveReviewState } from "../../../../src/core/chat/review/state.js";
import { MAX_SESSION_ENTRIES } from "../../../../src/cli/lib/session.js";

const NOW = new Date("2026-07-28T12:00:00Z");
const HOUR = 60 * 60 * 1000;

function userEntry(uuid: string, text: string) {
  return {
    type: "user",
    uuid,
    timestamp: "2026-07-28T03:00:00Z",
    message: { role: "user", content: [{ type: "text", text }] },
  };
}

/** Enough rendered text to clear REVIEW_CHAR_THRESHOLD on its own. */
function bulk(uuid: string) {
  return userEntry(uuid, "a".repeat(4000));
}

/** Seed a husk plus a transcript whose mtime is `agoHours` old. */
async function seed(box, opts: { sessionId: string; entries: object[]; agoHours: number }) {
  await box.write(`store/chat/web/2026-07-28_${opts.sessionId}.chat.card`,
    `---\nsession: ${opts.sessionId}\n---\n\n`);
  const logPath = getSessionLogPath(box.root, opts.sessionId);
  await mkdir(dirname(logPath), { recursive: true });
  await writeFile(logPath, opts.entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
  const when = new Date(NOW.getTime() - opts.agoHours * HOUR);
  await utimes(logPath, when, when);
}

async function discover(box) {
  return discoverSessions(box.root, {
    now: NOW,
    quiescenceMs: QUIESCENCE_MS,
    state: await loadReviewState(box.root),
  });
}
```

## A qualified session is scalars — no parsed transcript rides along

```ts
const box = await makeTmpBox();
process.env["CB_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");

await seed(box, { sessionId: "sessone", entries: [bulk("a1"), bulk("a2")], agoHours: 5 });
const result = await discover(box);
const session = result.qualified[0];

Object.keys(session).sort().join(",")
=> bootstrap,huskPath,logPath,mtime,sessionId,snippetTitle,spanChars
```

Named explicitly, because these two fields are the regression: retaining either
one restores the peak this shape exists to remove.

```ts continue
JSON.stringify({ entries: "entries" in session, span: "span" in session })
=> {"entries":false,"span":false}
```

The scalars the reviewer and `--dry-run` actually need survive: how much new
material there is, and whether the span continues the journal or restarts it.

```ts continue
JSON.stringify({
  sessionId: session.sessionId,
  spanChars: session.spanChars > 8000,
  bootstrap: session.bootstrap,
})
=> {"sessionId":"sessone","spanChars":true,"bootstrap":"no-journal"}
```

Nothing on the object is large: a whole qualified session serializes to a couple
of hundred bytes, whatever the transcript's size.

```ts continue
JSON.stringify(session).length < 500
=> true
```

## The window is re-read on demand, from the same journal

`readSessionWindow` is how the reviewer gets the entries back. Discovery
measured `spanChars` from exactly this, so the two agree.

```ts continue
const window = await readSessionWindow({
  sessionId: "sessone",
  logPath: session.logPath,
  state: await loadReviewState(box.root),
});
JSON.stringify({
  entries: window.entries.length,
  spanEntries: window.span.entries.length,
  bootstrap: window.span.bootstrap,
})
=> {"entries":2,"spanEntries":2,"bootstrap":"no-journal"}
```

A husk whose transcript is gone reads as null rather than throwing.

```ts continue
await readSessionWindow({
  sessionId: "nosuch",
  logPath: box.path("claude-projects/nosuch.jsonl"),
  state: await loadReviewState(box.root),
})
=> null
```

```ts cleanup
await box.cleanup();
```

## The gates are unchanged

Dropping the arrays did not move any threshold. A short session is below the
char threshold, a single-turn session has too few turns, a transcript touched
within the quiescence window is deferred, and a husk with no transcript at all
is counted separately.

```ts
const box = await makeTmpBox();
process.env["CB_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");

await seed(box, { sessionId: "sessbig", entries: [bulk("b1"), bulk("b2")], agoHours: 5 });
await seed(box, {
  sessionId: "sesssmall",
  entries: [userEntry("s1", "hi"), userEntry("s2", "there")],
  agoHours: 5,
});
await seed(box, { sessionId: "sessone1", entries: [bulk("o1")], agoHours: 5 });
await seed(box, { sessionId: "sessnow", entries: [bulk("n1"), bulk("n2")], agoHours: 0 });
await box.write("store/chat/web/2026-07-28_sessgone.chat.card", "---\nsession: sessgone\n---\n\n");

const result = await discover(box);
JSON.stringify({
  qualified: result.qualified.map((s) => s.sessionId),
  belowThreshold: result.belowThreshold,
  tooFewTurns: result.tooFewTurns,
  deferredActive: result.deferredActive,
  missingTranscripts: result.missingTranscripts,
})
=> {"qualified":["sessbig"],"belowThreshold":1,"tooFewTurns":1,"deferredActive":["sessnow"],"missingTranscripts":1}
```

## Qualified sessions come back oldest first

The run cap is applied to this order, so the longest-neglected session is the
one a capped night makes progress on.

```ts continue
await seed(box, { sessionId: "sessold", entries: [bulk("d1"), bulk("d2")], agoHours: 40 });
await seed(box, { sessionId: "sessmid", entries: [bulk("m1"), bulk("m2")], agoHours: 20 });

(await discover(box)).qualified.map((s) => s.sessionId).join(",")
=> sessold,sessmid,sessbig
```

```ts cleanup
await box.cleanup();
```

## A boundary past the read window disqualifies the session, loudly

Discovery reads the first `MAX_SESSION_ENTRIES` of a transcript. When a session
has grown past that since its last review, its recorded boundary is *below* the
window — indistinguishable from a deleted boundary by identity alone, but the
truncation flag tells them apart.

Such a session is not qualified: it gets its own counter rather than falling into
`belowThreshold`, which would report a destructive situation as a quiet one.

```ts
const box = await makeTmpBox();
process.env["CB_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");

const overCap = Array.from({ length: MAX_SESSION_ENTRIES + 1 },
  (_, i) => userEntry(`cap-${String(i)}`, `line ${String(i)}`));
await seed(box, { sessionId: "sesscap", entries: overCap, agoHours: 5 });
await saveReviewState(box.root, {
  lastRunAt: null,
  sessions: {
    sesscap: {
      applied: {
        metadata: {
          spanId: "prior-span",
          endUuid: `cap-${String(MAX_SESSION_ENTRIES)}`,
          endIndex: MAX_SESSION_ENTRIES,
          prefixHash: "prior-prefix",
          at: "2026-07-27T12:00:00Z",
        },
      },
      titleOwner: "unmanaged",
      titleHash: null,
      attempts: 0,
    },
  },
});

const result = await discover(box);
JSON.stringify({
  qualified: result.qualified.map((s) => s.sessionId),
  belowThreshold: result.belowThreshold,
  boundaryBeyondWindow: result.boundaryBeyondWindow,
})
=> {"qualified":[],"belowThreshold":0,"boundaryBeyondWindow":1}
```

The window itself reports the deferral rather than a bootstrap, with an empty
span — there is nothing safe to review.

```ts continue
const window = await readSessionWindow({
  sessionId: "sesscap",
  logPath: getSessionLogPath(box.root, "sesscap"),
  state: await loadReviewState(box.root),
});
JSON.stringify({
  deferred: window.span.deferred,
  bootstrap: window.span.bootstrap,
  spanEntries: window.span.entries.length,
})
=> {"deferred":"boundary-beyond-window","bootstrap":null,"spanEntries":0}
```

```ts cleanup
await box.cleanup();
```
