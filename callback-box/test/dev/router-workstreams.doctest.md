# Workstreams dashboard rendering and routes

The dashboard groups workstreams by lifecycle state, keeps recovery hazards
visible, and exposes actions through a small server-rendered HTTP surface.

```ts setup
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import type { ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";

import {
  legacyIssuesRedirect,
  createResumeMarkerParser,
  issueIndicators,
  issuesForWorkstream,
  quotaHtml,
  relativeTime,
  renderWorkstreams,
  serveWorkstreams,
  type WorkstreamRow,
  type WorkstreamsDeps,
} from "../../../bin/router-workstreams.js";
import {
  compareIssuePriority,
  matches,
  parseFilters,
  parseIssueFile,
  setIssuePriority,
} from "../../../bin/router-issues.js";
import { classifyRouterRoute } from "../../../bin/router-auth.js";

function row(overrides: Partial<WorkstreamRow>): WorkstreamRow {
  return {
    name: "seam",
    path: "/tmp/seam",
    git: { ahead: 1, dirty: 0, merged: false, tip: "tip" },
    runtime: { state: "cold" },
    agent: { state: "none", reason: "" },
    session: {
      agent: "claude",
      hasSession: true,
      tty: null,
      emoji: "🧵",
      baseSha: "base",
      removed: null,
    },
    boxState: { testSetup: false, keepUnmerged: false, pristine: null },
    ...overrides,
  };
}

function responseDouble() {
  const captured = {
    status: 0,
    headers: {} as Record<string, string>,
    body: "",
  };
  const res = {
    setHeader(name: string, value: string) {
      captured.headers[name.toLowerCase()] = value;
      return res;
    },
    writeHead(status: number, headers: Record<string, string>) {
      captured.status = status;
      Object.assign(captured.headers, headers);
      return res;
    },
    end(body?: string) {
      captured.body = body ?? "";
      return res;
    },
    // Test-only structural double implements every response method this handler uses.
  } as unknown as ServerResponse;
  return { captured, res };
}
```

## Front page strata

Every lifecycle stratum has its own section. Links remain origin-relative so
the same HTML works locally and through a remote router.

```ts
const html = renderWorkstreams([
  row({ name: "progress" }),
  row({
    name: "merged",
    git: { ahead: 0, dirty: 0, merged: true, tip: "tip" },
    agent: { state: "live", reason: "argv" },
  }),
  row({
    name: "untouched",
    git: { ahead: 0, dirty: 0, merged: true, tip: "base" },
  }),
  row({
    name: "held",
    git: { ahead: 0, dirty: 0, merged: true, tip: "tip" },
    boxState: { testSetup: true, keepUnmerged: false, pristine: true },
  }),
  row({
    name: "culled",
    path: null,
    git: null,
    session: {
      agent: "claude",
      hasSession: true,
      tty: null,
      emoji: null,
      baseSha: "base",
      removed: { at: "2026-08-09T00:00:00Z", merged: true },
    },
  }),
  row({
    name: "forced",
    path: null,
    git: null,
    session: {
      agent: "claude",
      hasSession: true,
      tty: null,
      emoji: null,
      baseSha: "base",
      removed: {
        at: "2026-08-09T00:00:00Z",
        finalSha: "abcdef123456",
        merged: false,
      },
    },
  }),
]);
for (const heading of [
  "In progress",
  "Merged ✓, session still open",
  "Untouched",
  "Held for testing",
  "Recently culled",
  "Removed with unmerged work",
])
  assert.ok(html.includes(heading));
assert.match(html, /href="\/workstreams\/progress\/"/);
assert.doesNotMatch(html, /http:\/\/localhost/);
assert.match(html, /script src="\/workstreams\/actions.js" defer/);
assert.match(html, /body data-auto-refresh="true"/);
assert.doesNotMatch(html, /http-equiv="refresh"/);
```

Agent liveness outranks an untouched Git state. Archived rows are separated,
identify the agent family, and use readable relative times.

