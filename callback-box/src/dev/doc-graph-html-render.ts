/**
 * HTML rendering for the doc-graph showcase: the small escaping/link helpers
 * and the four section renderers (rings, pillars, curator, health). These
 * consume the curated tables from doc-graph-html-data.ts and the live doc
 * graph from doc-graph-data.ts. The page shell that stitches them together
 * lives in doc-graph-html.ts.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { ROOT, type DocInfo } from "./doc-graph-data.js";
import {
  CURATOR,
  PILLARS,
  RING_DEFS,
  type Pillar,
} from "./doc-graph-html-data.js";

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(s: string): string {
  return s.replace(/["&'<>]/g, (c) => HTML_ESCAPES[c] ?? c);
}

function vsLink(p: string): string {
  // Keep the link repo-relative so the committed HTML carries no machine-absolute
  // path (it's a shared/checked-in artifact). A local `vscode://file` open needs
  // an absolute path; that convenience is traded away to keep the file portable
  // and free of the author's home directory. `p` is already repo-relative.
  return `vscode://file/${p}`;
}

function chip(doc: DocInfo, pillar: Pillar | undefined): string {
  const color = pillar ? pillar.color : "#a3a394";
  const title = escapeHtml(`${doc.path} — "${doc.title}" (${doc.lineCount} lines)${pillar ? ` · ${pillar.name}` : ""}`);
  return `<a class="chip" href="${vsLink(doc.path)}" style="--c:${color}" title="${title}">${escapeHtml(doc.path)}</a>`;
}

export function renderRings(
  docs: Map<string, DocInfo>,
  { rings, pillars }: { rings: Map<string, number>; pillars: Map<string, Pillar> },
): string {
  return RING_DEFS.map((def) => {
    const inRing = [...docs.values()]
      .filter((d) => rings.get(d.path) === def.level)
      .toSorted((a, b) => a.path.localeCompare(b.path));
    const chips = inRing.map((d) => chip(d, pillars.get(d.path))).join("");
    return `
      <section class="ring ring-${def.level}">
        <div class="ring-label">
          <span class="ring-num">Layer ${def.level}</span>
          <h3>${escapeHtml(def.name)}</h3>
          <p class="ring-flavour">${escapeHtml(def.flavour)}</p>
          <p class="ring-trigger">${escapeHtml(def.trigger)}</p>
          <span class="ring-count">${inRing.length} doc${inRing.length === 1 ? "" : "s"}</span>
        </div>
        <div class="ring-chips">${chips || '<em class="empty">none</em>'}</div>
      </section>
    `;
  }).join("");
}

function renderPillarSupport(supporting: Pillar["supporting"], docs: Map<string, DocInfo>): string {
  return supporting
    .map((s) => {
      const d = docs.get(s.path);
      if (!d) return `<li class="missing"><span class="path">${escapeHtml(s.path)}</span> <span class="muted">(not found)</span></li>`;
      const note = s.note ? `<span class="curator-note">${escapeHtml(s.note)}</span>` : "";
      return `<li>
          <a class="path" href="${vsLink(d.path)}">${escapeHtml(d.path)}</a>
          <span class="meta">${d.lineCount} lines</span>
          ${note}
        </li>`;
    })
    .join("");
}

function renderPillarHeaderStyle(p: Pillar): string {
  const imgRel = `doc-graph-images/${p.id}.png`;
  const imgPath = path.join(ROOT, "docs", imgRel);
  const hasImg = fs.existsSync(imgPath);
  return hasImg
    ? `background-image: linear-gradient(180deg, rgba(20,16,10,0.45) 0%, rgba(20,16,10,0.85) 100%), url('${imgRel}');`
    : `background: linear-gradient(135deg, ${p.color}, ${p.color}99);`;
}

function renderPillarEntry(p: Pillar, entryDoc: DocInfo | undefined): string {
  if (!entryDoc) return `<div class="pillar-entry missing">${escapeHtml(p.entry)} (not found)</div>`;
  return `<a class="pillar-entry" href="${vsLink(p.entry)}" style="--c:${p.color}">
          <span class="entry-arrow">→</span>
          <div class="entry-text">
            <span class="entry-path">${escapeHtml(p.entry)}</span>
            <span class="entry-title">"${escapeHtml(entryDoc.title)}" · ${entryDoc.lineCount} lines</span>
          </div>
        </a>
        <p class="entry-note">${escapeHtml(p.entryNote)}</p>`;
}

export function renderPillars(docs: Map<string, DocInfo>): string {
  return PILLARS.map((p) => {
    const entryDoc = docs.get(p.entry);
    const supportItems = renderPillarSupport(p.supporting, docs);
    const codeTags = p.code.map((c) => `<code class="code-tag">${escapeHtml(c)}</code>`).join("");
    const headerStyle = renderPillarHeaderStyle(p);
    const entryBlock = renderPillarEntry(p, entryDoc);
    return `
      <article class="pillar" style="--c:${p.color}">
        <header class="pillar-header" style="${headerStyle}">
          <h3>${escapeHtml(p.name)}</h3>
          <p class="pillar-blurb">${escapeHtml(p.blurb)}</p>
        </header>
        <div class="pillar-body">
          <p class="pillar-vibe">${escapeHtml(p.vibe)}</p>
          ${entryBlock}
          ${supportItems ? `<ul class="pillar-support">${supportItems}</ul>` : ""}
          <div class="pillar-code">${codeTags}</div>
        </div>
      </article>
    `;
  }).join("");
}

export function renderCurator(docs: Map<string, DocInfo>): string {
  return CURATOR.map((section) => {
    const items = section.entries
      .map((e) => {
        const d = docs.get(e.path);
        if (!d) return `<li class="missing"><span class="path">${escapeHtml(e.path)}</span> <span class="muted">(not found)</span></li>`;
        return `<li>
          <a class="path" href="${vsLink(d.path)}">${escapeHtml(d.path)}</a>
          <span class="meta">${d.lineCount} lines</span>
          <p class="curator-note">${escapeHtml(e.note)}</p>
        </li>`;
      })
      .join("");
    return `
      <section class="curator-section">
        <h3>${escapeHtml(section.title)}</h3>
        <p class="curator-blurb">${escapeHtml(section.blurb)}</p>
        <ul class="curator-list">${items}</ul>
      </section>
    `;
  }).join("");
}

export function renderHealth(docs: Map<string, DocInfo>): string {
  const orphans = [...docs.values()].filter((d) => d.incoming.length === 0).length;
  const broken: Array<{ from: string; target: string; line: number }> = [];
  for (const d of docs.values()) {
    for (const ref of d.outgoing) {
      if (!ref.resolved) broken.push({ from: d.path, target: ref.target, line: ref.line });
    }
  }
  return `
    <details class="health">
      <summary>Vital signs: ${docs.size} docs · ${orphans} unreferenced · ${broken.length} broken link${broken.length === 1 ? "" : "s"}</summary>
      <div class="health-body">
        <p class="muted">Unreferenced doesn't mean unloved — landing pages, indexes, and working notes all live here on purpose. The full audit (every reference in context) lives in <code>docs/doc-graph.md</code>.</p>
        ${broken.length > 0 ? `<ul>${broken.map((b) => `<li><code>${escapeHtml(b.from)}:${b.line}</code> → <code>${escapeHtml(b.target)}</code></li>`).join("")}</ul>` : ""}
      </div>
    </details>
  `;
}
