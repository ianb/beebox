---
title: "Small structured-output agent passes load the full box CLAUDE.md + agent guide"
workstream: model-engine-policy
resolution: implemented
area: callback-box
filed-by: agent
discovered-in: worktree-path-handling-model — tracing which agent types receive the ref-path guidance (Track E of docs/implemented-plans/box-root-paths.md)
---

**Resolved 2026-08-26** by `docs/implemented-plans/model-engine-policy.md` (Track H, commit `d0dbbd1c0`): triage, chat review, retro observer, and the procedure judge now opt out of `loadBoxContext`, so the four structured passes stop loading the box's ~9,700-word agent context. The retro observer is flagged in code as the one worth watching if observation quality drops.

While verifying that the box-root link rule reaches every agent surface, the
prompt-flow trace found that the *small* structured-output passes — triage
(`src/core/triage/index.ts`), chat review (`src/core/chat/review/reviewer.ts`),
retro observer (`src/core/retro/observer.ts`), procedure judge
(`src/core/procedure/engine-validate-model.ts`) — all run through the shared
SDK invoke path (`src/core/agent/stream.ts`) with `cwd = boxRoot` and no
`settingSources` override. The SDK default loads project settings, so each of
these passes silently pulls the full box CLAUDE.md → `agent-guide.md` → rules
into context on every invocation.

For the full agents (reactor, procedure runs, chat) that's the intended
design. For a judge emitting a yes/no or a reviewer emitting a title +
summary, it's likely pure token cost — none of them need the cards guide.

Tension: is the context inheritance intended anywhere in this set (e.g. does
the reviewer benefit from box vocabulary?), or should these call sites set
`settingSources: []` (or a neutral `cwd`)? Needs a per-call-site look, not a
blanket change — and `pnpm agent-context` is the tool for checking what each
surface actually receives.