```ts
const html = renderWorkstreams([
  row({
    name: "starting",
    git: { ahead: 0, dirty: 0, merged: true, tip: "base" },
    agent: { state: "live", reason: "argv" },
  }),
  row({ name: "mystery", agent: { state: "unknown", reason: "probe-failed" } }),
  row({
    name: "done",
    session: {
      agent: "codex", hasSession: true, tty: null, emoji: null, baseSha: "base",
      removed: null, archived: { at: "2026-08-08T00:00:00Z" },
    },
  }),
], "", "", undefined, [], new Date("2026-08-10T00:00:00Z"));
assert.match(html, /In progress[\s\S]*starting[\s\S]*Claude active/);
assert.match(html, /mystery[\s\S]*liveness unknown[\s\S]*Claude activity unknown/);
assert.doesNotMatch(html, /Untouched[\s\S]*starting/);
assert.match(html, /Archived[\s\S]*done[\s\S]*Codex inactive/);
assert.match(html, /archived 2 days ago/);
assert.match(html, /action="\/workstreams\/action\/unarchive\/done"/);

const now = new Date("2026-08-10T12:00:00Z");
JSON.stringify([
  relativeTime("2026-08-10T11:59:45Z", now),
  relativeTime("2026-08-08T12:00:00Z", now),
])
=> ["just now","2 days ago"]
```

Search includes removed registry rows and associated plan titles.

```ts
const html = renderWorkstreams(
  [row({ name: "old-seam", path: null })],
  "",
  "seam",
  {
    issues: [],
    plans: [
      {
        title: "Seam design",
        status: "active",
        workstream: "seam",
        relPath: "callback-box/docs/plans/seam.md",
      },
    ],
  },
);
assert.match(html, /old-seam/);
assert.match(html, /Seam design/);
```

Issues appear beneath a workstream when it owns the work or discovered it. These
are independent facts. An issue changed in that worktree replaces main's
metadata and status, including a move into `closed/`.

