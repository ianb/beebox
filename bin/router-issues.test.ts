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
  addVisibilityPrefix,
  stripVisibilityPrefix,
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

// --- visibility (private-issues shadow repo) -----------------------------------

test("parseIssueFile: visibility defaults to public when omitted", () => {
  const issue = parseIssueFile("bugs/2026-01-01-fix-the-thing.md", `---\ntitle: "Fix"\n---\nbody`);
  assert.equal(issue.visibility, "public");
});

test("parseIssueFile: private records get visibility set, and category/closed parsing is identical to public", () => {
  const src = `---\ntitle: "Private thing"\nresolution: implemented\n---\nbody`;
  const publicIssue = parseIssueFile("closed/features/2026-02-02-x.md", src, "public");
  const privateIssue = parseIssueFile("closed/features/2026-02-02-x.md", src, "private");
  assert.equal(privateIssue.visibility, "private");
  // Same relPath, same source — every OTHER field must parse identically
  // regardless of visibility, since relPath stays issue-relative for both
  // sources and category/closed classification never looks at visibility.
  assert.equal(privateIssue.category, publicIssue.category);
  assert.equal(privateIssue.closed, publicIssue.closed);
  assert.equal(privateIssue.slug, publicIssue.slug);
  assert.deepEqual(privateIssue.frontmatter, publicIssue.frontmatter);
});

// --- addVisibilityPrefix / stripVisibilityPrefix (URL layer) -------------------

test("addVisibilityPrefix / stripVisibilityPrefix: round-trip for public and private, including closed/ nesting", () => {
  for (const visibility of ["public", "private"] as const) {
    for (const relPath of ["bugs/2026-01-01-foo.md", "closed/features/2026-02-02-bar.md"]) {
      const url = addVisibilityPrefix(relPath, visibility);
      const back = stripVisibilityPrefix(url);
      assert.equal(back.visibility, visibility);
      assert.equal(back.relPath, relPath);
    }
  }
});

test("addVisibilityPrefix: public relPath is unprefixed; private gets a private/ segment", () => {
  assert.equal(addVisibilityPrefix("bugs/foo.md", "public"), "bugs/foo.md");
  assert.equal(addVisibilityPrefix("bugs/foo.md", "private"), "private/bugs/foo.md");
});

