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
 * in the tables at the top of this file. Edit them to reshape the story.
 *
 * Vibe images live in docs/doc-graph-images/<pillar-id>.png. They are
 * intentionally abstract, never representational.
 *
 * Usage: pnpm doc-graph-html
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { buildGraph, ROOT, type DocInfo } from "./doc-graph-data.js";

// ----- Pillars: eight chapters of "what this codebase does" -----

interface Pillar {
  id: string;
  name: string;
  blurb: string;
  vibe: string;
  color: string;
  entry: string;
  entryNote: string;
  supporting: Array<{ path: string; note?: string }>;
  code: string[];
}

const PILLARS: Pillar[] = [
  {
    id: "cards",
    name: "Cards",
    blurb: "The core data format. YAML-frontmatter markdown with typed schemas — that's it.",
    vibe: "Cards are the atoms. Everything else is just a way of moving them, reading them, or judging them. The simplicity is load-bearing.",
    color: "#c2410c",
    entry: "docs/cards-as-markdown.md",
    entryNote: "The deep design RFC. 2,553 lines. The first ~200 are the spine; skim the rest unless you're migrating.",
    supporting: [
      { path: "docs/adding-schemas.md", note: "Read this before writing a new card type. Saves an embarrassing amount of time." },
      { path: "docs/EXAMPLE_FILES.md", note: "A browseable cookbook of every card shape in the system." },
      { path: "docs/migrations.md", note: "What to run when the card format changes under a live box." },
    ],
    code: ["src/schemas/", "src/core/card-io.ts"],
  },
  {
    id: "connectors",
    name: "Connectors",
    blurb: "The world dripping in. Sync external services into the box filesystem as cards.",
    vibe: "Each connector's job is small: pull stuff, turn it into cards, leave them in the inbox. Boring on purpose.",
    color: "#0e7490",
    entry: "docs/connectors.md",
    entryNote: "The pattern. Read this first; the per-service docs are variations.",
    supporting: [
      { path: "src/connectors/CLAUDE.md", note: "Per-directory rules. Auto-loads when Claude reads connector code." },
      { path: "docs/gmail-setup.md", note: "OAuth dance for Gmail. Notable for 'just one more callback' energy." },
      { path: "docs/telegram-setup.md", note: "Telegram bot setup. Calmest of the connectors." },
      { path: "docs/google-drive.md", note: "Drive watch-and-pull. Underused so far." },
      { path: "docs/calendar.md", note: "The newest one. Still ironing out edges." },
    ],
    code: ["src/connectors/"],
  },
  {
    id: "reactor",
    name: "Wakeup & Reactor",
    blurb: "The cycle that drives everything: sync → process → execute → schedule → sleep.",
    vibe: "A polling loop dressed up in agent clothes. The whole system has a heartbeat, and this is it.",
    color: "#6d28d9",
    entry: "src/core/reactor/CLAUDE.md",
    entryNote: "Per-directory guide — lives next to the code it documents. Auto-loads.",
    supporting: [
      { path: "docs/scheduler.md", note: "How the next wakeup gets set. Cron, except it's a CLI." },
      { path: "docs/chat-schedules.md", note: "When the agent should proactively message you." },
    ],
    code: ["src/core/reactor/", "src/core/"],
  },
  {
    id: "procedures",
    name: "Procedures",
    blurb: "Multi-step workflows the agent follows, with state captured in run files.",
    vibe: "The least settled part of the system. The engine works; the design isn't done.",
    color: "#a21caf",
    entry: "docs/procedure-implementation.md",
    entryNote: "Engine internals. Short — it's a small piece.",
    supporting: [],
    code: ["src/core/procedure-engine.ts"],
  },
  {
    id: "frontend",
    name: "Frontend",
    blurb: "React UI on a small palette of primitives with strict rules about escape hatches.",
    vibe: "The constraint is the feature: any agent that touches UI can only break it in narrow, recoverable ways.",
    color: "#15803d",
    entry: "FRONTEND.md",
    entryNote: "Palette, primitives, the 'no className except outer layout' rule. Required reading before touching pages.",
    supporting: [
      { path: "docs/landmarks.md", note: "How the URL bar becomes a navigation surface for the agent." },
      { path: "docs/source-editor.md", note: "Aspirational. Not built yet. Read for direction, not state-of-the-world." },
      { path: "docs/ssr-render-testing.md", note: "Hack to preview pages from the CLI without a browser." },
      { path: "docs/client-debug-log.md", note: "When your frontend bug evaporates the moment devtools opens — catch it here." },
    ],
    code: ["src/frontend/", "src/webapp/"],
  },
  {
    id: "testing",
    name: "Testing",
    blurb: "Doctests as the primary test format, plus periodic agent knowledge audits.",
    vibe: "Docs ARE the tests. If a doc goes stale, its tests start failing. Painful when it works.",
    color: "#1d4ed8",
    entry: "docs/testing.md",
    entryNote: "Philosophy. 537 lines on why doctests, then how.",
    supporting: [
      { path: ".claude/rules/doctest.md", note: "Syntax cheatsheet. Read once, refer often." },
      { path: "docs/knowledge-audits.md", note: "Periodic 'does the agent still know what we think it knows?' tests." },
      { path: "docs/maintenance.md", note: "The meta-tools: doc-graph, prompt-report — including the thing rendering this page." },
    ],
    code: ["test/", "src/test-lib/"],
  },
  {
    id: "boxes",
    name: "Boxes",
    blurb: "The per-user filesystems the system actually operates on.",
    vibe: "Boxes live outside this repo on purpose — so the agent doesn't accidentally inherit dev-time context when it's working on someone's life.",
    color: "#a16207",
    entry: "docs/box-layout.md",
    entryNote: "What a box's filesystem actually looks like, top to bottom.",
    supporting: [
      { path: "docs/adding-a-box.md", note: "Procedure for spinning up a new one." },
    ],
    code: ["~/src/boxes/"],
  },
  {
    id: "deploy",
    name: "Deploy & Ops",
    blurb: "Auto-deploy on commit to main; rsync to a small VPS; server runs tsx directly.",
    vibe: "Two scripts and a post-commit hook. If it ever needed Docker, something would have gone wrong.",
    color: "#475569",
    entry: "deploy/README.md",
    entryNote: "Two scripts. That's the whole story.",
    supporting: [
      { path: "deploy/CLAUDE.md", note: "Per-dir guide. Tiny." },
      { path: "docs/server-operations.md", note: "What to do when the prod box is wedged." },
    ],
    code: ["deploy/"],
  },
];

