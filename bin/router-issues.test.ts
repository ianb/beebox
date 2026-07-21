// Unit tests for router-issues.ts's pure pieces: the frontmatter parser,
// issue classification, diff-output parsing, the overlay merge step, and
// link rewriting — plus an end-to-end fixture-repo test for the git-diff
// overlay itself. Run with:
//   node --import tsx --test bin/router-issues.test.ts
// (or `pnpm test` at the repo root, which runs every bin/*.test.ts this way).

import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";
import {
  parseFrontmatter,
  parseIssueFile,
  parseNameStatusZ,
  parseNulPaths,
  mergeOverlaySources,
  rewriteIssueLinks,
  findClosedIssueLinkHrefs,
  appendClosedIssuePills,
  listIssues,
  collectOverlay,
  parseFilters,
  matches,
  deriveFacets,
} from "./router-issues.js";

// --- parseFrontmatter ---------------------------------------------------------

test("parseFrontmatter: scalars, quoted strings, flow lists", () => {
  const src = `---
title: "Short human title"
needs: [design, decision]
area: callback-box
filed-by: agent
---
body text here`;
  const { data, body } = parseFrontmatter(src);
  assert.equal(data.title, "Short human title");
  assert.deepEqual(data.needs, ["design", "decision"]);
  assert.equal(data.area, "callback-box");
  assert.equal(data["filed-by"], "agent");
  assert.equal(body, "body text here");
});

test("parseFrontmatter: block list", () => {
  const src = `---
title: foo
needs:
  - design
  - decision
area: router
---
body`;
  const { data } = parseFrontmatter(src);
  assert.deepEqual(data.needs, ["design", "decision"]);
  assert.equal(data.area, "router");
});

test("parseFrontmatter: single-quoted values", () => {
  const { data } = parseFrontmatter(`---\ntitle: 'quoted title'\n---\nbody`);
  assert.equal(data.title, "quoted title");
});

test("parseFrontmatter: no frontmatter block returns whole source as body", () => {
  const src = "# just a doc\nno frontmatter here";
  const { data, body } = parseFrontmatter(src);
  assert.deepEqual(data, {});
  assert.equal(body, src);
});

test("parseFrontmatter: unterminated block treated as no frontmatter", () => {
  const src = "---\ntitle: foo\nno closing delimiter";
  const { data, body } = parseFrontmatter(src);
  assert.deepEqual(data, {});
  assert.equal(body, src);
});

// --- parseIssueFile / classification -----------------------------------------

test("parseIssueFile: open issue, category from path, research state", () => {
  const src = `---
title: "Fix the thing"
needs: [decision]
area: callback-box
---
## Research (incomplete)

Not yet researched.`;
  const issue = parseIssueFile("bugs/2026-01-01-fix-the-thing.md", src);
  assert.equal(issue.category, "bugs");
  assert.equal(issue.closed, false);
  assert.equal(issue.slug, "2026-01-01-fix-the-thing");
  assert.equal(issue.frontmatter.title, "Fix the thing");
  assert.deepEqual(issue.frontmatter.needs, ["decision"]);
  assert.equal(issue.research, "awaiting");
});

test("parseIssueFile: closed issue preserves category under closed/", () => {
  const src = `---\ntitle: "Done thing"\nresolution: implemented\n---\nClosed body.`;
  const issue = parseIssueFile("closed/features/2026-02-02-done-thing.md", src);
  assert.equal(issue.category, "features");
  assert.equal(issue.closed, true);
  assert.equal(issue.frontmatter.resolution, "implemented");
});

test("parseIssueFile: researched state and title fallback to H1", () => {
  const src = `# An old-style title\n\n## Research (2026-05-01)\n\nFindings here.`;
  const issue = parseIssueFile("exploration/2026-05-01-old-style.md", src);
  assert.equal(issue.frontmatter.title, "An old-style title");
  assert.equal(issue.research, "researched");
});

test("parseIssueFile: no title anywhere falls back to the slug", () => {
  const issue = parseIssueFile("bugs/2026-01-01-mystery.md", "just body text, no frontmatter or H1");
  assert.equal(issue.frontmatter.title, "2026-01-01-mystery");
  assert.equal(issue.research, "none");
});

// --- labels facet -------------------------------------------------------------