```ts
const mainIssue = parseIssueFile(
  "bugs/2026-08-10-example.md",
  "---\ntitle: Main title\nworkstream: seam\n---\n",
);
const closedIssue = parseIssueFile(
  "closed/bugs/2026-08-10-example.md",
  "---\ntitle: Worktree title\nworkstream: seam\n---\n",
);
const documents = {
  issues: [mainIssue],
  plans: [],
  worktreeIssues: [{ worktree: "seam", issue: closedIssue }],
  worktreeTouchedSlugs: [{ worktree: "seam", slug: closedIssue.slug }],
};
const authoritative = issuesForWorkstream(documents, "seam");
JSON.stringify(authoritative.map((issue) => [issue.frontmatter.title, issue.closed]))
=> [["Worktree title",true]]

JSON.stringify(issueIndicators(documents, "seam", authoritative[0]!))
=> {"state":"closed","owned":true,"discovered":false,"activity":"closed"}

JSON.stringify(issueIndicators(
  { issues: [closedIssue], plans: [] },
  "seam",
  closedIssue,
))
=> {"state":"closed","owned":true,"discovered":false}

const deletedOnly = issuesForWorkstream(
  {
    issues: [mainIssue],
    plans: [],
    worktreeIssues: [],
    worktreeTouchedSlugs: [],
  },
  "seam",
);
deletedOnly[0]?.frontmatter.title
=> Main title

const crossWorktree = issuesForWorkstream(
  {
    issues: [mainIssue],
    plans: [],
    worktreeIssues: [{ worktree: "editor", issue: closedIssue }],
    worktreeTouchedSlugs: [{ worktree: "editor", slug: closedIssue.slug }],
  },
  "seam",
);
crossWorktree[0]?.frontmatter.title
=> Worktree title

JSON.stringify(issueIndicators(
  {
    issues: [mainIssue],
    plans: [],
    worktreeIssues: [{ worktree: "editor", issue: closedIssue }],
    worktreeTouchedSlugs: [{ worktree: "editor", slug: closedIssue.slug }],
  },
  "seam",
  crossWorktree[0]!,
))
=> {"state":"closed","owned":true,"discovered":false}

const openIssue = parseIssueFile(
  "features/2026-08-11-open.md",
  "---\ntitle: Verify the seam\nworkstream: seam\npriority: important\nneeds: [manual-testing]\n---\n",
);
const discoveredIssue = parseIssueFile(
  "features/2026-08-11-discovered.md",
  "---\ntitle: Later work\nworkstream: unattached\nfiled-by: agent\ndiscovered-by: Ian\ndiscovered-in: worktree-seam — while doing the seam\n---\n",
);
JSON.stringify({
  listed: issuesForWorkstream(
    { issues: [discoveredIssue], plans: [] },
    "seam",
  ).length,
  indicators: issueIndicators(
    { issues: [discoveredIssue], plans: [] },
    "seam",
    discoveredIssue,
  ),
})
=> {"listed":1,"indicators":{"state":"open","owned":false,"discovered":true,"discoveredBy":"Ian"}}

const similarlyNamedDiscovery = parseIssueFile(
  "features/2026-08-11-similar.md",
  "---\ntitle: Similar name\nworkstream: unattached\nfiled-by: agent\ndiscovered-in: worktree-seam-extra — elsewhere\n---\n",
);
issuesForWorkstream(
  { issues: [similarlyNamedDiscovery], plans: [] },
  "seam",
).length
=> 0

JSON.stringify(issueIndicators(
  {
    issues: [],
    plans: [],
    worktreeIssues: [{ worktree: "seam", issue: openIssue }],
    worktreeTouchedSlugs: [{ worktree: "seam", slug: openIssue.slug }],
  },
  "seam",
  openIssue,
))
=> {"state":"open","owned":true,"discovered":false,"activity":"opened"}

const html = renderWorkstreams(
  [row({ name: "seam" })],
  "",
  "",
  { issues: [openIssue, discoveredIssue], plans: [] },
);
assert.match(html, /row-issues[\s\S]*Verify the seam/);
assert.match(
  html,
  /class="manual-testing-issue"[\s\S]*Owns[\s\S]*Discovered[\s\S]*Verify the seam[\s\S]*Manual testing[\s\S]*Important/,
);
assert.match(html, /issue-state-owned">Owns<[\s\S]*issue-state-discovered issue-state-inactive">Discovered</);
assert.match(
  html,
  /issue-state-owned issue-state-inactive">Owns<[\s\S]*issue-state-discovered">Discovered<[\s\S]*Later work[\s\S]*Discovered by Ian/,
);

const query = parseFilters(
  new URLSearchParams("needs=manual-testing&assigned=true"),
);
JSON.stringify([
  matches(openIssue, query, false),
  matches(
    parseIssueFile("features/no.md", "---\ntitle: No\nworkstream: unattached\nneeds: [manual-testing]\n---\n"),
    query,
    false,
  ),
])
=> [true,false]

const unassignedQuery = parseFilters(new URLSearchParams("assigned=false"));
JSON.stringify([
  matches(openIssue, unassignedQuery, false),
  matches(discoveredIssue, unassignedQuery, false),
])
=> [false,true]

const priorityIssue = (slug: string, priority?: string) =>
  parseIssueFile(
    `features/2026-08-11-${slug}.md`,
    `---\ntitle: ${slug}${priority ? `\npriority: ${priority}` : ""}\n---\n`,
  );
const uncategorizedPriority = priorityIssue("uncategorized");
const normalPriority = priorityIssue("normal", "normal");
const importantPriority = priorityIssue("important", "important");
const backlogPriority = priorityIssue("backlog", "backlog");
JSON.stringify({
  omitted: uncategorizedPriority.frontmatter.priority,
  filtered: [importantPriority, normalPriority].filter((issue) =>
    matches(
      issue,
      parseFilters(new URLSearchParams("priority=important")),
      false,
    ),
  ).length,
  sorted: [backlogPriority, uncategorizedPriority, normalPriority, importantPriority]
    .sort(compareIssuePriority)
    .map((issue) => issue.frontmatter.priority),
})
=> {"omitted":"uncategorized","filtered":1,"sorted":["important","normal","uncategorized","backlog"]}

matches(
  normalPriority,
  parseFilters(new URLSearchParams("priority=urgent")),
  false,
)
=> false
```

## Quota summary

Quota cards compare consumption with elapsed time, surface stale captures, and
collapse into a small header summary. Expired snapshots never make a pace claim.