// ----- Curator's stroll — annotations for docs beyond the pillars -----
// Grouped by theme so the outer rings feel intentional, not orphaned.

interface CuratorEntry {
  path: string;
  note: string;
}
interface CuratorSection {
  title: string;
  blurb: string;
  entries: CuratorEntry[];
}

const CURATOR: CuratorSection[] = [
  {
    title: "Long views",
    blurb: "Ian thinking out loud, mostly for himself. None of these are required reading — but they're where the project's voice actually lives.",
    entries: [
      { path: "docs/architecture/CLAUDE.md", note: "Index for the longform architecture series. Sets the tone." },
      { path: "docs/architecture/01-what-is-this.md", note: "The 'so what IS this thing' question, answered patiently." },
      { path: "docs/architecture/02-cards-and-memory.md", note: "Companion piece — the 'what's a card, really' explainer." },
      { path: "docs/architecture/spirit.md", note: "Mood piece. The vibes of the system, on paper." },
      { path: "docs/architecture/family.md", note: "A fictional family used as the running example throughout the design docs." },
      { path: "docs/architecture/writing-style.md", note: "Style guide for these very docs. Yes, meta." },
      { path: "docs/DESIGN.md", note: "The early grand design. Outdated in places; valuable for the original framing." },
      { path: "docs/IMPLEMENTATION.md", note: "Companion to DESIGN.md — how the grand design was meant to land." },
      { path: "docs/design-vision.md", note: "Shorter vision statement, written later. The voice is more settled." },
      { path: "docs/glossary.md", note: "Terms used across the project. Shows how the vocabulary stabilized." },
    ],
  },
  {
    title: "Speculative",
    blurb: "Designs for things that don't exist yet — or might never. Useful for finding out where Ian's head was at when he wrote them.",
    entries: [
      { path: "docs/design-card-views.md", note: "876 lines of plugin system that may or may not get built." },
      { path: "docs/event-bus-design.md", note: "An event bus, designed, awaiting motivation to exist." },
      { path: "docs/boxes-as-packages.md", note: "What if every box were an npm package? Thought experiment." },
      { path: "docs/box-user-account-spec.md", note: "What if every box were a Linux user? Also thought experiment." },
      { path: "docs/narration-mode-design.md", note: "Speculative voice/narration mode for the agent." },
      { path: "docs/triage-design.md", note: "How a triage subsystem could work, if built." },
      { path: "docs/pdf-intake-design.md", note: "PDF processing path. Partly implemented." },
      { path: "docs/capture-pipeline-redesign.md", note: "Plan for redoing the capture pipeline. Awaiting trigger." },
      { path: "docs/activities-design.md", note: "Designed a thing called Activities…" },
      { path: "docs/activities-retrospective.md", note: "…then took it apart. Both docs left as the trail." },
    ],
  },
  {
    title: "Archaeology",
    blurb: "Decisions made, considered, or undone. Worth a glance when you find yourself reopening the same question.",
    entries: [
      { path: "docs/stack-decisions.md", note: "1,186 lines of 'why X and not Y'. Archived so the question doesn't recur." },
      { path: "docs/state-management-comparison.md", note: "Survey for a decision that turned out not to need making." },
      { path: "docs/photo-storage-investigation.md", note: "Forensic note from when a box got fat. Disk math, recovery options." },
      { path: "docs/cli-restructure.md", note: "Plan that's mostly executed; the doc lingers as a record." },
      { path: "CLAUDE-MD-REVIEW.md", note: "One-pass audit of all the CLAUDE.md files. Working document — marked for deletion." },
    ],
  },
  {
    title: "Notes to self",
    blurb: "Loose ends, late-night thoughts, things that are someone's problem (Ian's) and not yet anyone else's.",
    entries: [
      { path: "docs/todo-security.md", note: "Things that scare him at 2am. Still a TODO." },
      { path: "docs/health-checks.md", note: "When something's on fire, this is what to grep." },
      { path: "docs/landmark-curation.md", note: "Which landmarks to surface to the agent. Hand-tuned." },
      { path: "docs/agent-knowledge.md", note: "What the agent is expected to know, vs. what it knows. The accountability ledger." },
      { path: "docs/prompt-audits.md", note: "Catching stock-LLM phrases that crept into prompts." },
      { path: "docs/prompt-logging.md", note: "Log every agent invocation — what was sent, what came back." },
      { path: "THINKING_CLAUDE.md", note: "Experimental thinking mode for Claude itself. Might get deleted." },
      { path: "docs/ideas.md", note: "936-line idea graveyard. The good ones bubble up to actual docs eventually." },
      { path: "docs/testing-gaps.md", note: "Areas where coverage is admittedly thin. Honesty in writing." },
    ],
  },
];

