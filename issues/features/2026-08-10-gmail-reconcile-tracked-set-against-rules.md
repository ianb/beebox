---
title: "No way to find tracked Gmail threads that no longer match any rule"
workstream: box-family-email
area: callback-box
filed-by: agent
discovered-in: worktree-box-family-email — after a boxholder narrowed their Gmail rules
needs: [design]
---

> **When I realize my email rules were wrong and fix them, I want to see which
> already-tracked threads the new rules would never have pulled, so I can decide
> what to remove without auditing hundreds of cards by hand.**

Changing `config/connectors/gmail.json` changes what gets tracked *next*. It
says nothing about what is already tracked. There is no supported way to ask
"which of my tracked threads no longer match anything?"

`cb connector gmail` offers `track <thread-id>`, `pending [rule]` and `gws`.
Nothing enumerates the tracked set, and nothing evaluates it against the current
rules. `findTrackedGmailThreads` (`src/connectors/gmail-tracking.ts`) already
builds exactly the registry such a command needs — every live
`*.email-thread.card` indexed by thread id — and `matchesRule`
(`src/connectors/gmail-rules.ts`) already answers match/no-match/unevaluated for
a thread against a rule. The pieces exist; nothing joins them in that direction.

Concretely: a box narrowed its rules from an effective whole-inbox import to
three labels. 508 of its 530 tracked threads carry none of those labels. There
is no command that will tell them that, and no command that acts on it.

## This must not become automatic GC

The obvious-looking fix is the one that was deliberately removed.
`gmail-gc.ts` did automatic deletion of unlabeled cards and was deleted by
`ba3bf436`; its plan
([gmail-gc-unlabeled](../../callback-box/docs/implemented-plans/gmail-gc-unlabeled.md))
is marked superseded, and the config parser now warns that `gc` settings are
obsolete because "card deletion now controls untracking". The current model is
deliberate: the card set *is* the registry, and a card can carry box work that
has nothing to do with whether its Gmail labels still match.

So the deliverable is a **report**, not a sweep. Something like
`cb connector gmail orphans` — read-only, lists tracked threads matching no
rule, with enough per-thread detail (age, message count, whether anything else
in the box references the card) for a human or agent to decide. Deletion stays
the existing manual gesture.

## Open questions

- Should it flag threads a rule *would* have matched but that arrived before the
  rule existed? That is a different question from "matches nothing", and
  probably a different command.
- `matchesRule` costs a Gmail API call per thread per rule. Over a large tracked
  set that is slow and quota-hungry. Can label-only rules be evaluated against
  the card's own stored `labels:` field without calling Gmail at all? That
  covers the common case cheaply and would make the report usable on a box with
  hundreds of threads.
- Should this surface as a health check rather than (or as well as) a command —
  "N tracked threads match no current rule"? That fits engineering principle 4,
  but it would sit warning indefinitely on a box whose owner has decided to keep
  them, so it needs an acknowledge path. Compare
  [box-growth-warning-cannot-clear](../bugs/2026-08-10-box-growth-warning-cannot-clear.md),
  which is the failure mode to avoid.