test("stripVisibilityPrefix: a category that merely starts with 'private' (not the literal segment) stays public", () => {
  // Guards against a naive startsWith("private") — only a full "private/"
  // path SEGMENT switches visibility, never a same-prefixed category name.
  const out = stripVisibilityPrefix("private-stuff/2026-01-01-foo.md");
  assert.equal(out.visibility, "public");
  assert.equal(out.relPath, "private-stuff/2026-01-01-foo.md");
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

test("parseFilters: visibility facet reads a valid value, ignores an invalid one", () => {
  assert.equal(parseFilters(new URLSearchParams("visibility=private")).visibility, "private");
  assert.equal(parseFilters(new URLSearchParams("visibility=public")).visibility, "public");
  assert.equal(parseFilters(new URLSearchParams("visibility=bogus")).visibility, undefined);
  assert.equal(parseFilters(new URLSearchParams("")).visibility, undefined);
});

test("matches: visibility filter isolates public from private issues, unset shows both", () => {
  const pub = parseIssueFile("bugs/2026-01-01-a.md", `---\ntitle: "A"\n---\nx`, "public");
  const priv = parseIssueFile("bugs/2026-01-01-a.md", `---\ntitle: "A"\n---\nx`, "private");
  const publicOnly = parseFilters(new URLSearchParams("visibility=public"));
  const privateOnly = parseFilters(new URLSearchParams("visibility=private"));
  const unset = parseFilters(new URLSearchParams(""));
  assert.equal(matches(pub, publicOnly, false), true);
  assert.equal(matches(priv, publicOnly, false), false);
  assert.equal(matches(pub, privateOnly, false), false);
  assert.equal(matches(priv, privateOnly, false), true);
  assert.equal(matches(pub, unset, false), true);
  assert.equal(matches(priv, unset, false), true);
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
  const out = rewriteIssueLinks(md, "bugs", "/workstreams/issues");
  assert.equal(out.md, "See [related](/workstreams/issues/bugs/foo.md) for context.");
  assert.equal(out.closedHrefs.size, 0);
});

test("rewriteIssueLinks: cross-category link", () => {
  const md = "See [related](../features/foo.md).";
  const out = rewriteIssueLinks(md, "bugs", "/workstreams/issues");
  assert.equal(out.md, "See [related](/workstreams/issues/features/foo.md).");
});

test("rewriteIssueLinks: preserves anchor, leaves external/absolute/anchor-only links alone", () => {
  const md = "[a](foo.md#section) [b](https://example.com/x.md) [c](/absolute/x.md) [d](#local)";
  const out = rewriteIssueLinks(md, "bugs", "/workstreams/issues");
  assert.equal(out.md, "[a](/workstreams/issues/bugs/foo.md#section) [b](https://example.com/x.md) [c](/absolute/x.md) [d](#local)");
  assert.equal(out.closedHrefs.size, 0);
});

test("rewriteIssueLinks: leaves non-.md links untouched", () => {
  const md = "[code](../../src/foo.ts)";
  assert.equal(rewriteIssueLinks(md, "bugs", "/workstreams/issues").md, md);
});

test("rewriteIssueLinks: link to a closed issue is rewritten and flagged in closedHrefs", () => {
  const md = "See [fixed](../closed/bugs/2026-07-19-foo.md) for the postmortem.";
  const out = rewriteIssueLinks(md, "bugs", "/workstreams/issues");
  assert.equal(out.md, "See [fixed](/workstreams/issues/closed/bugs/2026-07-19-foo.md) for the postmortem.");
  assert.deepEqual([...out.closedHrefs], ["/workstreams/issues/closed/bugs/2026-07-19-foo.md"]);
});

test("rewriteIssueLinks: link to an open issue is not flagged", () => {
  const md = "See [related](../features/foo.md).";
  const out = rewriteIssueLinks(md, "bugs", "/workstreams/issues");
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
  const html = '<p>See <a href="/workstreams/issues/closed/bugs/foo.md">fixed</a> and <a href="/workstreams/issues/bugs/open.md">open</a>.</p>';
  const out = appendClosedIssuePills(html, new Set(["/workstreams/issues/closed/bugs/foo.md"]));
  assert.equal(
    out,
    '<p>See <a href="/workstreams/issues/closed/bugs/foo.md">fixed</a><span class="chip chip-closed-link">closed</span> and <a href="/workstreams/issues/bugs/open.md">open</a>.</p>',
  );
});

test("appendClosedIssuePills: no-op when closedHrefs is empty", () => {
  const html = '<p><a href="/workstreams/issues/bugs/open.md">open</a></p>';
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
  assert.equal(overlay.byPathPrivate.size, 0);
  assert.equal(overlay.worktreeRoots.size, 0);
  await fs.rm(base, { recursive: true, force: true });
});

// --- private-issues mount: listIssues + collectOverlay -------------------------

test("listIssues: an absent private root yields zero records, not an error", async () => {
  const base = await mkTmpDir("router-issues-noprivroot-");
  const records = await listIssues(path.join(base, "private-issues"), "private");
  assert.deepEqual(records, []);
  await fs.rm(base, { recursive: true, force: true });
});

test("listIssues: private root's categories sit at ITS root (no issues/ prefix), and every record is tagged private", async () => {
  const base = await mkTmpDir("router-issues-privroot-");
  const privateRoot = path.join(base, "private-issues");
  await fs.mkdir(path.join(privateRoot, "bugs"), { recursive: true });
  await fs.mkdir(path.join(privateRoot, "closed", "features"), { recursive: true });
  await fs.writeFile(path.join(privateRoot, "bugs", "2026-01-01-alpha.md"), `---\ntitle: "Alpha"\n---\nbody`);
  await fs.writeFile(path.join(privateRoot, "closed", "features", "2026-02-02-beta.md"), `---\ntitle: "Beta"\n---\nbody`);
  // A root-level file (the private repo's README.md analogue) outside any
  // recognized category dir must stay invisible, same as the public side.
  await fs.writeFile(path.join(privateRoot, "README.md"), "not an issue");

  const records = await listIssues(privateRoot, "private");
  assert.equal(records.length, 2);
  assert.ok(records.every((r) => r.visibility === "private"));
  assert.ok(records.some((r) => r.relPath === "bugs/2026-01-01-alpha.md" && !r.closed));
  assert.ok(records.some((r) => r.relPath === "closed/features/2026-02-02-beta.md" && r.closed));
  await fs.rm(base, { recursive: true, force: true });
});

async function writePrivateIssue(privateRoot: string, relPath: string, content: string): Promise<void> {
  const full = path.join(privateRoot, relPath);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, "utf8");
}

test(
  "collectOverlay: private worktree overlay is scoped to category dirs, keeps a root file out, and never merges into the public map even at the same relPath",
  { timeout: 30_000 },
  async () => {
    const base = await mkTmpDir("router-issues-privoverlay-");
    const worktreesRoot = path.join(base, "worktrees");
    await fs.mkdir(worktreesRoot, { recursive: true });

    // The public side of the worktree: an ordinary repo, seeded with an
    // issue at "bugs/2026-01-01-alpha.md" — the SAME relPath the private
    // side below will also use, to prove the two never cross-attribute.
    const wtRoot = path.join(worktreesRoot, "worktree-priv");
    await fs.mkdir(wtRoot, { recursive: true });
    await git(wtRoot, ["init", "-q", "-b", "main"]);
    await git(wtRoot, ["config", "user.email", "test@example.com"]);
    await git(wtRoot, ["config", "user.name", "Test"]);
    await writeIssue(wtRoot, "bugs/2026-01-01-alpha.md", `---\ntitle: "Public alpha"\n---\nbody`);
    await git(wtRoot, ["add", "-A"]);
    await git(wtRoot, ["commit", "-q", "-m", "seed public"]);

    // The private mount: router-issues.ts only cares that <wtRoot>/private-issues
    // has a .git marker — in production it's a symlink to a private worktree,
    // but a plain directory that IS its own repo stands in fine for this test.
    // Categories sit at ITS root (no "issues/" prefix), matching the plan.
    const privRoot = path.join(wtRoot, "private-issues");
    await fs.mkdir(privRoot, { recursive: true });
    await git(privRoot, ["init", "-q", "-b", "main"]);
    await git(privRoot, ["config", "user.email", "test@example.com"]);
    await git(privRoot, ["config", "user.name", "Test"]);
    await writePrivateIssue(privRoot, "bugs/2026-01-01-alpha.md", `---\ntitle: "Private alpha"\n---\nbody`);
    await writePrivateIssue(privRoot, "README.md", "not an issue — must never appear as one");
    await git(privRoot, ["add", "-A"]);
    await git(privRoot, ["commit", "-q", "-m", "seed private"]);
    await git(privRoot, ["checkout", "-q", "-b", "worktree-priv"]);
    // An untracked new private issue, to exercise the ls-files leg too.
    await writePrivateIssue(privRoot, "bugs/2026-03-03-gamma.md", `---\ntitle: "Private new"\n---\nbody`);

    const overlay = await collectOverlay(worktreesRoot);

    // The root README.md never leaks in as a phantom issue.
    assert.equal(overlay.byPathPrivate.has("README.md"), false);

    // The untracked private issue is present, keyed relative to the private
    // root (no "issues/" prefix).
    const gamma = overlay.byPathPrivate.get("bugs/2026-03-03-gamma.md");
    assert.ok(gamma?.some((e) => e.worktree === "worktree-priv" && e.status === "added" && e.committed === false));

    // Neither map crosses into the other for the shared relPath: the public
    // worktree made no changes to bugs/2026-01-01-alpha.md (it just seeded
    // it on main, so main...HEAD and HEAD are both clean for it), so byPath
    // has nothing for it — while byPathPrivate also has nothing for it
    // (unchanged since the private "seed" commit). The key assertion is that
    // gamma (private-only) never appears in byPath at all.
    assert.equal(overlay.byPath.get("bugs/2026-03-03-gamma.md"), undefined);

    await fs.rm(base, { recursive: true, force: true });
  },
);

test("collectOverlay: a worktree with no private-issues mount contributes nothing to byPathPrivate", async () => {
  const base = await mkTmpDir("router-issues-noprivmount-");
  const worktreesRoot = path.join(base, "worktrees");
  const wtRoot = path.join(worktreesRoot, "worktree-bare");
  await fs.mkdir(wtRoot, { recursive: true });
  await git(wtRoot, ["init", "-q", "-b", "main"]);
  await git(wtRoot, ["config", "user.email", "test@example.com"]);
  await git(wtRoot, ["config", "user.name", "Test"]);
  await writeIssue(wtRoot, "bugs/2026-01-01-a.md", `---\ntitle: "A"\n---\nbody`);
  await git(wtRoot, ["add", "-A"]);
  await git(wtRoot, ["commit", "-q", "-m", "seed"]);

  const overlay = await collectOverlay(worktreesRoot);
  assert.equal(overlay.byPathPrivate.size, 0);
  // The public side still works normally.
  assert.ok(overlay.worktreeRoots.has("worktree-bare"));
  await fs.rm(base, { recursive: true, force: true });
});
