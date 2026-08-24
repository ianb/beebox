/**
 * Tests for `bin/issues` — the queue model (derivation, filtering, grouping)
 * and the index refresh's re-embedding decision.
 *
 * `bin/CLAUDE.md` directs new root-tooling tests to `.doctest.md`. This file is
 * a deliberate exception: the re-embedding tests need `createFakeEmbeddings`'s
 * call log inspected across several refresh cycles over a mutating temp tree,
 * which is assertion-shaped rather than transcript-shaped. Nothing here touches
 * the network — the fake embedder derives deterministic vectors from the text.
 */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createFakeEmbeddings } from "../callback-box/src/services/openai-embeddings.js";
import {
  deriveDate, deriveDiscoveredInWorkstream, emptyFilters, filterIssues, groupIssues,
  loadIssueEntries, normalizeWorkstreamName, type IssueEntry,
} from "./lib/issues-model.js";
import { indexDirectory, issueDocument, refreshIndex, runSearch } from "./lib/issues-index.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

interface Fixture {
  category: string;
  name: string;
  frontmatter: string;
  body?: string;
}

const FIXTURES: Fixture[] = [
  {
    category: "bugs",
    name: "2026-01-05-calendar-drops-events.md",
    frontmatter: [
      'title: "Calendar drops events on resync"',
      "workstream: calendar-sync",
      "area: callback-box",
      "labels: [soft-launch, field-test-findings]",
      "needs: [manual-testing]",
      "priority: important",
      "discovered-in: worktree-user-stories-refresh — while walking the capture flow",
    ].join("\n"),
    body: "A resync deletes local events.\n\n## Research (incomplete)\n",
  },
  {
    category: "bugs",
    name: "2026-02-10-composer-splices-drafts.md",
    frontmatter: [
      'title: "Composer splices a draft into another message"',
      "workstream: unattached",
      "area: callback-box",
      "labels: [soft-launch]",
      "next-action: reconfirm",
      "discovered-in: worktree-user-stories-refresh — while testing the composer",
    ].join("\n"),
    body: "Typing in one thread lands text in another.\n",
  },
  {
    category: "features",
    name: "2026-03-01-search-the-queue.md",
    frontmatter: [
      'title: "Search the issue queue semantically"',
      "workstream: issue-selection",
      "area: router",
      "needs: [design, decision]",
      "discovered-in: worktree-issue-selection — while surveying the queue",
    ].join("\n"),
    body: "Grep does not find near-duplicates.\n\n## Research (2026-03-02)\n\nOrama does hybrid.\n",
  },
  {
    category: "exploration",
    name: "undated-idea.md",
    frontmatter: ['title: "An idea filed before the date convention"', "workstream: unattached"].join("\n"),
    body: "No date prefix on this one.\n",
  },
  {
    category: "closed/bugs",
    name: "2026-01-20-router-404.md",
    frontmatter: [
      'title: "Router 404s a worktree prefix"',
      "workstream: calendar-sync",
      "area: router",
      "resolution: implemented",
    ].join("\n"),
    body: "Closed already.\n",
  },
];

async function writeFixtures(root: string, fixtures: Fixture[] = FIXTURES): Promise<void> {
  for (const fixture of fixtures) {
    const directory = path.join(root, "issues", fixture.category);
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(
      path.join(directory, fixture.name),
      `---\n${fixture.frontmatter}\n---\n\n${fixture.body ?? "Body.\n"}`,
    );
  }
}

async function makeRepo(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "issues-cli-"));
  await writeFixtures(root);
  return root;
}

function byPath(entries: IssueEntry[]): Map<string, IssueEntry> {
  return new Map(entries.map((entry) => [entry.path, entry]));
}

// ─── Derivation ──────────────────────────────────────────────────────────────

void test("date derives from the filename prefix, and is null without one", () => {
  assert.equal(deriveDate("2026-08-24-codex-thread-start-failure"), "2026-08-24");
  assert.equal(deriveDate("undated-idea"), null);
  // A date-shaped run that is not the prefix must not be picked up.
  assert.equal(deriveDate("about-2026-08-24-retro"), null);
});

void test("discoveredInWorkstream takes the worktree token, not the prose after it", () => {
  assert.equal(
    deriveDiscoveredInWorkstream("worktree-scanner-ingest — while doing X"),
    "scanner-ingest",
  );
  // No em dash, and a name containing dashes: still just the token.
  assert.equal(deriveDiscoveredInWorkstream("worktree-user-stories-refresh"), "user-stories-refresh");
  assert.equal(deriveDiscoveredInWorkstream("a hallway conversation"), null);
  assert.equal(deriveDiscoveredInWorkstream(undefined), null);
});

