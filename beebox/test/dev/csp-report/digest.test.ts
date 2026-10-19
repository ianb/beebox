// # CSP violation digest
//
// The digest turns the JSONL `csp-reports.log` (written by the `/api/csp-report` sink) into a deduped summary the local review routine uses to decide whether the policy is safe to harden. It arranges context — it never flips the policy itself. `digestCspReports` digests a whole log; `parseCspLog` + `entriesSince` + `digestEntries` are the incremental pieces the cursor-driven CLI composes.

import { test } from "tap";
import "agent-doctest/tap";
import assert from "node:assert/strict";
import { digestCspReports, parseCspLog, entriesSince, newestTs, digestEntries } from "../../../src/dev/csp-report/digest.js";

// One JSONL line, matching the sink's `{ ts, directive, blocked, doc }` shape.
function line({ ts, directive, blocked }: { ts: string; directive: string; blocked: string }): string {
  return JSON.stringify({ ts, directive, blocked, doc: "https://app/x" });
}

// ## A clean log proposes hardening
//
// No violations → safe to flip Report-Only to enforcing (with a human in the loop):
void test("No violations → safe to flip Report-Only to enforcing (with a human in the lo...", async (t) => {
  // doctest:L20
  const clean = digestCspReports("");
  t.check(clean, {
    total: 0,
    violations: [],
    clean: true,
    summary: `✅ No CSP violations recorded.
Safe to harden: propose flipping Content-Security-Policy-Report-Only →
Content-Security-Policy (keep script-src 'self'). Confirm with the boxholder
before flipping — this tool proposes, it does not change the policy.`,
  });
});

// ## Violations are deduped and counted
//
// Repeated violations of the same directive+origin collapse into one row with a count and a first/last-seen window; distinct ones are listed separately, most-frequent first. Blank lines and any non-JSON line are skipped:
void test("Repeated violations of the same directive+origin collapse into one row with a...", async (t) => {
  // doctest:L36
  const log = [
    line({ ts: "2026-06-01T10:00:00.000Z", directive: "frame-src", blocked: "https://vimeo.com" }),
    line({ ts: "2026-06-01T11:00:00.000Z", directive: "frame-src", blocked: "https://vimeo.com" }),
    line({ ts: "2026-06-02T09:00:00.000Z", directive: "img-src", blocked: "https://cdn.test/x.png" }),
    "garbage line that should be ignored",
    "",
  ].join("\n");
  const d = digestCspReports(log);
  t.check(d, {
    total: 3,
    violations: [
      {
        directive: "frame-src",
        blocked: "https://vimeo.com",
        count: 2,
        firstSeen: "2026-06-01T10:00:00.000Z",
        lastSeen: "2026-06-01T11:00:00.000Z",
      },
      {
        directive: "img-src",
        blocked: "https://cdn.test/x.png",
        count: 1,
        firstSeen: "2026-06-02T09:00:00.000Z",
        lastSeen: "2026-06-02T09:00:00.000Z",
      },
    ],
    clean: false,
    summary: `⚠️  3 CSP violation(s), 2 distinct. Do NOT harden until each is resolved.
For each: is the blocked origin a legitimate consumer to allowlist, or a real bug?

  frame-src  ←  https://vimeo.com  (2×, 2026-06-01T10:00:00.000Z … 2026-06-01T11:00:00.000Z)
  img-src  ←  https://cdn.test/x.png  (1×, 2026-06-02T09:00:00.000Z … 2026-06-02T09:00:00.000Z)`,
  });
});

// ## Incremental mode reports only what's new since the cursor
//
// `entriesSince` filters by the prior run's timestamp watermark (ISO-8601 UTC sorts lexically, so `>` is chronological); `newestTs` is what the CLI writes back as the next cursor. This is robust to the sink's rolling truncation — it filters by time, not byte offset.
void test("entriesSince filters by the prior run's timestamp watermark (ISO-8601 UTC sor...", async (t) => {
  // doctest:L69
  const incLog = [
    line({ ts: "2026-06-01T10:00:00.000Z", directive: "frame-src", blocked: "https://vimeo.com" }),
    line({ ts: "2026-06-01T11:00:00.000Z", directive: "frame-src", blocked: "https://vimeo.com" }),
    line({ ts: "2026-06-02T09:00:00.000Z", directive: "img-src", blocked: "https://cdn.test/x.png" }),
  ].join("\n");
  const entries = parseCspLog(incLog);
  const since = "2026-06-01T12:00:00.000Z"; // after both vimeo hits, before the img-src one
  const fresh = entriesSince(entries, since);
  t.check(fresh, [
    {
      ts: "2026-06-02T09:00:00.000Z",
      directive: "img-src",
      blocked: "https://cdn.test/x.png",
      doc: "https://app/x",
    },
  ]);

  // doctest:L83
  t.check(newestTs(entries), "2026-06-02T09:00:00.000Z");

  // The summary for a delta lists the new violations and defers the harden verdict to `--all` (a whole-log judgment), rather than asserting "safe to harden" off a clean delta:

  // doctest:L90
  const delta = digestEntries(fresh, { incremental: true, since });
  t.check(delta, {
    total: 1,
    violations: [
      {
        directive: "img-src",
        blocked: "https://cdn.test/x.png",
        count: 1,
        firstSeen: "2026-06-02T09:00:00.000Z",
        lastSeen: "2026-06-02T09:00:00.000Z",
      },
    ],
    clean: false,
    summary: `⚠️  1 new CSP violation(s) since 2026-06-01T12:00:00.000Z, 1 distinct:

  img-src  ←  https://cdn.test/x.png  (1×, 2026-06-02T09:00:00.000Z … 2026-06-02T09:00:00.000Z)

Analyze each: a legitimate consumer to allowlist (src/lib/csp.ts) or a real bug?
Run \`pnpm csp-digest --all\` for the full-log view before judging a harden.`,
  });

  // When nothing is new since the cursor, the delta is clean — but it says so as "no *new* violations", not "safe to harden":

  // doctest:L101
  const newest = newestTs(entries);
  assert.ok(newest, "the log has entries");
  const none = digestEntries(entriesSince(entries, newest), { incremental: true, since: newest });
  t.check(none, {
    total: 0,
    violations: [],
    clean: true,
    summary: "✅ No new CSP violations since 2026-06-02T09:00:00.000Z.",
  });
});
