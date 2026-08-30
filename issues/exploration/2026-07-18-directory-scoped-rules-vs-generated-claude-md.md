---
title: "Can directory-scoped rules replace generated CLAUDE.md / @-includes?"
workstream: unknown
needs: [design]
filed-by: agent
discovered-in: main session — boxholder wondering if per-directory rules could replace generated context
area: beebox
---

Today a box's agent context is assembled by **generating CLAUDE.md** and injecting
**@-includes to compiled briefing files** — every relevant briefing gets pulled into
the *root* CLAUDE.md, so it all loads regardless of where the agent is working. The
question: could we instead lean on **directory-scoped rules** — a CLAUDE.md (or rule
file) that lives *in* the directory it applies to and loads only when an agent works
there — replacing some of the generation, especially for **triage locations** and
similar spot-specific context?

Unknown whether that actually works in our run contexts — that's the thing to
investigate (boxholder: "I'm not sure if that works").

## Where we generate / @-include today

- `src/core/docs-gen/claude-md.ts` — `ensureClaudeMdIncludes(boxRoot, briefingPaths)`
  manages the box CLAUDE.md: adds `@<briefing>` includes for the agent guide + compiled
  briefings, and prunes stale ones. This is the "@-include everything into root" pattern.
- `src/core/docs-gen/compile.ts` — compiles briefings/personalities into markdown / rule
  files that the above @-includes.
- `src/core/docs-gen/triage.ts` — triage-location doc generation (the boxholder's
  motivating case — triage spots have location-specific handling).
- `src/core/box/package.ts:249` — writes `ROOT_CLAUDE_MD` into a new box package.
- Engine side: `beebox/CLAUDE.md:174` uses `@code-style.md` (an @-include of a
  hand-written file — different from the generated-briefing case, but same mechanism).

## The core question (load-bearing, verify first)

Does **Claude Code's native nested-CLAUDE.md discovery** (auto-load CLAUDE.md up the
directory chain from the agent's cwd) actually fire in the way beebox runs the
agent — i.e. through the **Agent SDK's `query()`** with a set cwd (`src/core/agent/`),
not just interactive `claude`? If a CLAUDE.md placed in a triage/landmark subdirectory is
auto-loaded when the agent's cwd is that subdir, then a lot of the compile-and-@-include
machinery could be replaced by simply *placing* directory-scoped context where it applies
and letting discovery do the injection — contextually (only the relevant dir's rules load)
instead of globally (everything @-included into root).

Reasons this might NOT be a clean swap (check each):
- Does the SDK's `query()` do the same CLAUDE.md discovery as interactive Claude Code, and
  from which cwd? Our run contexts differ (landmark-bound sessions run cwd = the landmark
  subdir; wakeup/reactor runs from the box root) — does discovery reach the right files in
  each?
- Boxes deliberately don't inherit the repo CLAUDE.md, and box agent-facing context is
  `briefing` cards, not literal CLAUDE.md. How do briefings map onto (or coexist with)
  directory-scoped CLAUDE.md?
- Is there a newer Claude Code **rules** mechanism (`.claude/rules/`, or settings-based
  path-scoped rules) that's a better fit than nested CLAUDE.md — and does the SDK honor it?
- Generation also does pruning (removes stale briefing includes) and size-linting
  (`src/core/claude-md-lint.ts`) — directory-scoped static files lose the central
  regeneration/GC; is that a feature (less to keep in sync) or a regression (drift)?

## Research (2026-07-18) — verified: directory-scoped context works, two mechanisms

**Answer: yes, it works** — confirmed both by the docs and by a live experiment against the
actual Claude Code agent (planted distinct secret codes in different locations and asked a
headless `claude -p` run which it could see). The SDK path beebox uses is covered
because `settingSources` defaults to loading all sources (we omit it, so `project` — hence
CLAUDE.md, nested memory, and `.claude/rules/` — loads; SDK d.ts: *"When omitted, all sources
are loaded"*, *"Must include 'project' to load CLAUDE.md files"*). Docs:
`code.claude.com/docs/en/memory` + `.../agent-sdk/typescript`.

**Experiment (secrets in root `CLAUDE.md`, `triage/CLAUDE.md`, `.claude/rules/secret.md`):**

| Test | cwd | Action | Agent saw |
|---|---|---|---|
| 1 | root | none | ROOT + RULES — **not** the triage-subdir secret |
| 2 | `triage/` | none | TRIAGE + ROOT (walked up the parent chain) |
| 3 | root | none | ROOT + RULES (unconditional rule, no `paths:`) |
| 4 | root | **read `triage/note.txt`** | ROOT + RULES + **TRIAGE** (subdir loaded on-demand after the read) |

**The mechanics (both verified):**
- **CLAUDE.md** loads by walking **up** cwd→root at startup; a **subdirectory** CLAUDE.md
  (below cwd) loads **lazily — only when the agent reads a file in that subdirectory**, not
  at launch.
- **`.claude/rules/*.md`** loads when `project` settings load. A rule **without** `paths:`
  frontmatter is global; a rule **with** `paths: [glob]` is **path-scoped** — it loads
  on-demand when the agent touches files matching the glob. This is the purpose-built
  "directory/path-based rules" feature.

**What this means for beebox:**
- **Landmark/triage-bound sessions run cwd = the subdir** → a `CLAUDE.md` placed there loads
  automatically at start (it's in the cwd→root chain, per Test 2). **This is a clean fit** —
  location-specific triage/landmark context can live in-place instead of being compiled and
  @-included into the root CLAUDE.md. Strongest win.
- **Wakeup/reactor runs cwd = box root** and works across subdirs → a subdir CLAUDE.md is
  **lazy** (loads only after the agent reads a file there, per Test 4), so it is *not*
  guaranteed in context before the agent acts. For "brief before touching this area," use a
  **path-scoped `.claude/rules/` (with `paths:` globs)** — category-scoped, loads on touch,
  no global @-include needed.

**So the two viable replacements for the generate-and-@-include pipeline:**
1. **Subdirectory `CLAUDE.md`** — for context that should load when the agent is *working in*
   that dir (landmark/triage cwd = the dir). Not a drop-in where context must be present
   before any file is read.
2. **Path-scoped `.claude/rules/*.md`** with `paths:` frontmatter — the real "directory rules"
   feature; scope category briefings by glob, loaded on-demand.

**Caveat (the one real limitation):** subdir CLAUDE.md and path-scoped rules are **lazy** —
they aren't in context until cwd is there (subdir CLAUDE.md at start) or a matching file is
read (on-demand). Anything that must be in context *unconditionally, up front* stays in the
root CLAUDE.md or an unconditional rule. So this replaces *location-specific* briefings, not
*box-global* ones.

## Next step (design)

Triage/landmark locations are the clear first candidate (agent cwd = the location → subdir
CLAUDE.md loads for free). Audit which currently-@-included compiled briefings are
location-specific vs. box-global, move the location-specific ones to per-directory CLAUDE.md
(cwd-bound cases) or path-scoped `.claude/rules/` (glob cases), and retire that slice of the
compile/@-include/prune machinery in `docs-gen/`. Keep box-global briefings in root. Verify
the migrated context actually surfaces in a real reactor/landmark run before removing the
generator paths.