```ts
const html = quotaHtml(
  [
    {
      provider: "claude",
      status: "available",
      fetchedAt: "2026-08-02T00:00:00Z",
      stale: true,
      windows: [
        {
          label: "7-day window",
          usedPercent: 20,
          resetsAt: "2026-08-08T00:00:00Z",
          durationMinutes: 7 * 24 * 60,
        },
      ],
    },
    {
      provider: "codex",
      status: "available",
      fetchedAt: "2026-08-03T00:00:00Z",
      windows: [
        {
          label: "5-hour window",
          usedPercent: 60,
          resetsAt: "2026-08-03T05:00:00Z",
          durationMinutes: 5 * 60,
        },
      ],
    },
  ],
  new Date("2026-08-03T00:00:00Z"),
);
assert.match(
  html,
  /On track · 9 points under budget \(29% of window elapsed\)/,
);
assert.match(
  html,
  /Over pace · 60 points over budget \(0% of window elapsed\)/,
);
assert.match(html, /Stale · Updated/);
assert.match(
  html,
  /<details class="quota-details"><summary>Quotas · Claude on track · Codex over pace<\/summary>/,
);
assert.match(html, /role="region" aria-labelledby="agent-capacity"/);
assert.match(html, /Resets in 5 hours · /);

const forecast = quotaHtml(
  [
    {
      provider: "claude",
      status: "available",
      fetchedAt: "2026-08-03T00:00:00Z",
      windows: [
        {
          label: "7-day window",
          usedPercent: 60,
          resetsAt: "2026-08-08T00:00:00Z",
          durationMinutes: 7 * 24 * 60,
        },
      ],
    },
  ],
  new Date("2026-08-03T00:00:00Z"),
);
assert.match(
  forecast,
  /At this rate, quota reached in 1 day · 3 days 16 hours before reset/,
);

const expired = quotaHtml(
  [
    {
      provider: "claude",
      status: "available",
      fetchedAt: "2026-08-03T00:00:00Z",
      windows: [
        {
          label: "5-hour window",
          usedPercent: 80,
          resetsAt: "2026-08-03T05:00:00Z",
          durationMinutes: 300,
        },
      ],
    },
  ],
  new Date("2026-08-03T06:00:00Z"),
);
assert.match(expired, /Expired snapshot/);
assert.doesNotMatch(expired, /On track|Over pace|80% used/);
```

## HTTP behavior

The front page is read-only and carries its own restrictive CSP. The bare path
canonicalizes to a trailing slash, while unknown detail paths are ordinary 404s.

```ts
const page = responseDouble();
const pageDeps: WorkstreamsDeps = {
  list: async () => [row({})],
  run: async () => undefined,
  documents: async () => ({ issues: [], plans: [] }),
};
await serveWorkstreams({
  method: "GET", pathname: "/workstreams/", repoRoot: "/unused",
  res: page.res, deps: pageDeps,
});
assert.equal(page.captured.status, 200);
assert.equal(
  page.captured.headers["content-security-policy"],
  "default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'",
);
assert.match(page.captured.body, /workstreams/);

const routing = responseDouble();
const unusedDeps: WorkstreamsDeps = {
  list: async () => { throw new Error("must not list"); },
  run: async () => { throw new Error("must not run"); },
  documents: async () => { throw new Error("must not read documents"); },
};
await serveWorkstreams({
  method: "GET", pathname: "/workstreams", repoRoot: "/unused",
  res: routing.res, deps: unusedDeps,
});
assert.equal(routing.captured.status, 301);
assert.equal(routing.captured.headers.location, "/workstreams/");
await serveWorkstreams({
  method: "GET", pathname: "/workstreams/not.built/", repoRoot: "/unused",
  res: routing.res, deps: unusedDeps,
});
routing.captured.status
=> 404
```

Actions validate both verb and name, invoke only approved CLI operations, and
return command results through a 303 flash redirect.

