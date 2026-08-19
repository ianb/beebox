---
name: user-copy
description: How to write any text a person will read in the product — error messages, empty states, button labels, banners, notifications, confirmations, status lines, CLI output. Use whenever you are about to add or change a user-visible string, and when reviewing a diff that contains one. Not for docs, issues, or commit messages; not for the box agent's chat prose.
---

# Writing user-facing copy

Every string here is read by someone mid-task, usually at the moment something
went wrong. They want to know **what happened, what it means for them, and what
to do** — in that order, in as few words as carry it.

Six rules. Each one is here because we shipped its opposite.

## 1. Say what is true about the system, not what is convenient about the check that failed

A crashed worktree answered API clients with `{"error": "owner-session-required"}`
— technically the reason that gate returned 401, and a claim about *the caller*
when the truth was *a dead process*. It sent debugging toward sessions and
credentials for half an hour.

If the honest answer is "something on our side is down," say that. A message
that describes the code path rather than the situation is worse than no message,
because it is confidently wrong.

## 2. Name the scope

> ~~No recording is cached for the last message~~
> **No recording is cached for this message** … other messages in this
> conversation may still have audio.

The first says "last" when a *specific* message was asked for, and reads as "this
doesn't work here." An agent that believed it stopped trying for the rest of the
conversation. Say whether a failure is about this one thing or the whole
capability — the reader cannot tell, and will guess wrong.

## 3. Don't discard the cause you already have

Codex reports quota exhaustion as `You've hit your usage limit … try again at
<time>` — a precise reason with a reset time. We surfaced
`exited with code 1: Reading prompt from stdin...` and threw the rest away.

Before writing a generic failure string, check whether the real cause is in your
hand. Passing through a good upstream message beats authoring a vague one.

## 4. Don't promise what you can't keep

> ~~Still sending — try again in a moment.~~

True when the send is in flight; a lie when the lock can stay stuck across app
restarts. If you cannot guarantee the timeframe, don't state one, and give the
reader an actual exit instead.

## 5. Use the reader's words, not the implementation's

`Name.type.card` as a heading, "landmark," "person card," "boxholder" — all
shipped, all fixed or filed
(`issues/bugs/2026-08-08-implementation-vocab-leaks-into-ui.md`). The test: would
this word exist if the code had been written differently? Then it is ours, not
theirs.

## 6. Absence of a signal is not assurance

If something reports confidence, freshness, or verification, say plainly what
*not* seeing it means. Unmarked text can still be wrong; a check that didn't run
is not a check that passed. Silence reads as "fine" unless you say otherwise.

## Shape

- Sentence case. No exclamation marks. No "please," no apology, no "Oops."
- Don't blame the reader — "that file is too large" over "you uploaded too
  much."
- Lead with the thing that happened, not with the subsystem it happened in.
- One idea per string. If it needs a second sentence, that second sentence is
  what to do next.
- Prefer the plain word: *stopped* over *terminated*, *couldn't reach* over
  *connection refused* — unless the technical term is the one the reader
  already uses.

## The check before you commit it

Read it aloud as if saying it to the person. If it sounds like a system
describing itself, rewrite it. If it would make them ask "…so what do I do?",
it is not finished.

And if the honest message is bleak — the work is gone, we can't tell what
happened — say that plainly. False reassurance costs more than bad news.