test("parseIssueFile: labels parsed from a flow list", () => {
  const src = `---\ntitle: "Tagged"\nlabels: [soft-launch, epic-onboarding]\n---\nbody`;
  const issue = parseIssueFile("features/2026-01-01-tagged.md", src);
  assert.deepEqual(issue.frontmatter.labels, ["soft-launch", "epic-onboarding"]);
});

test("parseIssueFile: labels default to [] when absent", () => {
  const issue = parseIssueFile("bugs/2026-01-01-plain.md", `---\ntitle: "Plain"\n---\nbody`);
  assert.deepEqual(issue.frontmatter.labels, []);
});

test("matches: an issue appears under each of its labels, and not under others", () => {
  const issue = parseIssueFile(
    "features/2026-01-01-tagged.md",
    `---\ntitle: "Tagged"\nlabels: [soft-launch, epic-onboarding]\n---\nbody`,
  );
  const under = (label: string): boolean =>
    matches(issue, parseFilters(new URLSearchParams(`labels=${label}`)), false);
  assert.equal(under("soft-launch"), true);
  assert.equal(under("epic-onboarding"), true);
  assert.equal(under("nope"), false);
});

test("deriveFacets: lists distinct labels sorted, across issues", () => {
  const issues = [
    parseIssueFile("features/2026-01-01-a.md", `---\ntitle: "A"\nlabels: [soft-launch, zeta]\n---\nx`),
    parseIssueFile("bugs/2026-01-02-b.md", `---\ntitle: "B"\nlabels: [soft-launch, alpha]\n---\nx`),
    parseIssueFile("bugs/2026-01-03-c.md", `---\ntitle: "C"\n---\nx`),
  ];
  assert.deepEqual(deriveFacets(issues).labels, ["alpha", "soft-launch", "zeta"]);
});

// --- parseNameStatusZ / parseNulPaths ------------------------------------------

test("parseNameStatusZ: added, modified, deleted", () => {
  const stdout = ["A", "issues/bugs/new.md", "M", "issues/bugs/changed.md", "D", "issues/bugs/gone.md"].join("\0") + "\0";
  const out = parseNameStatusZ(stdout);
  assert.deepEqual(out, [
    { code: "A", path: "issues/bugs/new.md" },
    { code: "M", path: "issues/bugs/changed.md" },
    { code: "D", path: "issues/bugs/gone.md" },
  ]);
});

test("parseNameStatusZ: rename carries old and new paths", () => {
  const stdout = ["R100", "issues/bugs/old.md", "issues/bugs/new.md"].join("\0") + "\0";
  const out = parseNameStatusZ(stdout);
  assert.deepEqual(out, [{ code: "R", path: "issues/bugs/new.md", oldPath: "issues/bugs/old.md" }]);
});

test("parseNameStatusZ: empty stdout", () => {
  assert.deepEqual(parseNameStatusZ(""), []);
});

test("parseNulPaths: strips empty tokens", () => {
  const stdout = ["issues/bugs/a.md", "issues/bugs/b.md"].join("\0") + "\0";
  assert.deepEqual(parseNulPaths(stdout), ["issues/bugs/a.md", "issues/bugs/b.md"]);
  assert.deepEqual(parseNulPaths(""), []);
});

// --- mergeOverlaySources -------------------------------------------------------

test("mergeOverlaySources: committed + uncommitted + untracked merge by relPath", () => {
  const committed = ["M", "issues/bugs/edited.md"].join("\0") + "\0";
  const uncommitted = ["M", "issues/bugs/edited.md"].join("\0") + "\0";
  const untracked = ["issues/bugs/brand-new.md"].join("\0") + "\0";
  const out = mergeOverlaySources("worktree-foo", committed, uncommitted, untracked);
  assert.deepEqual(out.get("bugs/edited.md"), [
    { worktree: "worktree-foo", status: "modified", committed: true },
    { worktree: "worktree-foo", status: "modified", committed: false },
  ]);
  assert.deepEqual(out.get("bugs/brand-new.md"), [
    { worktree: "worktree-foo", status: "added", committed: false },
  ]);
});