void test("a workstream filter accepts either spelling of the name", () => {
  assert.equal(normalizeWorkstreamName("worktree-issue-selection"), "issue-selection");
  assert.equal(normalizeWorkstreamName("issue-selection"), "issue-selection");
});

void test("loadIssueEntries derives date and provenance per issue", async () => {
  const root = await makeRepo();
  const entries = byPath(await loadIssueEntries(root));

  const calendar = entries.get("issues/bugs/2026-01-05-calendar-drops-events.md");
  assert.ok(calendar);
  assert.equal(calendar.date, "2026-01-05");
  assert.equal(calendar.discoveredInWorkstream, "user-stories-refresh");
  assert.equal(calendar.workstream, "calendar-sync");
  assert.equal(calendar.research, "awaiting");
  assert.equal(calendar.visibility, "public");
  assert.deepEqual(calendar.labels, ["soft-launch", "field-test-findings"]);

  const undated = entries.get("issues/exploration/undated-idea.md");
  assert.ok(undated);
  assert.equal(undated.date, null);
  assert.equal(undated.discoveredInWorkstream, null);

  const closed = entries.get("issues/closed/bugs/2026-01-20-router-404.md");
  assert.ok(closed);
  assert.equal(closed.closed, true);
  assert.equal(closed.category, "bugs");
});

// ─── Filters ─────────────────────────────────────────────────────────────────

async function filtered(root: string, apply: (f: ReturnType<typeof emptyFilters>) => void): Promise<string[]> {
  const filters = emptyFilters();
  apply(filters);
  return filterIssues(await loadIssueEntries(root), filters).map((entry) => entry.slug);
}

void test("status defaults to open; --closed and --all select the rest", async () => {
  const root = await makeRepo();
  assert.deepEqual(
    (await filtered(root, () => undefined)).toSorted(),
    ["2026-01-05-calendar-drops-events", "2026-02-10-composer-splices-drafts", "2026-03-01-search-the-queue", "undated-idea"],
  );
  assert.deepEqual(await filtered(root, (f) => { f.status = "closed"; }), ["2026-01-20-router-404"]);
  assert.equal((await filtered(root, (f) => { f.status = "all"; })).length, 5);
});

void test("repeats are OR within a filter and AND across filters", async () => {
  const root = await makeRepo();
  assert.deepEqual(
    (await filtered(root, (f) => { f.area = ["router", "callback-box"]; })).toSorted(),
    ["2026-01-05-calendar-drops-events", "2026-02-10-composer-splices-drafts", "2026-03-01-search-the-queue"],
  );
  assert.deepEqual(
    await filtered(root, (f) => { f.area = ["router", "callback-box"]; f.priority = ["important"]; }),
    ["2026-01-05-calendar-drops-events"],
  );
});

void test("repeated labels mean AND, unlike every other filter", async () => {
  const root = await makeRepo();
  assert.equal((await filtered(root, (f) => { f.labels = ["soft-launch"]; })).length, 2);
  assert.deepEqual(
    await filtered(root, (f) => { f.labels = ["soft-launch", "field-test-findings"]; }),
    ["2026-01-05-calendar-drops-events"],
  );
});

void test("needs, next-action, research, since, and discovered-in each narrow", async () => {
  const root = await makeRepo();
  assert.deepEqual(await filtered(root, (f) => { f.needs = ["design", "manual-testing"]; }), [
    "2026-01-05-calendar-drops-events", "2026-03-01-search-the-queue",
  ]);
  assert.deepEqual(await filtered(root, (f) => { f.nextAction = ["reconfirm"]; }), [
    "2026-02-10-composer-splices-drafts",
  ]);
  assert.deepEqual(await filtered(root, (f) => { f.research = "researched"; }), [
    "2026-03-01-search-the-queue",
  ]);
  assert.deepEqual(await filtered(root, (f) => { f.discoveredIn = ["issue-selection"]; }), [
    "2026-03-01-search-the-queue",
  ]);
  // An undated issue can never satisfy --since: it has no date to compare.
  assert.deepEqual(await filtered(root, (f) => { f.since = "2026-02-01"; }), [
    "2026-02-10-composer-splices-drafts", "2026-03-01-search-the-queue",
  ]);
});

// ─── Groups ──────────────────────────────────────────────────────────────────

void test("groups rank by size and drop buckets under --min", async () => {
  const root = await makeRepo();
  const open = filterIssues(await loadIssueEntries(root), emptyFilters());

  const discovered = groupIssues(open, "discovered-in", 2);
  assert.deepEqual(discovered.map((group) => [group.key, group.count]), [["user-stories-refresh", 2]]);
  assert.deepEqual(discovered[0]?.paths, [
    "issues/bugs/2026-01-05-calendar-drops-events.md",
    "issues/bugs/2026-02-10-composer-splices-drafts.md",
  ]);

  // min 1 exposes the singletons, still largest-first.
  assert.equal(groupIssues(open, "discovered-in", 1).length, 2);
  // An issue with no value for the key is not bucketed into a synthetic group.
  assert.equal(groupIssues(open, "area", 1).reduce((sum, g) => sum + g.count, 0), 3);
  // labels put one issue in several groups.
  assert.deepEqual(groupIssues(open, "labels", 1).map((g) => [g.key, g.count]), [
    ["soft-launch", 2], ["field-test-findings", 1],
  ]);
});

