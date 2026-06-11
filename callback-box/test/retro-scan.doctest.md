# Retrospective Scan

`runRetroScan` (`src/core/retro/scan.ts`) drives one retrospective run:
discover qualifying chat sessions, observe each through a `RetroObserver`,
dedupe evidence against the ledger, persist walker state, and write the
per-run report. The observer here is a scripted fake — the real one
(`createSdkRetroObserver`) makes one tool-less LLM call per session.

```ts setup
import { mkdir, utimes, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { makeTmpBox } from "./helpers/doctest-helpers.js";
import { getSessionLogPath } from "../src/cli/lib/session.js";
import { loadLedgerEntries } from "../src/core/retro/ledger.js";
import { runRetroScan } from "../src/core/retro/scan.js";
import { loadRetroState } from "../src/core/retro/state.js";
import type { RetroObserver } from "../src/core/retro/observer.js";
import type { SessionObservation } from "../src/core/retro/observations.js";

const NOW = new Date("2026-06-09T12:00:00Z");
const HOUR = 60 * 60 * 1000;

function typedEntry(text: string, ts: string) {
  return {
    type: "user",
    uuid: "u-" + ts,
    timestamp: ts,
    message: {
      role: "user",
      content: [
        { type: "text", text: `<chat-app time="${ts}"/>\n<typed user="Ian">${text}</typed>` },
      ],
    },
  };
}

function agentEntry(text: string, ts: string) {
  return {
    type: "assistant",
    uuid: "a-" + ts,
    timestamp: ts,
    message: { role: "assistant", content: [{ type: "text", text }] },
  };
}

async function seedSession(
  boxRoot: string,
  opts: { sessionId: string; entries: object[]; age: number }
) {
  const logPath = getSessionLogPath(boxRoot, opts.sessionId);
  await mkdir(dirname(logPath), { recursive: true });
  await writeFile(logPath, opts.entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
  const when = new Date(NOW.getTime() - opts.age);
  await utimes(logPath, when, when);
}

/** Scripted observer: returns canned observations per session id; throws where told to. */
function fakeObserver(script: Record<string, SessionObservation[] | "fail">): RetroObserver {
  return {
    async observe({ sessionId }) {
      const entry = script[sessionId];
      if (entry === undefined) return [];
      if (entry === "fail") throw new Error("scripted failure");
      return entry;
    },
  };
}

const PROSE_OBSERVATION: SessionObservation = {
  kind: "correction",
  evidence: "Please stop using bullet lists in answers",
  proposal: "The boxholder prefers prose over bullet lists in chat replies.",
  sink: "personality",
};
```

## A run: observe, ledger, state, report

Two chat sessions; one yields an observation, one fails (and stays
eligible for retry). Everything lands in the ledger, walker state, and
the run report.

```
const box = await makeTmpBox();
process.env["CB_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");

await seedSession(box.root, { sessionId: "chat-a", age: 5 * HOUR, entries: [
  typedEntry("Please stop using bullet lists in answers", "2026-06-09T07:00:00Z"),
  agentEntry("Got it.", "2026-06-09T07:00:10Z"),
] });
await seedSession(box.root, { sessionId: "chat-b", age: 3 * HOUR, entries: [
  typedEntry("What's for dinner?", "2026-06-09T09:00:00Z"),
  agentEntry("Pasta tonight.", "2026-06-09T09:00:05Z"),
] });

const summary = await runRetroScan(box.root, {
  observer: fakeObserver({ "chat-a": [PROSE_OBSERVATION], "chat-b": "fail" }),
  maxSessions: 20,
  now: NOW,
});
[summary.runId, summary.observed, summary.observations, summary.observerFailures].join(" | ")
=> 2026-06-09T12-00-00 | 1 | 1 | 1

const ledger = await loadLedgerEntries(box.root);
ledger.map((e) => `${e.kind} ${e.sessionId} ${e.runId}: ${e.proposal}`).join("\n")
=> correction chat-a 2026-06-09T12-00-00: The boxholder prefers prose over bullet lists in chat replies.

const state = await loadRetroState(box.root);
`${state.sessions["chat-a"]?.status} / ${state.sessions["chat-b"]?.status}:${state.sessions["chat-b"]?.attempts}`
=> done / failed:1

await box.read("store/reviews/retro/2026-06-09T12-00-00.md")
=> # Retrospective run 2026-06-09T12-00-00
«blankline»
Generated 2026-06-09T12:00:00.000Z.
«blankline»
## What I learned
«blankline»
_Pending integration._
«blankline»
## Sessions examined
«blankline»
- `chat-a` (2026-06-09T07:00:00.000Z, 1 user message)
«blankline»
Skipped: 1 observer failures (retried next run).
«blankline»
No chat registries found — thread provenance unavailable for this box.
«blankline»
## Observations
«blankline»
- **correction** (`chat-a`, → personality): The boxholder prefers prose over bullet lists in chat replies.
  > Please stop using bullet lists in answers
«blankline»
## Actions taken
«blankline»
_Pending integration._
```

## Second run: retry the failure, dedupe repeated evidence

The failed session is retried. Its observation repeats the exact evidence
already ledgered (as happens when a resumed session re-presents old
turns), so it's skipped as a duplicate — recurrence can't be inflated by
one conversation.

``` continue
const NOW2 = new Date("2026-06-09T13:00:00Z");
const summary2 = await runRetroScan(box.root, {
  observer: fakeObserver({ "chat-b": [PROSE_OBSERVATION] }),
  maxSessions: 20,
  now: NOW2,
});
[summary2.observed, summary2.observations, summary2.duplicatesSkipped].join(" | ")
=> 1 | 0 | 1

(await loadLedgerEntries(box.root)).length
=> 1

(await loadRetroState(box.root)).sessions["chat-b"]?.status
=> done
```

## Third run: nothing left — no report written

``` continue
const summary3 = await runRetroScan(box.root, {
  observer: fakeObserver({}),
  maxSessions: 20,
  now: new Date("2026-06-09T14:00:00Z"),
});
`${summary3.observed} observed, report: ${summary3.reportPath}`
=> 0 observed, report: null
```

```cleanup
delete process.env["CB_CLAUDE_PROJECTS_DIR"];
await box.cleanup();
```