test("mergeOverlaySources: rename records under both old and new path", () => {
  const committed = ["R100", "issues/bugs/old.md", "issues/bugs/new.md"].join("\0") + "\0";
  const out = mergeOverlaySources("worktree-foo", committed, "", "");
  assert.equal(out.get("bugs/new.md")?.[0]?.status, "renamed");
  assert.equal(out.get("bugs/old.md")?.[0]?.status, "renamed");
});

// --- rewriteIssueLinks ---------------------------------------------------------

test("rewriteIssueLinks: same-category link", () => {
  const md = "See [related](foo.md) for context.";
  const out = rewriteIssueLinks(md, "bugs", "/main/dev/issues");
  assert.equal(out.md, "See [related](/main/dev/issues/bugs/foo.md) for context.");
  assert.equal(out.closedHrefs.size, 0);
});

test("rewriteIssueLinks: cross-category link", () => {
  const md = "See [related](../features/foo.md).";
  const out = rewriteIssueLinks(md, "bugs", "/main/dev/issues");
  assert.equal(out.md, "See [related](/main/dev/issues/features/foo.md).");
});

test("rewriteIssueLinks: preserves anchor, leaves external/absolute/anchor-only links alone", () => {
  const md = "[a](foo.md#section) [b](https://example.com/x.md) [c](/absolute/x.md) [d](#local)";
  const out = rewriteIssueLinks(md, "bugs", "/main/dev/issues");
  assert.equal(out.md, "[a](/main/dev/issues/bugs/foo.md#section) [b](https://example.com/x.md) [c](/absolute/x.md) [d](#local)");
  assert.equal(out.closedHrefs.size, 0);
});

test("rewriteIssueLinks: leaves non-.md links untouched", () => {
  const md = "[code](../../src/foo.ts)";
  assert.equal(rewriteIssueLinks(md, "bugs", "/main/dev/issues").md, md);
});

test("rewriteIssueLinks: link to a closed issue is rewritten and flagged in closedHrefs", () => {
  const md = "See [fixed](../closed/bugs/2026-07-19-foo.md) for the postmortem.";
  const out = rewriteIssueLinks(md, "bugs", "/main/dev/issues");
  assert.equal(out.md, "See [fixed](/main/dev/issues/closed/bugs/2026-07-19-foo.md) for the postmortem.");
  assert.deepEqual([...out.closedHrefs], ["/main/dev/issues/closed/bugs/2026-07-19-foo.md"]);
});

test("rewriteIssueLinks: link to an open issue is not flagged", () => {
  const md = "See [related](../features/foo.md).";
  const out = rewriteIssueLinks(md, "bugs", "/main/dev/issues");
  assert.equal(out.closedHrefs.size, 0);
});

// --- findClosedIssueLinkHrefs (docs browser) ----------------------------------

test("findClosedIssueLinkHrefs: flags a link resolving under issues/closed/", () => {
  const md = "See [foo](../issues/closed/bugs/2026-07-19-foo.md) for details.";
  const hrefs = findClosedIssueLinkHrefs(md, "docs");
  assert.deepEqual([...hrefs], ["../issues/closed/bugs/2026-07-19-foo.md"]);
});

test("findClosedIssueLinkHrefs: does not flag an open issue or an external link", () => {
  const md = "[open](../issues/bugs/2026-07-19-bar.md) [ext](https://example.com/issues/closed/x.md)";
  const hrefs = findClosedIssueLinkHrefs(md, "docs");
  assert.equal(hrefs.size, 0);
});

// --- appendClosedIssuePills ----------------------------------------------------

test("appendClosedIssuePills: appends a pill after a matching link, leaves others alone", () => {
  const html = '<p>See <a href="/main/dev/issues/closed/bugs/foo.md">fixed</a> and <a href="/main/dev/issues/bugs/open.md">open</a>.</p>';
  const out = appendClosedIssuePills(html, new Set(["/main/dev/issues/closed/bugs/foo.md"]));
  assert.equal(
    out,
    '<p>See <a href="/main/dev/issues/closed/bugs/foo.md">fixed</a><span class="chip chip-closed-link">closed</span> and <a href="/main/dev/issues/bugs/open.md">open</a>.</p>',
  );
});

test("appendClosedIssuePills: no-op when closedHrefs is empty", () => {
  const html = '<p><a href="/main/dev/issues/bugs/open.md">open</a></p>';
  assert.equal(appendClosedIssuePills(html, new Set()), html);
});