```ts
const action = responseDouble();
const calls: string[] = [];
const actionDeps: WorkstreamsDeps = {
  list: async () => [],
  run: async (verb, name) => { calls.push(`${verb}:${name}`); },
  documents: async () => ({ issues: [], plans: [] }),
};
await serveWorkstreams({
  method: "POST", pathname: "/workstreams/action/focus/good_name-2",
  repoRoot: "/unused", res: action.res, deps: actionDeps,
});
assert.equal(action.captured.status, 303);
assert.match(action.captured.headers.location ?? "", /flash=focus%20good_name-2%3A%20done/);
await serveWorkstreams({
  method: "POST", pathname: "/workstreams/action/archive/good_name-2",
  repoRoot: "/unused", res: action.res, deps: actionDeps,
});
await serveWorkstreams({
  method: "POST", pathname: "/workstreams/action/focus/bad.name",
  repoRoot: "/unused", res: action.res, deps: actionDeps,
});
assert.equal(action.captured.status, 404);
await serveWorkstreams({
  method: "POST", pathname: "/workstreams/action/confirm-tested/2026-08-09-test.md",
  repoRoot: "/unused", res: action.res, deps: actionDeps,
});
JSON.stringify(calls)
=> ["focus:good_name-2","archive:good_name-2","confirm-tested:2026-08-09-test.md"]
```

Resume can run as an observable background job. The CLI remains authoritative
for the phase boundaries; the HTTP layer exposes only the current phase and a
short-lived opaque job identifier.

```ts
const resumeStart = responseDouble();
const resumeDeps: WorkstreamsDeps = {
  list: async () => [],
  run: async (_verb, _name, onProgress) => {
    onProgress?.("restoring");
    onProgress?.("preparing");
    onProgress?.("opening-terminal");
    onProgress?.("opened");
  },
  documents: async () => ({ issues: [], plans: [] }),
};
await serveWorkstreams({
  method: "POST",
  pathname: "/workstreams/action/resume/seam",
  query: "format=json",
  repoRoot: "/unused",
  res: resumeStart.res,
  deps: resumeDeps,
});
assert.equal(resumeStart.captured.status, 202);
const resumeId = JSON.parse(resumeStart.captured.body).id as string;
assert.match(resumeId, /^[0-9a-f-]+$/);
const resumeStatus = responseDouble();
await serveWorkstreams({
  method: "GET",
  pathname: `/workstreams/action-status/${resumeId}`,
  repoRoot: "/unused",
  res: resumeStatus.res,
  deps: resumeDeps,
});
assert.equal(resumeStatus.captured.status, 200);
assert.deepEqual(JSON.parse(resumeStatus.captured.body), {
  stage: "opened",
  name: "seam",
});

const parsedStages: string[] = [];
const parseMarker = createResumeMarkerParser((stage) => parsedStages.push(stage));
parseMarker("install output\nWORKSTREAM_RESUME_STA");
parseMarker("TUS:restoring\rinstall tailWORKSTREAM_RESUME_STATUS:preparing\n");
assert.deepEqual(parsedStages, ["restoring", "preparing"]);

const monoRoot = path.resolve(process.cwd(), "..");
const realMarkerFailure = await execa(
  path.join(monoRoot, "bin/workstreams"),
  ["resume", "definitely-not-a-workstream"],
  {
    cwd: monoRoot,
    env: { ...process.env, WORKSTREAM_RESUME_PROGRESS: "1" },
    reject: false,
  },
);
assert.notEqual(realMarkerFailure.exitCode, 0);
assert.match(realMarkerFailure.stderr, /WORKSTREAM_RESUME_STATUS:checking/);

let finishMarkerless!: () => void;
const markerlessDone = new Promise<void>((resolve) => {
  finishMarkerless = resolve;
});
let markerlessRuns = 0;
const markerlessDeps: WorkstreamsDeps = {
  list: async () => [],
  run: async () => { markerlessRuns += 1; await markerlessDone; },
  documents: async () => ({ issues: [], plans: [] }),
};
const firstMarkerless = responseDouble();
await serveWorkstreams({
  method: "POST", pathname: "/workstreams/action/resume/markerless",
  query: "format=json", repoRoot: "/unused", res: firstMarkerless.res,
  deps: markerlessDeps,
});
const secondMarkerless = responseDouble();
await serveWorkstreams({
  method: "POST", pathname: "/workstreams/action/resume/markerless",
  query: "format=json", repoRoot: "/unused", res: secondMarkerless.res,
  deps: markerlessDeps,
});
assert.equal(markerlessRuns, 1);
assert.equal(secondMarkerless.captured.body, firstMarkerless.captured.body);
const plainMarkerless = responseDouble();
await serveWorkstreams({
  method: "POST", pathname: "/workstreams/action/resume/markerless",
  repoRoot: "/unused", res: plainMarkerless.res, deps: markerlessDeps,
});
assert.equal(markerlessRuns, 1);
assert.match(plainMarkerless.captured.headers.location ?? "", /started/);
finishMarkerless();
await markerlessDone;
await new Promise((resolve) => setImmediate(resolve));
const markerlessStatus = responseDouble();
const markerlessId = JSON.parse(firstMarkerless.captured.body).id as string;
await serveWorkstreams({
  method: "GET", pathname: `/workstreams/action-status/${markerlessId}`,
  repoRoot: "/unused", res: markerlessStatus.res, deps: markerlessDeps,
});
assert.equal(JSON.parse(markerlessStatus.captured.body).stage, "ready");

const failedResume = responseDouble();
const failedResumeDeps: WorkstreamsDeps = {
  list: async () => [],
  run: async () => {
    throw Object.assign(new Error("fallback"), {
      stderr:
        "restore exploded\nWORKSTREAM_RESUME_STATUS:opening-terminal\n",
    });
  },
  documents: async () => ({ issues: [], plans: [] }),
};
await serveWorkstreams({
  method: "POST", pathname: "/workstreams/action/resume/failing",
  query: "format=json", repoRoot: "/unused", res: failedResume.res,
  deps: failedResumeDeps,
});
await new Promise((resolve) => setImmediate(resolve));
const failedStatus = responseDouble();
const failedId = JSON.parse(failedResume.captured.body).id as string;
await serveWorkstreams({
  method: "GET", pathname: `/workstreams/action-status/${failedId}`,
  repoRoot: "/unused", res: failedStatus.res, deps: failedResumeDeps,
});
assert.deepEqual(JSON.parse(failedStatus.captured.body), {
  stage: "failed", error: "restore exploded", name: "failing",
});
const missingStatus = responseDouble();
await serveWorkstreams({
  method: "GET",
  pathname: "/workstreams/action-status/00000000-0000-0000-0000-000000000000",
  repoRoot: "/unused", res: missingStatus.res, deps: resumeDeps,
});
assert.equal(missingStatus.captured.status, 404);
```

