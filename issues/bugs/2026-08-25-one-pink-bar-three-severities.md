---
title: "One pink bar carries three unrelated severities, and users learn to ignore it in an hour"
workstream: unattached
area: beebox
labels: [journey-findings, ui-sensibility]
filed-by: agent
discovered-by: agent
discovered-in: worktree-user-stories-refresh — journey A, 2026-08-25 walk
priority: important
---

## Recovery assessment (2026-09-21)

The shared error banner remains: `InteractiveChat-layout.tsx:26-44` combines
plain chat and transcription error strings under the same danger styling.
The original first-run navigation error-counter subclaim is outdated:
`AppNav.tsx:239-249` now gates that counter on opening Debug Log, as recorded in
the [closed vocabulary sweep](../closed/bugs/2026-08-08-implementation-vocab-leaks-into-ui.md).
This is not the schedule-alert surface fixed in September. No current browser
comparison of all three severities was performed.


> Recovered 2026-09-21 from `worktree-user-stories-refresh` at `f914fcb4e`.
> The account below describes the 2026-08-25 walk, not a new reproduction.
> Source line numbers in that account are historical. Current disposition is recorded below.


When the box shows me red text, I want its urgency to mean something, so that
when it matters I still look.

Journey A's walker met the same pink error bar three times in one evening, with
three unrelated meanings:

1. **"Claude Code is not logged in — run `claude auth login` on this machine"**
   — the box's AI was unreachable; their message got no answer. Severe, and
   transient — retrying fixed it, which nothing on screen suggested.
2. **"Active connection is not open"** — benign; the reply arrived fine anyway.
3. **"Recording didn't start. Please try again."** — a user-action failure with
   an actual next step, caused by their own misclick.

> "One of those is my problem and two of them aren't, and they look identical.
> That's why I'd stopped reading it."

Learning to ignore the error surface on night one is the worst possible
training. The severities are already distinguishable at the call sites; the
presentation flattens them. A transient that self-healed (2) arguably should
not surface at all once the reply lands — code-style's logging-levels policy
("a degradation that stayed visible" is warn, not error) has no UI counterpart.

Also observed, same family: each of these increments the red nav error counter,
so by evening's end the badge read 3+ with nothing wrong.

Related: [implementation-vocab-leaks-into-ui](../closed/bugs/2026-08-08-implementation-vocab-leaks-into-ui.md)
(the wording of 1); the debug-log badge notes appended there on 2026-08-23.
