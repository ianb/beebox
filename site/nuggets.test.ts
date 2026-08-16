// Nugget schema, loader, and the enforcement behaviors: proposed never renders,
// a unique span renders with provenance, a drifted or duplicated span renders
// with a stale marker, and a missing or non-allowlisted source fails the build.
// Failure cases use throwaway temp fixtures rather than committed broken nuggets.
// Run with: pnpm --dir site test

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { isRenderable, loadNuggets, NuggetError, renderNugget, type Nugget } from "./nuggets.js";
import { FrontmatterError } from "./render.js";
import { listSourceRelPaths } from "./sources.js";

const SITE_DIR = import.meta.dirname;
const REPO_ROOT = path.resolve(SITE_DIR, "..");
const RENDER_PARAMS = { base: "/main/site/", pageSitePath: "index.html" };

/** A throwaway repo: <tmp>/site/nuggets/<slug>.md plus the cited source files. */
async function makeFixtureRepo(params: {
  nuggets: Record<string, string>;
  sources: Record<string, string>;
}): Promise<{ nuggetsDir: string; repoRoot: string }> {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "site-nuggets-"));
  const nuggetsDir = path.join(repoRoot, "site", "nuggets");
  await fs.mkdir(nuggetsDir, { recursive: true });
  for (const [name, text] of Object.entries(params.nuggets)) {
    await fs.writeFile(path.join(nuggetsDir, name), text, "utf8");
  }
  for (const [rel, text] of Object.entries(params.sources)) {
    const abs = path.join(repoRoot, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, text, "utf8");
  }
  return { nuggetsDir, repoRoot };
}

function nuggetFile(params: { source: string; span: string; status: string; body: string }): string {
  return `---\nsource: ${params.source}\nspan: ${JSON.stringify(params.span)}\nstatus: ${params.status}\n---\n${params.body}\n`;
}

const DOC = "callback-box/docs/design/README.md";

async function loadOne(nugget: string, sources: Record<string, string>): Promise<Nugget> {
  const fixture = await makeFixtureRepo({ nuggets: { "n.md": nugget }, sources });
  const loaded = await loadNuggets(fixture);
  const first = loaded[0];
  assert.ok(first, "expected one nugget");
  return first;
}

// --- proposed never renders ---------------------------------------------------

test("a proposed nugget loads but is refused for rendering", async () => {
  const nugget = await loadOne(
    nuggetFile({ source: DOC, span: "the shape of the idea", status: "proposed", body: "Agent words." }),
    { [DOC]: "Design: the shape of the idea, as Engelbart had it.\n" },
  );
  assert.equal(nugget.status, "proposed");
  assert.equal(isRenderable(nugget), false);
  assert.throws(() => renderNugget(nugget, RENDER_PARAMS), (e: unknown) => {
    assert.ok(e instanceof NuggetError);
    assert.match(e.message, /status "proposed" and must not be rendered/);
    return true;
  });
});

// --- unique match renders with provenance -------------------------------------

