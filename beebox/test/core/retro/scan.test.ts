// # Retrospective Scan
//
// `runRetroScan` (`src/core/retro/scan/core.ts`) drives one retrospective run:
// discover qualifying chat sessions, observe each through a `RetroObserver`,
// dedupe evidence against the ledger, persist walker state, and write the
// per-run report. The observer here is a scripted fake — the real one
// (`createSdkRetroObserver`) makes one tool-less LLM call per session.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { mkdir, utimes, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import { getSessionLogPath } from "../../../src/core/chat/session/transcript-paths.js";
import { loadLedgerEntries } from "../../../src/core/retro/scan/ledger.js";
import { runRetroScan } from "../../../src/core/retro/scan/core.js";
import { getBoxTime } from "../../../src/lib/time.js";
import { loadRetroState } from "../../../src/core/retro/state.js";
import type { RetroObserver } from "../../../src/core/retro/observer.js";
import type { SessionObservation } from "../../../src/core/retro/observations.js";

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

const LEDGERED = {
  kind: "correction" as const,
  evidence: "Please stop using bullet lists in answers",
  proposal: "The boxholder prefers prose over bullet lists in chat replies.",
  sink: "personality" as const,
  runId: "2026-06-09T12-00-00",
  sessionId: "chat-a",
  threadRef: null,
  evidenceHash: "d1d0f05056e1e3aa83cae0c117722d1d8428bfe7b94f26f06ad4d7806bcc5fe8",
  observedAt: NOW.toISOString(),
};

// ## A run: observe, ledger, state, report
//
// Two chat sessions; one yields an observation, one fails (and stays
// eligible for retry). Everything lands in the ledger, walker state, and
// the run report.
void test("Two chat sessions; one yields an observation, one fails (and stays eligible f...", async (t) => {
  t.teardown(async () => {
    try {
      delete process.env["BBX_CLAUDE_PROJECTS_DIR"];
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  process.env["BBX_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");

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
  t.check(summary, {
    runId: "2026-06-09T12-00-00",
    observed: 1,
    observations: 1,
    duplicatesSkipped: 0,
    observerFailures: 1,
    reportPath: "_content/reviews/retro/2026-06-09T12-00-00.md",
  });

  const ledger = await loadLedgerEntries(box.root);
  t.check(ledger, [LEDGERED]);

  const state = await loadRetroState(box.root);
  t.check(state, {
    lastRunAt: NOW.toISOString(),
    sessions: {
      "chat-a": { status: "done", attempts: 1, at: NOW.toISOString() },
      "chat-b": { status: "failed", attempts: 1, at: NOW.toISOString() },
    },
  });

  await t.checkText(await box.read("_content/reviews/retro/2026-06-09T12-00-00.md"), `# Retrospective run 2026-06-09T12-00-00
«blankline»
Generated 2026-06-09T12:00:00.000Z.
«blankline»
## What I learned
«blankline»
_Pending integration._
«blankline»
## Sessions examined
«blankline»
- \`chat-a\` (2026-06-09T07:00:00.000Z, 1 user message)
«blankline»
Skipped: 1 observer failures (retried next run).
«blankline»
No chat registries found — thread provenance unavailable for this box.
«blankline»
## Observations
«blankline»
- **correction** (\`chat-a\`, → personality): The boxholder prefers prose over bullet lists in chat replies.
  > Please stop using bullet lists in answers
«blankline»
## Actions taken
«blankline»
_Pending integration._`);

  // ## Second run: retry the failure, dedupe repeated evidence
  //
  // The failed session is retried. Its observation repeats the exact evidence
  // already ledgered (as happens when a resumed session re-presents old
  // turns), so it's skipped as a duplicate — recurrence can't be inflated by
  // one conversation.

  const NOW2 = new Date("2026-06-09T13:00:00Z");
  const summary2 = await runRetroScan(box.root, {
    observer: fakeObserver({ "chat-b": [PROSE_OBSERVATION] }),
    maxSessions: 20,
    now: NOW2,
  });
  t.check(summary2, {
    runId: "2026-06-09T13-00-00",
    observed: 1,
    observations: 0,
    duplicatesSkipped: 1,
    observerFailures: 0,
    reportPath: "_content/reviews/retro/2026-06-09T13-00-00.md",
  });

  t.check(await loadLedgerEntries(box.root), [LEDGERED]);

  t.check(await loadRetroState(box.root), {
    lastRunAt: NOW2.toISOString(),
    sessions: {
      "chat-a": { status: "done", attempts: 1, at: NOW.toISOString() },
      "chat-b": { status: "done", attempts: 1, at: NOW2.toISOString() },
    },
  });

  // ## Third run: nothing left — no report written

  const summary3 = await runRetroScan(box.root, {
    observer: fakeObserver({}),
    maxSessions: 20,
    now: new Date("2026-06-09T14:00:00Z"),
  });
  t.check(summary3, {
    runId: "2026-06-09T14-00-00",
    observed: 0,
    observations: 0,
    duplicatesSkipped: 0,
    observerFailures: 0,
    reportPath: null,
  });
});

// ## A simulated clock does not change which sessions are quiet
//
// Transcript mtimes are real. A walk fixture box running a week ahead still
// defers a session touched five minutes ago and observes one quiet for hours.
void test("A walk fixture box a week ahead still defers a session touched five minutes ago.", async (t) => {
  const savedTime = process.env["BBX_TIME"];
  delete process.env["BBX_TIME"];
  t.teardown(() => {
    delete process.env["BBX_CLAUDE_PROJECTS_DIR"];
    if (savedTime !== undefined) process.env["BBX_TIME"] = savedTime;
  });

  async function outcome(offset: boolean): Promise<{ observed: number; settled: string[] }> {
    const box = await makeTmpBox();
    try {
      process.env["BBX_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");
      await box.write("_config/box.json", JSON.stringify({ timezone: "UTC", fakeNotifications: true }));
      if (offset) await box.write(".beebox/clock-offset.json", JSON.stringify({ offsetMs: 604800000, setAt: "2026-10-23T00:00:00Z" }));
      for (const [sessionId, age] of [["quiet", 5 * HOUR], ["live", 5 * 60 * 1000]] as const) {
        const logPath = getSessionLogPath(box.root, sessionId);
        await mkdir(dirname(logPath), { recursive: true });
        await writeFile(logPath, JSON.stringify(typedEntry("Hello there", "2026-06-09T07:00:00Z")) + "\n");
        const when = new Date(Date.now() - age);
        await utimes(logPath, when, when);
      }
      const summary = await runRetroScan(box.root, { observer: fakeObserver({}), maxSessions: 20, now: getBoxTime(box.root) });
      const state = await loadRetroState(box.root);
      return { observed: summary.observed, settled: Object.keys(state.sessions) };
    } finally {
      await box.cleanup();
    }
  }

  const plain = await outcome(false);
  const shifted = await outcome(true);
  t.check(plain, { observed: 1, settled: ["quiet"] });
  t.check(shifted, plain);
});
