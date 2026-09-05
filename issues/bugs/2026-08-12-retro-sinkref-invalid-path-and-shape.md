---
title: "Retro scan emits an impossible sinkRef, and sink/sinkRef should nest like `learning`"
workstream: unattached
area: beebox
needs: [design]
labels: [retro, vocabulary]
filed-by: agent
discovered-by: agent
discovered-in: main session — bbx feedback triage from a real box
priority: important
---

Two related problems in how a retrospective observation names where its learning
belongs.

## 1. The bug: an unreachable sinkRef discards learnings

A retro scan produced `sinkRef: config/procedures/build-course.guide.card` for
three observations. Guide cards live at `config/<domain>.guide.card` — never
under `config/procedures/` — so that path can't exist, and no guide card covered
the domain those observations were about. The integrate step had four real
candidate guides and none fit, so rather than force a domain mismatch it dropped
all three and filed feedback.

**Three learnings were discarded.** That's the cost: the retro pipeline exists to
make beliefs durable, and a malformed sink silently sends them nowhere.

Two fixes, only one of which is engine work:

- **Constrain the observer** so `sinkRef` can only be an existing guide card path
  or absent. `src/core/retro/observations.ts:39` types it as a bare optional
  string with a `describe()` telling the model the convention — which the model
  did not follow. A prompt that can emit an impossible value will eventually
  emit one; validate against the real candidate set instead.
- **Create the missing guide** so the domain has a home. That's box content and
  the boxholder's call, not a code change — and it doesn't fix the general case.

Also decide what integrate should do with an unresolvable observation. Dropping
it silently (beyond the feedback note) is the current behavior and it loses
work; parking it for review would not.

## 2. The shape: two vocabularies for one idea

The same concept — *what did we learn, and where does it go* — has two shapes:

| | Retro observation (`retro/observations.ts`) | Question learning (`question-followup-job.ts`) |
|---|---|---|
| shape | flat siblings | nested object |
| fields | `proposal`, `sink`, `sinkRef` | `learning: { sink, ref, proposal }` |

Identical trio, two spellings. Retro should nest to match — `sink: { ref }` or
the `learning`-shaped equivalent — so one vocabulary covers both subsystems.

Worth checking before doing it: observations are the observer's **structured
output schema**, so changing the shape changes an LLM output contract and the
observer prompt, not just field names. `src/core/retro/report.ts:85` reads
`obs.sinkRef`. And confirm whether observations are persisted in retro run state
— if they are, this needs a migration rather than a rename.