test("a unique span renders the body with provenance and no stale marker", async () => {
  const nugget = await loadOne(
    nuggetFile({ source: DOC, span: "the shape of the idea", status: "reinterpreted", body: "The boxholder's rewrite." }),
    { [DOC]: "Design: the shape of the idea, as Engelbart had it.\n" },
  );
  assert.equal(nugget.spanState, "current");
  const html = renderNugget(nugget, RENDER_PARAMS);
  assert.match(html, /The boxholder&#x27;s rewrite\.|The boxholder's rewrite\./);
  assert.match(html, /<figcaption>from <code>callback-box\/docs\/design\/README\.md<\/code><\/figcaption>/);
  assert.doesNotMatch(html, /nugget-stale/);
});

test("an excerpt with an empty body renders the span itself as its content", async () => {
  const nugget = await loadOne(nuggetFile({ source: DOC, span: "the shape of the idea", status: "excerpt", body: "" }), {
    [DOC]: "Design: the shape of the idea, as Engelbart had it.\n",
  });
  assert.equal(nugget.body, "");
  assert.match(renderNugget(nugget, RENDER_PARAMS), /the shape of the idea/);
});

// --- span drift → visible stale marker ----------------------------------------

test("a span no longer present renders with a stale marker", async () => {
  const nugget = await loadOne(nuggetFile({ source: DOC, span: "a phrase since edited", status: "excerpt", body: "" }), {
    [DOC]: "Design: the shape of the idea.\n",
  });
  assert.equal(nugget.spanState, "missing");
  assert.match(renderNugget(nugget, RENDER_PARAMS), /class="nugget-stale">stale: this excerpt is no longer/);
});

test("a span matching more than once renders with an ambiguous stale marker", async () => {
  const nugget = await loadOne(nuggetFile({ source: DOC, span: "the shape of the idea", status: "excerpt", body: "" }), {
    [DOC]: "the shape of the idea, twice over: the shape of the idea.\n",
  });
  assert.equal(nugget.spanState, "ambiguous");
  assert.match(renderNugget(nugget, RENDER_PARAMS), /class="nugget-stale">stale: this excerpt now appears more than once/);
});

// --- fail-closed: source problems stop the build ------------------------------

test("a missing source file fails the build naming the nugget and the path", async () => {
  const fixture = await makeFixtureRepo({
    nuggets: { "n.md": nuggetFile({ source: DOC, span: "x", status: "excerpt", body: "" }) },
    sources: {},
  });
  await assert.rejects(loadNuggets(fixture), (e: unknown) => {
    assert.ok(e instanceof NuggetError);
    assert.match(e.message, /^nuggets\/n\.md:1 source file cannot be read: callback-box\/docs\/design\/README\.md/);
    return true;
  });
});

test("a source outside the allowlist fails the build", async () => {
  const fixture = await makeFixtureRepo({
    nuggets: { "n.md": nuggetFile({ source: "bin/router.ts", span: "x", status: "excerpt", body: "" }) },
    sources: { "bin/router.ts": "x\n" },
  });
  await assert.rejects(loadNuggets(fixture), (e: unknown) => {
    assert.ok(e instanceof NuggetError);
    assert.match(e.message, /outside the publishable allowlist/);
    return true;
  });
});

test("a source escaping the repo root fails the build even under an allowed prefix", async () => {
  const fixture = await makeFixtureRepo({
    nuggets: { "n.md": nuggetFile({ source: "issues/../../secrets.md", span: "x", status: "excerpt", body: "" }) },
    sources: {},
  });
  await assert.rejects(loadNuggets(fixture), NuggetError);
});

test("a body-less non-excerpt status fails the build", async () => {
  const fixture = await makeFixtureRepo({
    nuggets: { "n.md": nuggetFile({ source: DOC, span: "x", status: "reinterpreted", body: "" }) },
    sources: { [DOC]: "x\n" },
  });
  await assert.rejects(loadNuggets(fixture), (e: unknown) => {
    assert.ok(e instanceof NuggetError);
    assert.match(e.message, /requires a body/);
    return true;
  });
});

// --- frontmatter errors name file + line --------------------------------------

test("an unknown frontmatter field is rejected (strict) naming the file", async () => {
  const fixture = await makeFixtureRepo({
    nuggets: { "n.md": `---\nsource: ${DOC}\nspan: "x"\nstatus: excerpt\nextra: nope\n---\n` },
    sources: { [DOC]: "x\n" },
  });
  await assert.rejects(loadNuggets(fixture), (e: unknown) => {
    assert.ok(e instanceof FrontmatterError);
    assert.match(e.message, /^nuggets\/n\.md:1 frontmatter field/);
    return true;
  });
});

test("an unknown status value is rejected naming the field", async () => {
  const fixture = await makeFixtureRepo({
    nuggets: { "n.md": nuggetFile({ source: DOC, span: "x", status: "published", body: "b" }) },
    sources: { [DOC]: "x\n" },
  });
  await assert.rejects(loadNuggets(fixture), (e: unknown) => {
    assert.ok(e instanceof FrontmatterError);
    assert.match(e.message, /frontmatter field "status"/);
    return true;
  });
});

test("malformed frontmatter YAML fails with a line number", async () => {
  const fixture = await makeFixtureRepo({
    nuggets: { "n.md": "---\nsource: x\n  bad: : :\n---\nbody\n" },
    sources: {},
  });
  await assert.rejects(loadNuggets(fixture), (e: unknown) => {
    assert.ok(e instanceof FrontmatterError);
    assert.match(e.message, /^nuggets\/n\.md:\d+ invalid frontmatter YAML/);
    return true;
  });
});

// --- the committed fixture nugget + the input manifest ------------------------

test("the committed nugget loads, is current, and renders", async () => {
  const nuggets = await loadNuggets({ nuggetsDir: path.join(SITE_DIR, "nuggets"), repoRoot: REPO_ROOT });
  assert.ok(nuggets.length > 0, "expected at least one committed nugget");
  for (const nugget of nuggets) {
    assert.equal(nugget.spanState, "current", `${nugget.file}: span no longer matches ${nugget.source} exactly once`);
    if (isRenderable(nugget)) assert.match(renderNugget(nugget, RENDER_PARAMS), /<figcaption>from <code>/);
  }
});

test("the input manifest covers both the nugget files and the sources they cite", async () => {
  const rels = await listSourceRelPaths(SITE_DIR);
  const nuggets = await loadNuggets({ nuggetsDir: path.join(SITE_DIR, "nuggets"), repoRoot: REPO_ROOT });
  for (const nugget of nuggets) {
    assert.ok(rels.includes(nugget.file), `manifest is missing the nugget file ${nugget.file}`);
    assert.ok(rels.includes(`../${nugget.source}`), `manifest is missing the cited source ${nugget.source}`);
  }
});

// --- cross-model review fixes (2026-08-16) ------------------------------------

test("an excerpt with a body fails to load — the span is the content", async () => {
  await assert.rejects(
    loadOne(nuggetFile({ source: DOC, span: "the shape of the idea", status: "excerpt", body: "Other words." }), {
      [DOC]: "Design: the shape of the idea, as Engelbart had it.\n",
    }),
    (e: unknown) => e instanceof NuggetError && /must have no body/.test(e.message),
  );
});

test("a nugget whose body embeds another nugget refuses to render", async () => {
  const nugget = await loadOne(
    nuggetFile({
      source: DOC,
      span: "the shape of the idea",
      status: "reinterpreted",
      body: "See the record:\n\n{% nugget slug=\"other\" /%}\n",
    }),
    { [DOC]: "Design: the shape of the idea, as Engelbart had it.\n" },
  );
  assert.throws(
    () => renderNugget(nugget, RENDER_PARAMS),
    (e: unknown) => e instanceof NuggetError && /cannot nest/.test(e.message),
  );
});
