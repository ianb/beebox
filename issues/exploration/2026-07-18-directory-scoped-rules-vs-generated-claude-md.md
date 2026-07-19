---
title: "Can directory-scoped rules replace generated CLAUDE.md / @-includes?"
needs: [design]
filed-by: agent
discovered-in: main session — boxholder wondering if per-directory rules could replace generated context
area: callback-box
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
- Engine side: `callback-box/CLAUDE.md:174` uses `@code-style.md` (an @-include of a
  hand-written file — different from the generated-briefing case, but same mechanism).

## The core question (load-bearing, verify first)

Does **Claude Code's native nested-CLAUDE.md discovery** (auto-load CLAUDE.md up the
directory chain from the agent's cwd) actually fire in the way callback-box runs the
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

## Research (incomplete)

Determine empirically: (1) whether `query()` auto-loads nested CLAUDE.md / rules from a
given cwd; (2) for which of our run contexts (landmark, wakeup/reactor, triage) that
reaches the right directory; (3) which currently-@-included briefings are location-specific
(good candidates to move to directory-scoped files) vs. genuinely box-global (stay in root).
Then decide which parts of the generate-and-@-include pipeline can be retired in favor of
placing context per-directory. Note: even a partial win (triage locations only) may be worth
it if it removes compile/prune machinery there.
