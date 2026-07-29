---
title: "parseSessionLog silently truncates transcripts at 10,000 entries"
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
