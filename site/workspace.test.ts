import assert from "node:assert/strict";
import { test } from "node:test";
import { headingIds, prepareWorkspace, type SitePage } from "./workspace-model.js";
import { resolveInternalHref } from "./links.js";
import { workspaceShell } from "./workspace.js";
import { twinCardLinks } from "./twin-links.js";

const authorship = {
  people: [{ name: "Ian Bicking", role: "author", contribution: "Directed the card." }],
  ai: { transcription: "none", drafting: "none", editing: "none", "source-preparation": "Prepared the source." },
};

function fixture(): SitePage[] {
  return [
    { id: "menu.doc.card", output: "menu.doc.card/index.html", href: "/x/menu.doc.card/", html: "<h1>Menu</h1>", frontmatter: { title: "Menu", summary: "Menu", authorship, navigation: true } },
    { id: "Parent.doc.card", output: "Parent.doc.card/index.html", href: "/x/Parent.doc.card/", html: headingIds("<h1>Parent</h1><h2>Continue here</h2><p>Parent text</p>"), frontmatter: { title: "Parent", summary: "Main", authorship, next: [{ card: "/Parent.attach/Aside.doc.card", label: "Read the note" }] } },
    { id: "Parent.attach/Aside.doc.card", output: "Parent.attach/Aside.doc.card/index.html", href: "/x/Parent.attach/Aside.doc.card/", html: "<h1>Aside</h1><p>Aside text</p>", frontmatter: { title: "Aside", summary: "Note", authorship, theme: "post-it", next: [{ card: "/Parent.doc.card", at: "continue-here", label: "Continue" }] } },
  ];
}

test("native card links preserve attachment vocabulary at nested and root bases", () => {
  for (const base of ["/", "/public-site/site/"]) {
    assert.deepEqual(resolveInternalHref({ href: "../Parent.doc.card#continue-here", pageSitePath: "Parent.attach/Aside.doc.card", base }), {
      target: "Parent.doc.card/index.html", href: `${base}Parent.doc.card/#continue-here`,
    });
    assert.equal(resolveInternalHref({ href: "/index.site-page.card", pageSitePath: "x.doc.card", base }).href, `${base}index.html`);
  }
});

test("a deep aside statically contains its canonical parent and authored continuation", () => {
  const pages = fixture();
  const workspace = prepareWorkspace({ pages, base: "/x/" });
  const aside = pages[2];
  assert.ok(aside);
  assert.equal(aside.parentId, "Parent.doc.card");
  const html = workspaceShell(workspace, aside);
  assert.match(html, /Parent text/);
  assert.match(html, /Aside text/);
  assert.match(html, /href="\/x\/Parent.doc.card\/#continue-here"/);
  assert.match(html, /id="context-continue-here"/);
  assert.match(html, /data-card-theme="post-it"/);
  assert.match(html, /data-place="\/x\/Parent.doc.card\/"/);
  assert.match(html, /On the back/);
  assert.match(html, /Ian Bicking/);
  assert.match(html, /Source preparation<\/dt><dd>Prepared the source/);
  assert.match(html, /bbx-card-back[^]*Parent\.attach\/Aside\.doc\.card/);
});

test("bad next destinations and missing sections fail before publication", () => {
  const pages = fixture();
  const aside = pages[2];
  assert.ok(aside?.frontmatter.next?.[0]);
  aside.frontmatter.next[0].at = "missing";
  assert.throws(() => prepareWorkspace({ pages, base: "/x/" }), /next section missing/);
  aside.frontmatter.next[0].card = "/gone.doc.card";
  assert.throws(() => prepareWorkspace({ pages, base: "/x/" }), /next.card not found/);
});

test("orphaned attachments and ambiguous navigation fail closed", () => {
  const pages = fixture();
  assert.throws(() => prepareWorkspace({ pages: pages.filter((p) => p.id !== "Parent.doc.card"), base: "/x/" }), /exactly one parent/);
  assert.throws(() => prepareWorkspace({ pages: pages.filter((p) => !p.frontmatter.navigation), base: "/x/" }), /exactly one card/);
});

test("heading IDs remain unique even when an authored heading resembles a duplicate suffix", () => {
  assert.equal(headingIds("<h2>A</h2><h2>A</h2><h2>A-2</h2>"), '<h2 id="a">A</h2><h2 id="a-2">A</h2><h2 id="a-2-2">A-2</h2>');
});

test("machine-facing card links resolve to fetchable Markdown twins", () => {
  assert.equal(twinCardLinks("[Parent](../Parent.doc.card#continue-here)", { id: "Parent.attach/Aside.doc.card", base: "/x/" }), "[Parent](/x/Parent.md#continue-here)");
  assert.equal(twinCardLinks("```\n[Example](Parent.doc.card)\n```", { id: "index.site-page.card", base: "/" }), "```\n[Example](Parent.doc.card)\n```");
  assert.equal(twinCardLinks("[External](https://example.com/Parent.doc.card)", { id: "index.site-page.card", base: "/" }), "[External](https://example.com/Parent.doc.card)");
});
