// # Related issues and documents
//
// `issues.related` answers "what else is about this?" for the issue on screen.
// It is the browser's front end for `bin/issues similar <path> --all --docs`:
// the same index, the same `.issues-index/all` cache, the same scores. Closed
// issues and `beebox/docs` plans rank alongside open ones, because prior
// art that was already decided is exactly what a reader needs to see.
//
// The embedder here is a fixture, not the real one: it puts every document
// mentioning "calendar" on one axis and everything else on another, so a
// neighbour is a neighbour by construction and the ranking is deterministic.

import { test } from "tap";
import "agent-doctest/tap";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createIssueRelatedService } from "../../../src/server/main/issue-related-service.js";
import { ROUTER_CAPABILITY_HEADER, buildApp } from "../../../src/server/main/app.js";
import { EMBEDDING_DIMENSIONS } from "../../../../beebox/src/services/openai-embeddings.js";

async function unconfigured(): Promise<never> {
  throw new Error("not configured");
}

function axis(index: number) {
  const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0);
  vector[index] = 1;
  return vector;
}

/** Deterministic stand-in for OpenAI: one axis for calendar, one for the rest. */
function fixtureEmbeddings() {
  const calls: string[][] = [];
  return {
    calls,
    embed: async (texts: string[]) => {
      calls.push(texts);
      return texts.map((text) => axis(text.includes("calendar") ? 0 : 1));
    },
  };
}

async function issue({ root, relPath, frontmatter, body }: { root: string; relPath: string; frontmatter: string; body: string }) {
  const target = path.join(root, "issues", relPath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, `---\n${frontmatter}\n---\n${body}\n`);
}

async function makeRepo() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "issue-related-"));
  await issue({ root, relPath: "bugs/2026-01-05-calendar-drops-events.md", frontmatter: 'title: "Calendar drops events on resync"\nworkstream: calendar-sync\npriority: important', body: "A calendar resync deletes local events." });
  await issue({ root, relPath: "closed/bugs/2026-01-20-calendar-resync-loops.md", frontmatter: 'title: "Calendar resync loops forever"\nworkstream: calendar-sync\nresolution: implemented', body: "The calendar resync never terminates." });
  await issue({ root, relPath: "features/2026-02-01-router-prefixes.md", frontmatter: 'title: "Router prefixes per worktree"\nworkstream: unattached', body: "Serve every checkout by URL prefix." });
  const plan = path.join(root, "beebox", "docs", "plans");
  await fs.mkdir(plan, { recursive: true });
  await fs.writeFile(path.join(plan, "calendar-sync.md"), "# Calendar sync\n\nHow calendar sync works.\n");
  return root;
}

const root = await makeRepo();
const embeddings = fixtureEmbeddings();
const service = createIssueRelatedService({ mainRoot: root, embeddings });
const target = { relPath: "bugs/2026-01-05-calendar-drops-events.md", visibility: "public" as const };

