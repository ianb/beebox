---
title: "A generic `{% trigger %}`: programmatic scope, natural-language condition, one batched confirm"
workstream: unattached
area: beebox
needs: [design]
filed-by: agent
discovered-by: Ian
discovered-in: main — designing out from the to-do blocked-state question
---

Natural-language conditions are wanted, not avoided. The objection is only to
free text that something must re-read on a schedule to decide whether it fired.
A two-stage filter removes that objection, and it generalizes past to-dos.

The sketch: a `{% trigger %}` tag placeable on any card, carrying a
**programmatic condition** that scopes when it is even a candidate, an optional
**natural-language condition** that decides whether it really fired, and a
**natural-language action**. On wakeup, the programmatic stage runs
deterministically over what changed. The candidates it yields go into **one**
agent call carrying their natural-language conditions: which of these actually
fired, given what happened? Confirmed ones then run individually with their
context.

See [the to-do blocked-state issue](../features/2026-09-15-todos-have-no-blocked-state-or-non-date-triggers.md),
which asks what a trigger may be made of. This is a candidate answer, and a much
wider one: `start`/`due` become one currency of a general mechanism, a blocked
to-do becomes a trigger on that to-do, and "re-examine this when X" stops being
a per-feature invention.

## What is right about it

**The two-stage filter is the spine.** The cheap deterministic stage bounds the
expensive judgment stage, so agent cost is proportional to candidates rather
than to how many triggers exist in the box. That is also what answers the
original objection: free text is read, but only about things the machine
already narrowed to.

**Batching the confirm into one call is the economic move.** One call per
wakeup, not one per trigger.

**Skip the call entirely at zero candidates.** `todo-review`'s sweep is the
precedent: when all its lists are empty it injects nothing at all — no job
card, no output. A trigger pass with no candidates must cost nothing.

## Where the design should push back on itself

**`(every "1 week")` is a schedule wearing a trigger's clothes.** It is the one
part needing per-trigger state, and it duplicates the scheduler. The pattern it
expresses is real and already argued for elsewhere — *react to the event, but
check at least this often* — so it should be a named field, say
`at-least-every`, rather than a stateful term inside the condition language.
Same expressive power; the language stays pure; the staleness floor gets a name
instead of hiding inside an `or`.

State then reduces to one last-fired timestamp per trigger, which needs stable
trigger identity. Card path plus position is not stable across edits. An
explicit `id` is — the `{% todo %}` precedent — which gives a clean rule: a
trigger with a floor needs an `id`; one without can stay anonymous. Sidecar
state under `.beebox/` follows the todo sweep and the questions latch, and
avoids a card mutation on every fire.

**"Maybe a full language with conditionals" is the overdesign risk.** The test
to apply is not "what can it express" but **"can it explain why it did not
fire?"** A flat AND/OR over a closed predicate set (a card matching a glob
changed, a card of a type appeared, a field reached a value, a date passed) can
be explained to the boxholder line by line. A program with conditionals and
variables cannot, and it needs debugging, testing, and error surfacing of its
own. Start with the filter; earn the language.

**One call over unrelated conditions can blur them.** Asking a single agent
"which of these twelve fired?" invites joint reasoning, where a vivid candidate
drags its neighbours along. The call should be a classification with one
independent verdict per `id` and the evidence it rested on, not a free-form
selection — the event digest supplied once, each condition judged on its own.

**Grouping is about action, not evaluation.** The batched confirm already
groups for evaluation, for free. The interesting case is several triggers
firing at once and wanting *one* agent run that sees all of them, so it can
judge them together. That is worth having, but a group card is a new concept
with its own lifecycle; a `group` string attribute buys the same batching. The
honest argument for a card is shared *context* — a place to write how to think
about that whole category — so promote to a card when there is prose to put in
it, not before.

**Do triggers actually arrive in clumps?** Probably not in the steady state.
Clumping is driven by the event, not by the triggers: an ordinary wakeup
ingesting one email makes candidates of the few triggers scoped to it, while a
wakeup after a large import or a week away makes many. So the distribution is
bursty and correlated with input volume. If that holds, grouping earns its
keep in the catch-up case and not the daily one — an argument for building it
second.

## Questions

1. Is `at-least-every` enough to retire stateful terms from the condition
   language entirely?
2. What is the minimum predicate set, and does it need anything beyond "a card
   matching this glob changed"?
3. Does a fired trigger act directly, or raise a proposal? To-dos already have
   a standing rule that agents raise and the boxholder decides; a trigger whose
   action is natural-language instruction is a way around it.
4. What does a trigger that never fires look like from the outside, and how
   does the boxholder find one that is silently broken?
5. Does the action need its own result, or is "the agent did something" enough?