// ----- Ring classification -----

interface RingDef {
  level: number;
  name: string;
  flavour: string;
  trigger: string;
}

const RING_DEFS: RingDef[] = [
  {
    level: 0,
    name: "Always in the room",
    flavour: "Loaded with every session, before the first turn.",
    trigger: "Root CLAUDE.md and anything it @-includes.",
  },
  {
    level: 1,
    name: "On the way in",
    flavour: "Auto-loads when Claude opens a file in that directory.",
    trigger: "Nested CLAUDE.md files act as per-area guides.",
  },
  {
    level: 2,
    name: "One link away",
    flavour: "Reached by following a link from the loaded layers.",
    trigger: "Mentioned in CLAUDE.md, FRONTEND.md, CODE-STYLE.md — Claude opens them on demand.",
  },
  {
    level: 3,
    name: "Two links away",
    flavour: "Reachable in two hops — the docs the docs lead to.",
    trigger: "Background reading the agent finds while pulling on a thread.",
  },
  {
    level: 4,
    name: "Out in the field",
    flavour: "Not linked from the loaded layers — found by traversal, search, or tool output.",
    trigger: "Working notes, archaeology, speculative designs. See the Curator's stroll below.",
  },
];

const ROOT_CLAUDE = "CLAUDE.md";

function classifyRings(docs: Map<string, DocInfo>): Map<string, number> {
  const ring = new Map<string, number>();

  const always = new Set<string>([ROOT_CLAUDE]);
  const queue = [ROOT_CLAUDE];
  while (queue.length > 0) {
    const cur = queue.shift() as string;
    const doc = docs.get(cur);
    if (!doc) continue;
    for (const ref of doc.outgoing) {
      if (ref.type === "at-include" && ref.resolved && !always.has(ref.target)) {
        always.add(ref.target);
        queue.push(ref.target);
      }
    }
  }
  for (const p of always) ring.set(p, 0);

  for (const p of docs.keys()) {
    if (ring.has(p)) continue;
    if (path.basename(p) === "CLAUDE.md") ring.set(p, 1);
  }

  const expandFrom = (sourceLevel: number, newLevel: number) => {
    const sources = [...ring.entries()].filter(([, lvl]) => lvl === sourceLevel).map(([p]) => p);
    for (const src of sources) {
      const doc = docs.get(src);
      if (!doc) continue;
      for (const ref of doc.outgoing) {
        if (ref.resolved && !ring.has(ref.target)) ring.set(ref.target, newLevel);
      }
    }
  };
  for (const lvl of [0, 1]) expandFrom(lvl, 2);
  expandFrom(2, 3);

  for (const p of docs.keys()) if (!ring.has(p)) ring.set(p, 4);

  return ring;
}