// --- fixture-repo integration test for listIssues + collectOverlay -----------

async function mkTmpDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function git(cwd: string, args: string[]): Promise<void> {
  await execa("git", args, { cwd });
}

async function writeIssue(root: string, relPath: string, content: string): Promise<void> {
  const full = path.join(root, "issues", relPath);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, "utf8");
}

test("listIssues + collectOverlay: end-to-end fixture repo", { timeout: 30_000 }, async () => {
  const base = await mkTmpDir("router-issues-test-");
  const mainRoot = path.join(base, "main");
  const worktreesRoot = path.join(base, "worktrees");
  await fs.mkdir(mainRoot, { recursive: true });
  await fs.mkdir(worktreesRoot, { recursive: true });

  // Set up "main": a git repo with a couple of issues on the main branch.
  await git(mainRoot, ["init", "-q", "-b", "main"]);
  await git(mainRoot, ["config", "user.email", "test@example.com"]);
  await git(mainRoot, ["config", "user.name", "Test"]);
  await writeIssue(mainRoot, "bugs/2026-01-01-alpha.md", `---\ntitle: "Alpha bug"\n---\nAlpha body.`);
  await writeIssue(mainRoot, "features/2026-01-02-beta.md", `---\ntitle: "Beta feature"\n---\nBeta body.`);
  await git(mainRoot, ["add", "-A"]);
  await git(mainRoot, ["commit", "-q", "-m", "seed issues"]);

  const issues = await listIssues(path.join(mainRoot, "issues"));
  assert.equal(issues.length, 2);
  assert.ok(issues.some((i) => i.relPath === "bugs/2026-01-01-alpha.md"));
  assert.ok(issues.some((i) => i.relPath === "features/2026-01-02-beta.md"));

  // Set up a worktree branching from main: modify alpha (committed), add a
  // brand-new issue (untracked), and touch beta uncommitted.
  const wtRoot = path.join(worktreesRoot, "worktree-foo");
  await git(mainRoot, ["worktree", "add", "-q", "-b", "worktree-foo", wtRoot, "main"]);
  await git(wtRoot, ["config", "user.email", "test@example.com"]);
  await git(wtRoot, ["config", "user.name", "Test"]);

  await writeIssue(wtRoot, "bugs/2026-01-01-alpha.md", `---\ntitle: "Alpha bug"\n---\nAlpha body, edited.`);
  await git(wtRoot, ["add", "-A"]);
  await git(wtRoot, ["commit", "-q", "-m", "edit alpha"]);

  await writeIssue(wtRoot, "features/2026-01-02-beta.md", `---\ntitle: "Beta feature"\n---\nBeta body, uncommitted edit.`);

  await writeIssue(wtRoot, "bugs/2026-03-03-gamma.md", `---\ntitle: "Gamma new"\n---\nBrand new, untracked.`);

  const overlay = await collectOverlay(worktreesRoot);
  assert.ok(overlay.worktreeRoots.has("worktree-foo"));

  const alphaEntries = overlay.byPath.get("bugs/2026-01-01-alpha.md");
  assert.ok(alphaEntries?.some((e) => e.worktree === "worktree-foo" && e.status === "modified" && e.committed === true));

  const betaEntries = overlay.byPath.get("features/2026-01-02-beta.md");
  assert.ok(betaEntries?.some((e) => e.worktree === "worktree-foo" && e.status === "modified" && e.committed === false));

  const gammaEntries = overlay.byPath.get("bugs/2026-03-03-gamma.md");
  assert.ok(gammaEntries?.some((e) => e.worktree === "worktree-foo" && e.status === "added" && e.committed === false));

  await git(mainRoot, ["worktree", "remove", "-f", wtRoot]);
  await fs.rm(base, { recursive: true, force: true });
});

test("collectOverlay: a worktree with no .git marker is skipped, not fatal", async () => {
  const base = await mkTmpDir("router-issues-nogit-");
  const worktreesRoot = path.join(base, "worktrees");
  await fs.mkdir(path.join(worktreesRoot, "not-a-repo"), { recursive: true });
  const overlay = await collectOverlay(worktreesRoot);
  assert.equal(overlay.byPath.size, 0);
  assert.equal(overlay.worktreeRoots.size, 0);
  await fs.rm(base, { recursive: true, force: true });
});