// ## Neighbours span open issues, closed issues, and design docs
//
// The queried issue never ranks against itself, a closed neighbour is marked
// closed, and a design doc carries no status because it has none.
void test("The queried issue never ranks against itself, a closed neighbour is marked cl...", async (t) => {
  // doctest:L78
  const result = await service.related(target);
  t.check(
    {
      problem: result.problem,
      unembedded: result.unembedded,
      rows: result.rows
        .map((row) => ({ path: row.path, kind: row.kind, status: row.status, score: row.score }))
        .toSorted((a, b) => a.path.localeCompare(b.path)),
    },
    {
    problem: null,
    unembedded: 0,
    rows: [
      {
        path: "beebox/docs/plans/calendar-sync.md",
        kind: "doc",
        status: null,
        score: 1,
      },
      {
        path: "issues/closed/bugs/2026-01-20-calendar-resync-loops.md",
        kind: "issue",
        status: "closed",
        score: 1,
      },
    ],
  },
  );

  // An issue row carries the address the browser links to; a doc row does not,
  // because the issue browser has no page for it (the document browser does).

  // doctest:L93
  t.check(result.rows.toSorted((a, b) => a.path.localeCompare(b.path)).map((row) => row.issue), [
    null,
    {
      relPath: "closed/bugs/2026-01-20-calendar-resync-loops.md",
      visibility: "public",
    },
  ]);

  // ## The index is opened once, not once per request
  //
  // The app is long-lived, so a second request reuses the built index. Only a
  // changed document reaches the embedder again — and only that document.

  // doctest:L103
  await service.related(target);
  const afterSecondRequest = embeddings.calls.length;

  // doctest:L106
  let clock = Date.now();
  const fresh = createIssueRelatedService({ mainRoot: root, embeddings, now: () => clock });
  await fresh.related(target);
  const beforeEdit = embeddings.calls.length;
  await issue({ root, relPath: "features/2026-02-01-router-prefixes.md", frontmatter: 'title: "Router prefixes per worktree"\nworkstream: unattached', body: "Serve every checkout by URL prefix, and by port." });
  clock += 60_000;
  await fresh.related(target);
  t.check(
    {
      afterSecondRequest,
      reusedWithoutEmbedding: embeddings.calls.length === beforeEdit + 1,
      reEmbedded: embeddings.calls.at(-1)?.length,
    },
    {
    afterSecondRequest: 1,
    reusedWithoutEmbedding: true,
    reEmbedded: 1,
  },
  );

  // ## A transient failure does not become permanent
  //
  // Reuse-on-unchanged-corpus applies only to a complete index. A failed embed
  // call, a missing key, or a half-embedded corpus are all states that clear on
  // their own, and the corpus signature does not change when they do — so a
  // long-lived reader retries rather than freezing the first bad answer in place.

  // doctest:L131
  let attempts = 0;
  const flaky = {
    embed: async (texts: string[]) => {
      attempts += 1;
      if (attempts === 1) throw new Error("network is down");
      return texts.map((text) => axis(text.includes("calendar") ? 0 : 1));
    },
  };
  const cold = await fs.mkdtemp(path.join(os.tmpdir(), "issue-related-flaky-"));
  await fs.cp(root, cold, { recursive: true });
  await fs.rm(path.join(cold, ".issues-index"), { recursive: true, force: true });

  // doctest:L143
  let flakyClock = Date.now();
  const retrying = createIssueRelatedService({ mainRoot: cold, embeddings: flaky, now: () => flakyClock });
  const failed = await retrying.related(target);
  flakyClock += 60_000;
  const recovered = await retrying.related(target);
  t.check({ first: failed.problem?.reason, rowsAfterRetry: recovered.rows.length, problemAfterRetry: recovered.problem }, {
    first: "failed",
    rowsAfterRetry: 2,
    problemAfterRetry: null,
  });

  // ## No key is a state, not an error
  //
  // The semantic index needs an OpenAI key. A checkout without one still browses
  // issues; the Related section says why it is empty rather than showing an error
  // page.

  // doctest:L159
  const keyless = createIssueRelatedService({ mainRoot: root, env: {} });
  const withoutKey = await keyless.related(target);
  t.check({ rows: withoutKey.rows, reason: withoutKey.problem?.reason, mentionsKey: withoutKey.problem?.detail.includes("BBX_OPENAI_API_KEY") }, {
    rows: [],
    reason: "no-key",
    mentionsKey: true,
  });

  // ## The procedure serves it over the capability wall

  // doctest:L168
  const app = await buildApp({
    services: {
      workstreams: { list: async () => ({ items: [], warnings: [] }) },
      schedules: { alerts: async () => [], acknowledge: async () => {} },
      documents: {
        listIssues: async () => [],
        issueDetail: unconfigured,
        listPlans: unconfigured,
        testingQueue: unconfigured,
        issuesForWorkstream: unconfigured,
        saveIssueChanges: unconfigured,
        setIssueNextAction: unconfigured,
        readDocument: unconfigured,
        changedFiles: unconfigured,
        recentFiles: unconfigured,
        pathIndex: unconfigured,
      },
      comments: { forDocument: unconfigured, waiting: unconfigured, add: unconfigured, clear: unconfigured },
      transcribe: { transcribe: unconfigured },
      quotas: { get: async () => [] },
      exhibits: { inventory: async () => ({ origin: "", storeProblem: null, entries: [] }) },
      actions: { run: async () => ({ status: "complete" }), job: () => null, activeJobs: () => 0 },
      related: service,
    },
    routerCapability: "correct-capability",
    basePath: "/workstreams",
    buildId: "build-42",
    activeJobs: () => 0,
  });
  const response = await app.inject({
    method: "GET",
    url: `/workstreams/api/trpc/issues.related?input=${encodeURIComponent(JSON.stringify(target))}`,
    headers: { [ROUTER_CAPABILITY_HEADER]: "correct-capability" },
  });
  t.check(
    {
      status: response.statusCode,
      paths: response.json().result.data.rows.map((row: { path: string }) => row.path).toSorted(),
    },
    {
    status: 200,
    paths: [
      "beebox/docs/plans/calendar-sync.md",
      "issues/closed/bugs/2026-01-20-calendar-resync-loops.md",
    ],
  },
  );
});
