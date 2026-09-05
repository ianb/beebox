/**
 * The temp-tree issue fixtures `bin/issues.test.ts` runs against — a handful of
 * issue files with the frontmatter shapes the derivation, filter, and grouping
 * tests need, plus the helpers that write and load them.
 *
 * Split out of `bin/issues.test.ts` purely for size; the fixtures and helpers
 * are unchanged.
 */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { IssueEntry } from "../workstreams-app/src/server/issue-search-model.js";

export interface Fixture {
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
      "area: beebox",
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
      "area: beebox",
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

export async function writeFixtures(root: string, fixtures?: Fixture[]): Promise<void> {
  for (const fixture of fixtures ?? FIXTURES) {
    const directory = path.join(root, "issues", fixture.category);
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(
      path.join(directory, fixture.name),
      `---\n${fixture.frontmatter}\n---\n\n${fixture.body ?? "Body.\n"}`,
    );
  }
}

export async function makeRepo(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "issues-cli-"));
  await writeFixtures(root);
  return root;
}

export function byPath(entries: IssueEntry[]): Map<string, IssueEntry> {
  return new Map(entries.map((entry) => [entry.path, entry]));
}