function classifyPillars(): Map<string, Pillar> {
  const m = new Map<string, Pillar>();
  for (const p of PILLARS) {
    m.set(p.entry, p);
    for (const s of p.supporting) m.set(s.path, p);
  }
  return m;
}

// ----- HTML rendering -----

function escapeHtml(s: string): string {
  return s.replace(/["&'<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

function vsLink(p: string): string {
  return `vscode://file${path.join(ROOT, p)}`;
}

function chip(doc: DocInfo, pillar: Pillar | undefined): string {
  const color = pillar ? pillar.color : "#a3a394";
  const title = escapeHtml(`${doc.path} — "${doc.title}" (${doc.lineCount} lines)${pillar ? ` · ${pillar.name}` : ""}`);
  return `<a class="chip" href="${vsLink(doc.path)}" style="--c:${color}" title="${title}">${escapeHtml(doc.path)}</a>`;
}

function renderRings(
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

function renderPillars(docs: Map<string, DocInfo>): string {
  return PILLARS.map((p) => {
    const entryDoc = docs.get(p.entry);
    const supportItems = p.supporting
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
    const codeTags = p.code.map((c) => `<code class="code-tag">${escapeHtml(c)}</code>`).join("");
    const imgRel = `doc-graph-images/${p.id}.png`;
    const imgPath = path.join(ROOT, "docs", imgRel);
    const hasImg = fs.existsSync(imgPath);
    const headerStyle = hasImg
      ? `background-image: linear-gradient(180deg, rgba(20,16,10,0.45) 0%, rgba(20,16,10,0.85) 100%), url('${imgRel}');`
      : `background: linear-gradient(135deg, ${p.color}, ${p.color}99);`;
    const entryBlock = entryDoc
      ? `<a class="pillar-entry" href="${vsLink(p.entry)}" style="--c:${p.color}">
          <span class="entry-arrow">→</span>
          <div class="entry-text">
            <span class="entry-path">${escapeHtml(p.entry)}</span>
            <span class="entry-title">"${escapeHtml(entryDoc.title)}" · ${entryDoc.lineCount} lines</span>
          </div>
        </a>
        <p class="entry-note">${escapeHtml(p.entryNote)}</p>`
      : `<div class="pillar-entry missing">${escapeHtml(p.entry)} (not found)</div>`;
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

function renderCurator(docs: Map<string, DocInfo>): string {
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

function renderHealth(docs: Map<string, DocInfo>): string {
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
<style>
  :root {
    --bg: #f5efe2;
    --paper: #fbf6e9;
    --paper-2: #ede4cc;
    --ink: #2a241d;
    --ink-soft: #5a4e3e;
    --muted: #8a7d68;
    --rule: #d8cdb1;
    --accent: #b35a1f;
    --link: #8c3d12;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background:
      radial-gradient(ellipse at top, #fff8e7 0%, var(--bg) 60%) no-repeat,
      var(--bg);
    color: var(--ink);
    font: 16px/1.6 "Iowan Old Style", "Charter", Georgia, "Times New Roman", serif;
    -webkit-font-smoothing: antialiased;
  }
  a { color: var(--link); text-decoration: none; }
  a:hover { text-decoration: underline; text-decoration-style: wavy; text-underline-offset: 3px; }
  code, .mono { font: 13px/1.5 "JetBrains Mono", "SF Mono", Menlo, Consolas, monospace; }
  .muted { color: var(--muted); }

  .page { max-width: 1150px; margin: 0 auto; padding: 56px 32px 80px; }

  /* ---- Hero ---- */
  header.hero { padding-bottom: 36px; border-bottom: 1px dashed var(--rule); margin-bottom: 56px; }
  .hero .eyebrow {
    font: 11px/1 "Iowan Old Style", Georgia, serif;
    letter-spacing: 0.3em;
    text-transform: uppercase;
    color: var(--accent);
    margin-bottom: 16px;
  }
  .hero h1 {
    font-size: 44px;
    font-weight: 600;
    margin: 0 0 16px;
    letter-spacing: -0.015em;
    line-height: 1.1;
    font-style: italic;
  }
  .hero .tagline {
    font-size: 19px;
    color: var(--ink-soft);
    margin: 0 0 28px;
    max-width: 720px;
    line-height: 1.55;
  }
  .hero .stats { display: flex; gap: 40px; flex-wrap: wrap; margin-top: 28px; }
  .stat { font: 12px/1 "Iowan Old Style", Georgia, serif; color: var(--muted); letter-spacing: 0.06em; text-transform: uppercase; }
  .stat strong {
    display: block;
    font-size: 32px;
    color: var(--ink);
    font-weight: 600;
    font-style: italic;
    margin-bottom: 4px;
    text-transform: none;
    letter-spacing: -0.01em;
  }

  /* ---- Sections ---- */
  h2.section {
    font-size: 30px;
    font-weight: 600;
    font-style: italic;
    letter-spacing: -0.01em;
    margin: 72px 0 4px;
  }
  .section-eyebrow {
    font: 11px/1 "Iowan Old Style", Georgia, serif;
    letter-spacing: 0.3em;
    text-transform: uppercase;
    color: var(--accent);
    margin-bottom: 8px;
  }
  .section-lede {
    color: var(--ink-soft);
    margin: 0 0 32px;
    max-width: 740px;
    font-size: 17px;
  }

  /* ---- Rings ---- */
  .ring {
    display: grid;
    grid-template-columns: 260px 1fr;
    gap: 28px;
    padding: 22px 28px;
    background: var(--paper);
    border: 1px solid var(--rule);
    border-radius: 4px;
    margin-bottom: 14px;
    position: relative;
  }
  .ring::before {
    content: "";
    position: absolute;
    left: 0; top: 0; bottom: 0;
    width: 6px;
    background: var(--c, var(--accent));
    border-radius: 4px 0 0 4px;
  }
  .ring-0 { --c: #b35a1f; background: linear-gradient(90deg, #fef1d8 0%, var(--paper) 80%); }
  .ring-1 { --c: #d97706; background: linear-gradient(90deg, #fdf3e0 0%, var(--paper) 80%); }
  .ring-2 { --c: #b08c4a; }
  .ring-3 { --c: #8a7d68; }
  .ring-4 { --c: #b3a487; opacity: 0.92; }

  .ring-num {
    display: inline-block;
    font: 10px/1 "Iowan Old Style", Georgia, serif;
    letter-spacing: 0.25em;
    text-transform: uppercase;
    color: var(--muted);
    margin-bottom: 6px;
  }
  .ring-label h3 { margin: 0 0 6px; font-size: 19px; font-weight: 600; font-style: italic; }
  .ring-flavour { margin: 0 0 6px; color: var(--ink); font-size: 14px; }
  .ring-trigger { margin: 0 0 10px; color: var(--muted); font-size: 13px; font-style: italic; }
  .ring-count {
    display: inline-block; padding: 3px 10px;
    background: var(--paper-2); border-radius: 12px;
    font: 11px/1 "JetBrains Mono", monospace; color: var(--ink-soft);
  }

  .ring-chips { display: flex; flex-wrap: wrap; gap: 6px 7px; align-content: flex-start; }
  .chip {
    display: inline-block;
    padding: 5px 10px;
    border-radius: 3px;
    font: 12px/1.2 "JetBrains Mono", "SF Mono", monospace;
    background: var(--paper-2);
    color: var(--ink);
    border-left: 3px solid var(--c);
    transition: transform 0.1s ease;
  }
  .chip:hover { text-decoration: none; transform: translateY(-1px); background: #e6dcc0; }
  .empty { color: var(--muted); font-size: 14px; font-style: italic; }

  /* ---- Pillars ---- */
  .pillars {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
    gap: 20px;
  }
  .pillar {
    background: var(--paper);
    border: 1px solid var(--rule);
    border-radius: 6px;
    overflow: hidden;
    display: flex; flex-direction: column;
  }
  .pillar-header {
    padding: 24px 24px 20px;
    color: #fff8e7;
    background-size: cover;
    background-position: center;
    background-color: var(--c);
    border-bottom: 3px solid var(--c);
    min-height: 130px;
  }
  .pillar-header h3 {
    margin: 0 0 8px;
    font-size: 24px;
    font-weight: 600;
    font-style: italic;
    letter-spacing: -0.01em;
    color: #fff;
    text-shadow: 0 1px 3px rgba(0,0,0,0.4);
  }
  .pillar-blurb { margin: 0; font-size: 14px; line-height: 1.5; color: rgba(255,253,240,0.9); text-shadow: 0 1px 2px rgba(0,0,0,0.4); }
  .pillar-body { padding: 18px 22px 22px; flex: 1; display: flex; flex-direction: column; }
  .pillar-vibe {
    margin: 0 0 18px;
    font-style: italic;
    color: var(--ink-soft);
    font-size: 15px;
    line-height: 1.5;
    padding-left: 14px;
    border-left: 2px solid var(--c);
  }
  .pillar-entry {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
    background: var(--paper-2);
    border-radius: 4px;
    border-left: 4px solid var(--c);
    color: var(--ink);
    margin-bottom: 8px;
  }
  .pillar-entry:hover { background: #e6dcc0; text-decoration: none; }
  .entry-arrow { color: var(--c); font-weight: 700; font-size: 18px; }
  .entry-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .entry-path { font: 13px/1.2 "JetBrains Mono", monospace; word-break: break-word; }
  .entry-title { font-size: 12px; color: var(--muted); }
  .entry-note {
    margin: 0 0 16px;
    font-size: 13px;
    color: var(--ink-soft);
    font-style: italic;
    padding: 0 4px;
  }
  .pillar-entry.missing { color: #b91c1c; background: #fef2f2; border-color: #b91c1c; }

  .pillar-support { list-style: none; padding: 0; margin: 0 0 16px; display: flex; flex-direction: column; gap: 10px; }
  .pillar-support li {
    padding: 8px 10px;
    border-radius: 3px;
    background: rgba(0,0,0,0.02);
  }
  .pillar-support li.missing { color: #b91c1c; }
  .pillar-support .path { font: 12px/1.3 "JetBrains Mono", monospace; }
  .pillar-support .meta { font-size: 11px; color: var(--muted); margin-left: 8px; }
  .pillar-support .curator-note {
    display: block;
    margin-top: 4px;
    font-size: 13px;
    color: var(--ink-soft);
    font-style: italic;
    line-height: 1.45;
  }
  .pillar-code { display: flex; flex-wrap: wrap; gap: 6px; margin-top: auto; padding-top: 12px; border-top: 1px dashed var(--rule); }
  .code-tag {
    padding: 3px 9px;
    background: var(--paper-2);
    color: var(--ink-soft);
    border-radius: 3px;
    font-size: 11px;
  }

  /* ---- Curator section ---- */
  .curator { margin-top: 48px; }
  .curator-section {
    margin-bottom: 40px;
    padding: 24px 28px;
    background: var(--paper);
    border-radius: 4px;
    border: 1px solid var(--rule);
  }
  .curator-section h3 {
    margin: 0 0 6px;
    font-size: 22px;
    font-style: italic;
    font-weight: 600;
    color: var(--accent);
  }
  .curator-blurb {
    margin: 0 0 20px;
    color: var(--ink-soft);
    font-size: 14px;
    font-style: italic;
    max-width: 720px;
  }
  .curator-list { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 14px 24px; }
  .curator-list li {
    padding: 10px 0;
    border-top: 1px dotted var(--rule);
  }
  .curator-list li.missing { color: #b91c1c; }
  .curator-list .path { font: 12px/1.3 "JetBrains Mono", monospace; }
  .curator-list .meta { font-size: 11px; color: var(--muted); margin-left: 6px; }
  .curator-list .curator-note { margin: 4px 0 0; font-size: 13px; color: var(--ink-soft); line-height: 1.5; font-style: italic; }

  /* ---- Health ---- */
  .health {
    margin-top: 56px; padding: 16px 22px;
    background: var(--paper);
    border: 1px solid var(--rule);
    border-radius: 4px;
  }
  .health summary { cursor: pointer; color: var(--ink-soft); font-size: 13px; font-style: italic; }
  .health summary:hover { color: var(--ink); }
  .health-body { margin-top: 12px; }
  .health-body ul { padding-left: 20px; font-size: 13px; color: var(--muted); }
  .health-body code { color: var(--ink); }

  footer.colophon {
    margin-top: 56px; padding-top: 24px;
    border-top: 1px dashed var(--rule);
    color: var(--muted); font-size: 12px; font-style: italic;
  }
</style>
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