// ─── Index refresh ───────────────────────────────────────────────────────────

async function documentsFor(root: string): Promise<ReturnType<typeof issueDocument>[]> {
  return (await loadIssueEntries(root)).map((entry) => issueDocument(entry));
}

void test("the first refresh embeds everything and later refreshes embed nothing", async () => {
  const root = await makeRepo();
  const embeddings = createFakeEmbeddings();

  const first = await refreshIndex({ repoRoot: root, documents: await documentsFor(root), embeddings });
  assert.equal(first.embeddedThisRun, 5);
  assert.equal(first.embedded.size, 5);
  assert.deepEqual(first.warnings, []);
  assert.equal(embeddings.calls.length, 1, "one batched call, not one per document");

  const second = await refreshIndex({ repoRoot: root, documents: await documentsFor(root), embeddings });
  assert.equal(second.embeddedThisRun, 0);
  assert.equal(second.embedded.size, 5);
  assert.equal(embeddings.calls.length, 1, "an unchanged corpus makes no embed call at all");
});

void test("only a changed document is re-embedded; a removed one leaves the index", async () => {
  const root = await makeRepo();
  const embeddings = createFakeEmbeddings();
  await refreshIndex({ repoRoot: root, documents: await documentsFor(root), embeddings });

  const changed = path.join(root, "issues", "bugs", "2026-02-10-composer-splices-drafts.md");
  await fs.appendFile(changed, "\nAnd it happens on mobile too.\n");
  const afterEdit = await refreshIndex({ repoRoot: root, documents: await documentsFor(root), embeddings });
  assert.equal(afterEdit.embeddedThisRun, 1);
  assert.deepEqual(embeddings.calls.at(-1)?.length, 1);

  await fs.rm(changed);
  const afterDelete = await refreshIndex({ repoRoot: root, documents: await documentsFor(root), embeddings });
  assert.equal(afterDelete.embeddedThisRun, 0);
  assert.equal(afterDelete.embedded.size, 4);
  assert.equal(afterDelete.embedded.has("issues/bugs/2026-02-10-composer-splices-drafts.md"), false);
});

void test("rebuild discards the cache and pays for every embedding again", async () => {
  const root = await makeRepo();
  const embeddings = createFakeEmbeddings();
  await refreshIndex({ repoRoot: root, documents: await documentsFor(root), embeddings });

  const rebuilt = await refreshIndex({
    repoRoot: root, documents: await documentsFor(root), embeddings, rebuild: true,
  });
  assert.equal(rebuilt.embeddedThisRun, 5);
  assert.deepEqual(await fs.readdir(indexDirectory(root)), ["index.json", "manifest.json", "vectors.json"]);
});

void test("a frontmatter-only edit rebuilds the index but costs no embedding", async () => {
  const root = await makeRepo();
  const embeddings = createFakeEmbeddings();
  await refreshIndex({ repoRoot: root, documents: await documentsFor(root), embeddings });

  // `priority` is indexed and filterable but is not part of the embedded text,
  // so the stale-index and stale-vector questions must answer differently.
  const target = path.join(root, "issues", "bugs", "2026-02-10-composer-splices-drafts.md");
  const before = await fs.readFile(target, "utf8");
  await fs.writeFile(target, before.replace("workstream: unattached", "workstream: composer-fixes\npriority: backlog"));

  const refreshed = await refreshIndex({ repoRoot: root, documents: await documentsFor(root), embeddings });
  assert.equal(refreshed.embeddedThisRun, 0, "the embedded text did not change");
  const stale = await runSearch({
    db: refreshed.db, mode: "text", term: "composer", where: { priority: { eq: "uncategorized" } }, limit: 5,
  });
  assert.deepEqual(stale.map((hit) => hit.path), [], "the index no longer holds the old priority");
  const fresh = await runSearch({
    db: refreshed.db, mode: "text", term: "composer", where: { workstream: { eq: "composer-fixes" } }, limit: 5,
  });
  assert.deepEqual(fresh.map((hit) => hit.path), ["issues/bugs/2026-02-10-composer-splices-drafts.md"]);
});

