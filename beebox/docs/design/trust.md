# Trust and authorization

## Paperwork lives on as schema process-fields

The early design wanted every outbound action to carry "paperwork" — impact,
confirmation of user intent, risk. Command cards (which carried explicit
authorization fields) are gone, but **the idea did not die** (ruling 9): it
lives in the schemas. Schemas include fields that must be filled in **not
because they are essential information, but because filling them is essential
process** — deliberation the agent is forced through before the artifact is
valid. A question card's `memo` (why am I asking?) and `directive` (what
happens with the answer?) are the pattern; new action-shaped schemas should
use it. (2026-10: both fields are optional in `src/schemas/question.ts`, so
the question card states the pattern but does not enforce it; a new schema
that wants the deliberation should make its fields required.) The rest of the trust surface is the question/confirm gates and the
commit history (`durability-and-provenance.md`).

## Trust progression: question → confirmation → automatic

The system's relationship with the user evolves (design intent, correct but
**not well filled out in the implementation** — ruling 10):

1. **Question** — "what should I do with this?" No idea; need guidance.
2. **Confirmation** — "I think I should do X. OK?" Have an idea; need approval.
3. **Automatic** — just do it. Confident, trusted pattern.

Transitions happen through answers that teach: a one-time "yes, send it," a
"yes, and don't ask again for this sender" escalation, or an explicit standing
instruction. Learned trust gets recorded in rules/guide material so the
escalation persists. (Shipped 2026-07: a question's `learning:` field names
a guide, briefing, or personality sink, and the follow-up job records the
answer there as a `basis: user-stated` belief — [`../questions.md`](../questions.md).) Keep this as the umbrella principle when building
approval flows; it is design to fill, not history.

## The confidence vocabularies

Three scales answer "how sure/authorized is the agent," each domain-specific:

- **Trust progression** (above) — permission to act.
- **Triage confidence** — confident / probable / guess; classification
  certainty, gating whether an item files silently or raises a question
  ([`../triage.md`](../triage.md)).
- **Retro belief confidence** — hypothesis / low / medium by recurrence;
  how firmly an inferred belief is held (`../glossary.md`, retrospective).

(2026-10: the three above are not the complete set. Other shipped scales:
belief basis `user-stated > feedback > inferred > default`; guide confidence
`confirmed|high|medium|low|hypothesis`, with `hypothesis` excluded from
compiled guidance; progress evidence `observed|inferred|self-report`, with no
level recorded without evidence (`src/schemas/progress.ts`); procedure-run
outcome `completed|failed|inconclusive` (`src/schemas/procedure-run.ts`);
question states `pending|answered|dismissed|expired`; notification loudness
`dot|quiet|loud` (`src/core/notification/intent.ts`).)

No ruling unifies them; treat them as instances of one instinct (act only with
warrant proportional to certainty) with deliberately separate vocabularies
until a real need forces a merge.