Only the first stderr line is exposed in an action failure flash.

```ts
const failure = responseDouble();
const failureDeps: WorkstreamsDeps = {
  list: async () => [],
  run: async () => {
    throw Object.assign(new Error("fallback"), {
      stderr: "TCC denied\nsecond line",
    });
  },
  documents: async () => ({ issues: [], plans: [] }),
};
await serveWorkstreams({
  method: "POST",
  pathname: "/workstreams/action/close/seam",
  repoRoot: "/unused",
  res: failure.res,
  deps: failureDeps,
});
assert.equal(failure.captured.status, 303);
assert.match(
  decodeURIComponent(failure.captured.headers.location ?? ""),
  /TCC denied$/,
);
assert.doesNotMatch(failure.captured.headers.location ?? "", /second/);
```

Issues are mounted canonically under workstreams with the same CSP, and legacy
`/dev/issues` paths permanently preserve their suffix and query.

```ts
const root = await fs.mkdtemp(path.join(os.tmpdir(), "workstreams-issues-"));
t.teardown(async () => await fs.rm(root, { recursive: true, force: true }));
await fs.mkdir(path.join(root, "issues", "bugs"), { recursive: true });
await fs.writeFile(
  path.join(root, "issues", "bugs", "2026-08-09-seam.md"),
  "---\ntitle: Seam bug\n---\n",
);
const issues = responseDouble();
const deps: WorkstreamsDeps = {
  list: async () => [], run: async () => undefined,
  documents: async () => ({ issues: [], plans: [] }),
};
await serveWorkstreams({
  method: "GET", pathname: "/workstreams/issues/", repoRoot: root,
  mainRoot: root, worktreesRoot: path.join(root, "worktrees"),
  res: issues.res, deps,
});
assert.equal(issues.captured.status, 200);
assert.match(issues.captured.body, /href="\/workstreams\/issues\/bugs\/2026-08-09-seam.md"/);
assert.match(
  issues.captured.body,
  /class="issue-main"[\s\S]*class="issue-pills"[\s\S]*class="issue-priority"[\s\S]*class="priority-controls"/,
);
assert.match(
  issues.captured.body,
  /role="radiogroup" aria-label="Priority for Seam bug; saves to main"[\s\S]*Important[\s\S]*Normal[\s\S]*Backlog[\s\S]*Uncategorized/,
);
assert.equal(
  issues.captured.headers["content-security-policy"],
  "default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'",
);
assert.match(issues.captured.body, /script src="\/workstreams\/issues\/priority.js" defer/);
const actionScript = responseDouble();
await serveWorkstreams({
  method: "GET", pathname: "/workstreams/actions.js", repoRoot: root,
  mainRoot: root, worktreesRoot: path.join(root, "worktrees"),
  res: actionScript.res, deps,
});
assert.equal(actionScript.captured.status, 200);
assert.match(actionScript.captured.body, /aria-busy/);
assert.match(actionScript.captured.body, /format=json/);
assert.match(actionScript.captured.body, /\/workstreams\/action-status\//);
const priorityScript = responseDouble();
await serveWorkstreams({
  method: "GET",
  pathname: "/workstreams/issues/priority.js",
  repoRoot: root,
  mainRoot: root,
  worktreesRoot: path.join(root, "worktrees"),
  res: priorityScript.res,
  deps,
});
assert.equal(priorityScript.captured.status, 200);
assert.match(priorityScript.captured.body, /addEventListener\("submit"/);
assert.deepEqual(
  classifyRouterRoute({
    method: "POST",
    url: "/workstreams/issues/action/priority?issue=bugs%2Fseam.md",
  }),
  { kind: "control" },
);

const priorityUpdate = responseDouble();
await serveWorkstreams({
  method: "POST",
  pathname: "/workstreams/issues/action/priority",
  query:
    "visibility=public&issue=bugs%2F2026-08-09-seam.md&priority=important&return=priority%3Duncategorized",
  repoRoot: root,
  mainRoot: root,
  worktreesRoot: path.join(root, "worktrees"),
  res: priorityUpdate.res,
  deps,
});
assert.equal(priorityUpdate.captured.status, 303);
assert.equal(
  priorityUpdate.captured.headers.location,
  "/workstreams/issues/?priority=uncategorized",
);
assert.match(
  await fs.readFile(
    path.join(root, "issues", "bugs", "2026-08-09-seam.md"),
    "utf8",
  ),
  /priority: important/,
);
const updatedIssues = responseDouble();
await serveWorkstreams({
  method: "GET",
  pathname: "/workstreams/issues/",
  repoRoot: root,
  mainRoot: root,
  worktreesRoot: path.join(root, "worktrees"),
  res: updatedIssues.res,
  deps,
});
assert.match(
  updatedIssues.captured.body,
  /<button type="submit" role="radio" aria-checked="true" class="active">Important<\/button>/,
);
const invalidPriority = responseDouble();
await serveWorkstreams({
  method: "POST",
  pathname: "/workstreams/issues/action/priority",
  query: "visibility=public&issue=..%2FCLAUDE.md&priority=important",
  repoRoot: root,
  mainRoot: root,
  worktreesRoot: path.join(root, "worktrees"),
  res: invalidPriority.res,
  deps,
});
assert.equal(invalidPriority.captured.status, 400);

const ownerRoot = path.join(root, "worktrees", "owner");
const ownerIssue = path.join(
  ownerRoot,
  "issues",
  "bugs",
  "2026-08-09-seam.md",
);
await fs.mkdir(path.dirname(ownerIssue), { recursive: true });
await execa("git", ["init", "-b", "main"], { cwd: ownerRoot });
await execa("git", ["config", "user.email", "test@example.com"], {
  cwd: ownerRoot,
});
await execa("git", ["config", "user.name", "Test"], { cwd: ownerRoot });
await fs.writeFile(
  ownerIssue,
  "---\ntitle: Owned seam bug\nworkstream: owner\npriority: backlog\n---\n",
);
await execa("git", ["add", "."], { cwd: ownerRoot });
await execa("git", ["commit", "-m", "baseline"], { cwd: ownerRoot });
await execa("git", ["switch", "-c", "owner"], { cwd: ownerRoot });
await fs.writeFile(
  ownerIssue,
  "---\ntitle: Owned seam bug\nworkstream: owner\npriority: important\n---\n",
);
const overlayPriority = responseDouble();
await serveWorkstreams({
  method: "POST",
  pathname: "/workstreams/issues/action/priority",
  query:
    "visibility=public&issue=bugs%2F2026-08-09-seam.md&priority=normal",
  repoRoot: root,
  mainRoot: root,
  worktreesRoot: path.join(root, "worktrees"),
  res: overlayPriority.res,
  deps,
});
assert.equal(overlayPriority.captured.status, 303);
assert.match(await fs.readFile(ownerIssue, "utf8"), /priority: normal/);
assert.match(
  await fs.readFile(
    path.join(root, "issues", "bugs", "2026-08-09-seam.md"),
    "utf8",
  ),
  /priority: important/,
);

assert.equal(
  setIssuePriority(
    "---\ntitle: Existing\npriority: backlog\n---\nBody\n",
    "normal",
  ),
  "---\ntitle: Existing\npriority: normal\n---\nBody\n",
);
assert.equal(
  setIssuePriority(
    "--- \r\ntitle: Existing\r\npriority: important\r\n---\r\nBody\r\n",
    "uncategorized",
  ),
  "--- \r\ntitle: Existing\r\n---\r\nBody\r\n",
);
JSON.stringify([
  legacyIssuesRedirect("/dev/issues"),
  legacyIssuesRedirect("/dev/issues/bugs/example.md?state=open"),
  legacyIssuesRedirect("/dev/issues-not-really"),
])
=> ["/workstreams/issues/","/workstreams/issues/bugs/example.md?state=open",null]
```

