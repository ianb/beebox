#!/usr/bin/env node --import tsx
/**
 * Documentation graph showcase (HTML).
 *
 * Renders the doc corpus as a positive narrative: how context reaches Claude
 * in concentric "Onboarding Rings", what the codebase is made of through
 * eight topic "Pillars", and a curator's stroll through the stranger docs.
 *
 * The data layer is shared with doc-graph.ts (which emits the dry markdown
 * audit). Hand-curated text — the pillar vibes, the per-doc notes — lives
 * in doc-graph-html-data.ts. Section rendering lives in
 * doc-graph-html-render.ts and the stylesheet in doc-graph-html-css.ts;
 * edit those to reshape the story. This file is the entrypoint: it builds
 * the graph, assembles the page shell, and writes the file.
 *
 * Vibe images live in docs/doc-graph-images/<pillar-id>.png. They are
 * intentionally abstract, never representational.
 *
 * Usage: pnpm doc-graph-html
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { buildGraph, ROOT, type DocInfo } from "./doc-graph-data.js";
import { CURATOR, PILLARS, classifyPillars, classifyRings } from "./doc-graph-html-data.js";
import { renderCurator, renderHealth, renderPillars, renderRings } from "./doc-graph-html-render.js";
import { PAGE_CSS } from "./doc-graph-html-css.js";

function render(docs: Map<string, DocInfo>): string {
  const rings = classifyRings(docs);
  const pillars = classifyPillars();
  const totalRefs = [...docs.values()].reduce((n, d) => n + d.outgoing.filter((r) => r.resolved).length, 0);
  const totalLines = [...docs.values()].reduce((n, d) => n + d.lineCount, 0);
  const alwaysCount = [...rings.values()].filter((l) => l === 0).length;
  const dirCount = [...rings.values()].filter((l) => l === 1).length;
  const curatorCount = CURATOR.reduce((n, s) => n + s.entries.length, 0);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Documenting callback-box for Claude</title>
<style>${PAGE_CSS}</style>
</head>
<body>
<div class="page">

  <header class="hero">
    <div class="eyebrow">A field guide</div>
    <h1>Documenting callback-box, for the agent that lives in it</h1>
    <p class="tagline">
      This codebase is built so that an AI agent can read its way into competence. The
      documentation isn't a pile — it's a layered context delivery system <em>and</em> a
      curriculum of topics. What follows is an inventory of the shape it makes.
    </p>
    <div class="stats">
      <div class="stat"><strong>${docs.size}</strong>markdown documents</div>
      <div class="stat"><strong>${totalLines.toLocaleString()}</strong>lines of prose</div>
      <div class="stat"><strong>${totalRefs}</strong>cross-references</div>
      <div class="stat"><strong>${alwaysCount + dirCount}</strong>auto-loaded guides</div>
      <div class="stat"><strong>${PILLARS.length}</strong>topic pillars</div>
      <div class="stat"><strong>${curatorCount}</strong>curator's picks</div>
    </div>
  </header>

  <div class="section-eyebrow">I &nbsp;·&nbsp; Onboarding the agent</div>
  <h2 class="section">Concentric rings of context</h2>
  <p class="section-lede">
    When Claude starts a session, the root <code>CLAUDE.md</code> is already in its context window —
    before you say a word. As it reads files, more <code>CLAUDE.md</code>'s pull in automatically; as it
    follows links, deeper material loads on demand. The layering keeps the working set small while
    putting any needed knowledge within a hop or two.
  </p>
  ${renderRings(docs, { rings, pillars })}

  <div class="section-eyebrow" style="margin-top:72px">II &nbsp;·&nbsp; The substance</div>
  <h2 class="section" style="margin-top:4px">Eight pillars the project rests on</h2>
  <p class="section-lede">
    These are the conversations the codebase wants to have with the agent reading it. Each pillar
    points at a canonical entry doc (where to start), the supporting material (when you need more),
    and the code dirs it governs. The chip colors in the rings above match these pillars — so you
    can see at a glance where each pillar's docs sit in the context layering.
  </p>
  <div class="pillars">${renderPillars(docs)}</div>

  <div class="section-eyebrow" style="margin-top:72px">III &nbsp;·&nbsp; A stroll through the stacks</div>
  <h2 class="section" style="margin-top:4px">The curator's notes</h2>
  <p class="section-lede">
    Not every doc fits in a pillar, and that's fine — some are letters to a future Ian, some are designs
    for things that may never exist, some are post-mortems for things that did. This is where they live,
    grouped so they feel intentional.
  </p>
  <div class="curator">${renderCurator(docs)}</div>

  ${renderHealth(docs)}

  <footer class="colophon">
    Rendered ${new Date().toISOString().slice(0, 19).replace("T", " ")} UTC by
    <code>src/dev/doc-graph-html.ts</code> from a live scan of <code>callback-box/</code>.
    The pillar narration and curator's notes are hand-edited at the top of that file.
    Vibe images by Gemini Flash Image, prompted for textures only.
    For the dry audit (every reference in context, full inventory), see <a href="doc-graph.md">doc-graph.md</a>.
  </footer>
</div>
</body>
</html>
`;
}

const docs = buildGraph();
const html = render(docs);
const outPath = path.join(ROOT, "docs/doc-graph.html");
fs.writeFileSync(outPath, html);
process.stderr.write(`Wrote ${outPath} (${docs.size} docs)\n`);
