/**
 * Hand-curated narrative tables for the doc-graph HTML showcase, plus the
 * ring/pillar classification logic that turns the raw doc graph into the
 * layered story the page tells.
 *
 * The text here is the story: the pillar vibes, the per-doc curator notes,
 * the onboarding-ring flavour. Edit these tables to reshape the narrative.
 * Rendering lives in doc-graph-html-render.ts; the entrypoint is
 * doc-graph-html.ts.
 */

import * as path from "node:path";
import { type DocInfo } from "./doc-graph-data.js";

// ----- Pillars: eight chapters of "what this codebase does" -----

export interface Pillar {
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

export const PILLARS: Pillar[] = [
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
      { path: "docs/plans/source-editor.md", note: "Aspirational. Not built yet. Read for direction, not state-of-the-world." },
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

export interface CuratorEntry {
  path: string;
  note: string;
}
export interface CuratorSection {
  title: string;
  blurb: string;
  entries: CuratorEntry[];
}

export const CURATOR: CuratorSection[] = [
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
      { path: "docs/unimplemented-plans/design-card-views.md", note: "876 lines of plugin system — superseded by the shipped renderer registry." },
      { path: "docs/event-bus-design.md", note: "An event bus, designed, awaiting motivation to exist." },
      { path: "docs/unimplemented-plans/boxes-as-packages.md", note: "What if every box were an npm package? Thought experiment." },
      { path: "docs/unimplemented-plans/box-user-account-spec.md", note: "What if every box were a Linux user? Also thought experiment." },
      { path: "docs/implemented-plans/narration-mode-design.md", note: "Speculative voice/narration mode for the agent." },
      { path: "docs/plans/pdf-intake-design.md", note: "PDF processing path. Partly implemented." },
      { path: "docs/unimplemented-plans/capture-pipeline-redesign.md", note: "Plan for redoing the capture pipeline. Parked." },
      { path: "docs/activities-design.md", note: "Designed a thing called Activities…" },
      { path: "docs/activities-retrospective.md", note: "…then took it apart. Both docs left as the trail." },
    ],
  },
  {
    title: "Archaeology",
    blurb: "Decisions made, considered, or undone. Worth a glance when you find yourself reopening the same question.",
    entries: [
      { path: "docs/stack-decisions.md", note: "1,186 lines of 'why X and not Y'. Archived so the question doesn't recur." },
      { path: "docs/implemented-plans/state-management-comparison.md", note: "Survey for a decision that turned out not to need making." },
      { path: "docs/photo-storage-investigation.md", note: "Forensic note from when a box got fat. Disk math, recovery options." },
      { path: "docs/triage-design.md", note: "Full triage pipeline design — implemented, still the reference." },
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
      { path: "docs/ideas.md", note: "936-line idea graveyard. The good ones bubble up to actual docs eventually." },
      { path: "docs/plans/cli-restructure.md", note: "Proposed restructure, not yet started." },
    ],
  },
];

// ----- Ring classification -----

export interface RingDef {
  level: number;
  name: string;
  flavour: string;
  trigger: string;
}

export const RING_DEFS: RingDef[] = [
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

export function classifyRings(docs: Map<string, DocInfo>): Map<string, number> {
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

export function classifyPillars(): Map<string, Pillar> {
  const m = new Map<string, Pillar>();
  for (const p of PILLARS) {
    m.set(p.entry, p);
    for (const s of p.supporting) m.set(s.path, p);
  }
  return m;
}
