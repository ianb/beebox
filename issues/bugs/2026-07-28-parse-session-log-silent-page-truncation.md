---
title: "parseSessionLog silently truncates transcripts at 10,000 entries"
workstream: compacting
area: callback-box
filed-by: agent
discovered-in: worktree-compacting — while designing chat review (docs/implemented-plans/chat-review.md)
---

`parseSessionLog` (`callback-box/src/cli/lib/session.ts:317`) defaults `limit`
to 10,000 (line 322) and slices *after* building the whole filtered array
(line 339). A caller that doesn't pass an explicit `limit` therefore gets only
the first 10,000 entries, with no error and no signal — `hasMore` is returned
but most callers ignore it.

`renderSessionCompact` (`callback-box/src/core/chat/transcript-render.ts`) is
one such caller, so the **retrospective observer silently sees only the first
10,000 entries** of any longer transcript. Nothing in the corpus measured on
2026-07-28 was that long (the largest rendered to ~642k chars), so this is
latent rather than active — but it is a silent-truncation bug, which the
resilient-AND-never-silent principle rules out.

Chat review works around it by passing an explicit `limit` and asserting
`entries.length === total`. That's a per-caller fix; the underlying default is
still a trap for the next caller.

Options, unsettled:

- Make `limit` required (breaks every call site, but the compiler finds them).
- Default to unlimited and make pagination opt-in — arguably the right default,
  since "parse this log" wanting all of it is the common case.
- Keep the default but throw when `total > limit` and the caller didn't ask for
  a page.

Not fixed inline while designing chat review because changing the default would
alter retro's behaviour on long transcripts without a test covering it, and the
render split that surfaced this was deliberately kept byte-identical for its
existing caller.

## Update 2026-08-01 — the default is gone, the truncation isn't

Track A of `docs/plans/chat-history-oom-mobile-lock.md` took option 1: the
`limit` default is gone, `parseSessionLog` now requires an explicit bounded
slice (`{ mode: "tail", ... }` or `{ mode: "page", ... }`), and the compiler
found every call site. So the *trap* — a caller silently inheriting a page
size it never asked for — no longer exists.

What remains is the honest half of this issue — first-page reads that stop at
`MAX_SESSION_ENTRIES` (5 000) rather than 10 000, and say nothing when a
transcript is longer:

- `core/chat/transcript-render.ts` `renderSessionCompact` (silent).
- `core/retro/discovery.ts` `countUserMessages` — only feeds "enough human
  turns to observe?" thresholds, so the cap is harmless there, but it is still
  a first-page read (silent).
- `dev/lib/test-runner.ts` `extractBehavior` — knowledge-audit behavior
  extraction over the main log and each sub-agent log (silent); an audit of a
  5 000+-entry run would miss later tool use.
- `cli/commands/session.ts` (plain `cb session <id>`) now *prints* a note when
  it truncates, and `cb session --since` was switched to a tail read (it wants
  the recent end, not the first page) — those two are no longer silent.

Chat review's variant of the same problem is filed separately as
`issues/bugs/2026-08-01-chat-review-capped-at-max-session-entries.md`.

## Update 2026-08-06 — material readers now announce truncation

Commit `dfaf9fd0` makes the two material first-page readers announce when the
exact transcript total exceeds the retained entries:

- `renderSessionCompact` warns that it renders only the first page.
- `extractBehavior` warns for both the main session log and every truncated
  subagent log.

Focused doctests cover quiet short reads and visible over-cap reads. The issue
stays open for `countUserMessages`. That read remains silent, but its cap only
affects the retrospective eligibility threshold and does not omit material from
an observation.