Detail and plans views join documents back to their workstream.

```ts
const detail = responseDouble();
const detailIssue = parseIssueFile(
  "features/2026-08-11-important.md",
  "---\ntitle: Important seam\nworkstream: seam\npriority: important\n---\n",
);
const documents = {
  issues: [detailIssue],
  plans: [
    {
      title: "Seam design",
      status: "active",
      workstream: "seam",
      relPath: "callback-box/docs/plans/seam.md",
    },
  ],
};
const deps: WorkstreamsDeps = {
  list: async () => [row({ name: "seam" })],
  run: async () => undefined,
  documents: async () => documents,
};
await serveWorkstreams({
  method: "GET",
  pathname: "/workstreams/seam/",
  repoRoot: "/unused",
  res: detail.res,
  deps,
});
assert.equal(detail.captured.status, 200);
assert.match(detail.captured.body, /Seam design/);
assert.match(detail.captured.body, /open · important · owns work/);
assert.match(detail.captured.body, /1 ahead, 0 dirty/);

const plans = responseDouble();
await serveWorkstreams({
  method: "GET",
  pathname: "/workstreams/plans/",
  repoRoot: "/unused",
  res: plans.res,
  deps: { ...deps, list: async () => [] },
});
assert.equal(plans.captured.status, 200);
assert.match(plans.captured.body, /active <small>1/);
assert.match(plans.captured.body, /href="\/workstreams\/seam\/"/);
```

The testing view gives landed issues one confirmation control while keeping
pre-merge feedback visibly separate.

```ts
const testing = responseDouble();
const issue = parseIssueFile(
  "features/test.md",
  "---\ntitle: Test it\nworkstream: seam\nneeds: [manual-testing]\n---\n## Manual testing\n",
);
const deps: WorkstreamsDeps = {
  list: async () => [row({ name: "seam" })],
  run: async () => undefined,
  documents: async () => ({
    issues: [issue],
    plans: [],
    worktreeIssues: [{ worktree: "seam", issue }],
  }),
};
await serveWorkstreams({
  method: "GET",
  pathname: "/workstreams/testing/",
  repoRoot: "/unused",
  res: testing.res,
  deps,
});
assert.match(
  testing.captured.body,
  /action="\/workstreams\/action\/confirm-tested\/test.md"/,
);
assert.equal(
  (testing.captured.body.match(/>Confirm<\/button>/g) ?? []).length,
  1,
);
assert.match(testing.captured.body, /Pre-merge, testable in place/);
```
