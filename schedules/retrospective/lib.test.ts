import assert from "node:assert/strict";
import test from "node:test";
import {
  formatPacket, hasWork, isEscapedBug, isPreventionPath, issueFacts, lastRunSchema, nextWatermark, parseStored,
  watchListSchema, windowDays, windowStart, type EscapedBug, type Packet,
} from "./lib.ts";

const NOW = new Date("2026-10-08T00:00:00.000Z");

function bug(over: Partial<EscapedBug>): EscapedBug {
  return { rel: "bugs/2026-10-06-x.md", title: "x", discoveredIn: "", labels: [], citedBy: [], hasPrevention: false, ...over };
}

function packet(over: Partial<Packet>): Packet {
  return {
    runId: "r1", windowStart: "2026-10-05T00:00:00.000Z", windowEnd: NOW.toISOString(), skillUsageDays: 3, watermark: null,
    entries: [], humanPatterns: {}, failures: {}, skills: [], bugs: [], watchListPath: "/store/watch-list.json", watchList: null,
    ...over,
  };
}

test("windowStart: from the last run, so a missed run widens the window", () => {
  const lastRun = { ranAt: "2026-09-20T00:00:00.000Z", watermark: null, entries: 0, packet: null };
  assert.equal(windowStart({ lastRun, now: NOW }), "2026-09-20T00:00:00.000Z");
  assert.equal(windowStart({ lastRun: null, now: NOW }), "2026-09-24T00:00:00.000Z");
});

test("windowDays: rounds up and never drops below the cadence", () => {
  assert.equal(windowDays({ start: "2026-10-07T12:00:00.000Z", now: NOW }), 3);
  assert.equal(windowDays({ start: "2026-09-30T12:00:00.000Z", now: NOW }), 8);
});

test("nextWatermark: the newest consumed entry, else the old watermark", () => {
  assert.equal(nextWatermark(null, []), null);
  assert.equal(nextWatermark("2026-10-01T00:00:00.000Z", []), "2026-10-01T00:00:00.000Z");
  assert.equal(
    nextWatermark("2026-10-01T00:00:00.000Z", ["2026-10-03T00:00:00.000Z", "2026-10-02T00:00:00.000Z"]),
    "2026-10-03T00:00:00.000Z",
  );
});

test("parseStored: validates rather than casts, and never throws", () => {
  assert.equal(parseStored("{", lastRunSchema).ok, false);
  assert.equal(parseStored('{"ranAt":"yesterday","watermark":null,"entries":0,"packet":null}', lastRunSchema).ok, false);
  const good = parseStored('{"updatedAt":"2026-10-07T00:00:00Z","items":[]}', watchListSchema);
  assert.deepEqual(good, { ok: true, value: { updatedAt: "2026-10-07T00:00:00Z", items: [] } });
});

test("isEscapedBug: production provenance or a bug label; the bugs category alone is not enough", () => {
  assert.equal(isEscapedBug(bug({ rel: "features/a.md", discoveredIn: "main — production box feedback triage" })), true);
  assert.equal(isEscapedBug(bug({ rel: "closed/bugs/a.md" })), false);
  assert.equal(isEscapedBug(bug({ rel: "features/a.md", labels: ["bug"] })), true);
  assert.equal(isEscapedBug(bug({ rel: "features/a.md", discoveredIn: "worktree-x — reproduced locally" })), false);
});

test("isPreventionPath: tests, doctests, checks, lint rules", () => {
  for (const file of ["beebox/test/a.ts", "bin/test/x.doctest.md", "schedules/foo/lib.test.ts", "schedules/manual-tests/check",
    "bin/path-leak-check.ts", "personal-vibe-check/rules/no-x.ts", "security/opengrep/rules/a.yaml"]) {
    assert.equal(isPreventionPath(file), true, file);
  }
  for (const file of ["beebox/src/a.ts", "issues/bugs/a.md", "beebox/docs/testing.md", "bin/contest.ts"]) {
    assert.equal(isPreventionPath(file), false, file);
  }
});

test("issueFacts: reads YAML frontmatter, quoted titles and flow lists included", () => {
  const text = '---\ntitle: "A \\"quoted\\" title"\nworkstream: unattached\nlabels: [tests, bug]\ndiscovered-in: main — prod\n---\n\nBody.\n';
  assert.deepEqual(issueFacts("bugs/a.md", text), { rel: "bugs/a.md", title: 'A "quoted" title', discoveredIn: "main — prod", labels: ["tests", "bug"] });
  assert.deepEqual(issueFacts("bugs/b.md", "no frontmatter"), { rel: "bugs/b.md", title: "(no title)", discoveredIn: "", labels: [] });
});

test("hasWork: another workstream's entry or any escaped bug; the retrospective's own entries never start a run", () => {
  assert.equal(hasWork({ entries: [], bugs: [] }, "retrospective"), false);
  assert.equal(hasWork({ entries: [], bugs: [bug({ hasPrevention: true })] }, "retrospective"), true);
  const entry = { path: "/s/e.md", timestamp: "2026-10-07T00:00:00Z", workstream: "w", checkpoint: "landed", transcriptPath: null, body: "b\n" };
  assert.equal(hasWork({ entries: [entry], bugs: [] }, "retrospective"), true);
  assert.equal(hasWork({ entries: [{ ...entry, workstream: "retrospective" }], bugs: [] }, "retrospective"), false);
});

test("formatPacket: entries quoted with provenance, tables sorted by sessions, watch-list states", () => {
  const text = formatPacket(packet({
    entries: [{ path: "/s/e.md", timestamp: "2026-10-07T00:00:00Z", workstream: "w", checkpoint: "landed", transcriptPath: "/t.jsonl", body: "1. slow\n2. doc\n" }],
    failures: {
      rare: { claude: { events: 1, sessions: 1 }, codex: { events: 0, sessions: 0 } },
      common: { claude: { events: 9, sessions: 4 }, codex: { events: 3, sessions: 2 } },
    },
    bugs: [bug({ title: "crash", citedBy: ["a 1", "b 2", "c 3", "d 4", "e 5"], hasPrevention: false })],
    watchList: { ok: false, problem: "items: expected array" },
  }));
  assert.match(text, /### 2026-10-07T00:00:00Z · w · landed\n\n- entry: `\/s\/e.md`\n- transcript: `\/t.jsonl`\n\n> 1. slow\n> 2. doc/u);
  assert.ok(text.indexOf("| common |") < text.indexOf("| rare |"));
  assert.match(text, /- `issues\/bugs\/2026-10-06-x.md` — crash — prevention: no \(linked: a 1; b 2; c 3; and 2 more\)/u);
  assert.match(text, /does not parse \(items: expected array\)/u);
  assert.match(formatPacket(packet({})), /No watch list yet/u);
});