void test("a text-only run drops the stale vector instead of adopting it", async () => {
  const root = await makeRepo();
  const embeddings = createFakeEmbeddings();
  const first = await refreshIndex({ repoRoot: root, documents: await documentsFor(root), embeddings });
  const target = "issues/bugs/2026-02-10-composer-splices-drafts.md";
  const original = first.vectors.get(target);
  assert.ok(original);

  await fs.appendFile(path.join(root, "issues", "bugs", "2026-02-10-composer-splices-drafts.md"), "\nMore detail.\n");
  // No embeddings service: the stored vector describes text that is now gone.
  const offline = await refreshIndex({ repoRoot: root, documents: await documentsFor(root) });
  assert.equal(offline.embedded.has(target), false, "the document reports as unembedded");
  assert.equal(offline.vectors.has(target), false, "and the stale vector is gone, not re-labelled");

  // The next run with a service re-embeds it — proof it was never marked current.
  const online = await refreshIndex({ repoRoot: root, documents: await documentsFor(root), embeddings });
  assert.equal(online.embeddedThisRun, 1);
  assert.notDeepEqual(online.vectors.get(target), original);
});

void test("a failed embed leaves the document unembedded and says so", async () => {
  const root = await makeRepo();
  const failing = createFakeEmbeddings({ failTimes: 1 });
  const refreshed = await refreshIndex({ repoRoot: root, documents: await documentsFor(root), embeddings: failing });
  assert.equal(refreshed.embeddedThisRun, 0);
  assert.equal(refreshed.embedded.size, 0);
  assert.equal(refreshed.warnings.length, 1);
  assert.match(refreshed.warnings[0] ?? "", /embedding failed/u);

  const retried = await refreshIndex({ repoRoot: root, documents: await documentsFor(root), embeddings: failing });
  assert.equal(retried.embeddedThisRun, 5, "a failure is retried, not remembered as done");
});

void test("the public scope keeps its own cache, so switching scopes re-embeds nothing", async () => {
  const root = await makeRepo();
  const embeddings = createFakeEmbeddings();
  await refreshIndex({ repoRoot: root, documents: await documentsFor(root), embeddings, scope: "all" });
  const publicRun = await refreshIndex({
    repoRoot: root, documents: await documentsFor(root), embeddings, scope: "public",
  });
  assert.equal(publicRun.embeddedThisRun, 5, "a separate scope starts with its own empty cache");

  const backToAll = await refreshIndex({
    repoRoot: root, documents: await documentsFor(root), embeddings, scope: "all",
  });
  assert.equal(backToAll.embeddedThisRun, 0, "the full-corpus cache was not disturbed");
});

void test("vector modes refuse to run without a query vector", async () => {
  const root = await makeRepo();
  const refreshed = await refreshIndex({ repoRoot: root, documents: await documentsFor(root) });
  for (const mode of ["semantic", "hybrid"] as const) {
    await assert.rejects(
      runSearch({ db: refreshed.db, mode, term: "calendar", limit: 5 }),
      /without a query vector/u,
    );
  }
});

void test("without an embeddings service nothing is embedded and text search still answers", async () => {
  const root = await makeRepo();
  const refreshed = await refreshIndex({ repoRoot: root, documents: await documentsFor(root) });
  assert.equal(refreshed.embeddedThisRun, 0);
  assert.equal(refreshed.embedded.size, 0);

  const hits = await runSearch({ db: refreshed.db, mode: "text", term: "calendar", limit: 5 });
  assert.deepEqual(hits.map((hit) => hit.path), ["issues/bugs/2026-01-05-calendar-drops-events.md"]);
});

void test("a where clause restricts search to the matching enum values", async () => {
  const root = await makeRepo();
  const refreshed = await refreshIndex({ repoRoot: root, documents: await documentsFor(root) });

  const open = await runSearch({
    db: refreshed.db, mode: "text", term: "router", where: { status: { eq: "open" } }, limit: 5,
  });
  assert.deepEqual(open.map((hit) => hit.path), []);
  const closed = await runSearch({
    db: refreshed.db, mode: "text", term: "router", where: { status: { eq: "closed" } }, limit: 5,
  });
  assert.deepEqual(closed.map((hit) => hit.path), ["issues/closed/bugs/2026-01-20-router-404.md"]);
});

void test("semantic ranking finds the issue whose own vector is the query", async () => {
  const root = await makeRepo();
  const embeddings = createFakeEmbeddings();
  const refreshed = await refreshIndex({ repoRoot: root, documents: await documentsFor(root), embeddings });

  const target = "issues/features/2026-03-01-search-the-queue.md";
  const vector = refreshed.vectors.get(target);
  assert.ok(vector);
  const self = await runSearch({ db: refreshed.db, mode: "semantic", vector, limit: 5 });
  assert.equal(self[0]?.path, target, "a document is its own nearest neighbour");
  const others = await runSearch({
    db: refreshed.db, mode: "semantic", vector, limit: 5, exclude: new Set([target]),
  });
  assert.equal(others.some((hit) => hit.path === target), false);
});
