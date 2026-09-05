# Migration: question card lifecycle cleanup

`scripts/migrate/question-lifecycle.ts` is the pure per-card transform behind
the `question-lifecycle` migration (Track A,
`docs/implemented-plans/questions-end-to-end.md`): strip `answered-by:`, backfill
`asked-at:` on pending cards, relocate stray question cards into
`box/questions/` with a `context:` ref back to their original scope, fix
retired `<agent-needs-to-know>` directive references, and report (never
silently fix) a `select` question with fewer than two options. The CLI
driver (`question-lifecycle-run.ts`) resolves git dates, destination names,
and scope refs and passes them in as plain data — that's what this doctest
exercises directly.

```ts setup
import { migrateQuestionCard } from "../../../scripts/migrate/question-lifecycle.js";

const FALLBACK = "2026-07-10T09:00:00-07:00";
const GIT_DATE = "2026-04-28T21:47:22-05:00";
```

## A canonical card with `answered-by` and no `asked-at`: strip + backfill from git date

```ts
const canonical = `---
status: pending
memo: A retrospective review noticed a pattern.
prompt: Should I note this in the briefing?
input:
  type: confirm
answered-by: retrospective
directive: If yes, add to the briefing card's <agent-needs-to-know> that the pattern holds.
---
`;

migrateQuestionCard({
  relPath: "box/questions/Pattern.question.card",
  raw: canonical,
  destRelPath: "box/questions/Pattern.question.card",
  gitAddDate: GIT_DATE,
  fallbackAskedAt: FALLBACK,
  scopeRef: "",
})
=>
{
  "changed": true,
  "content": "---\nstatus: pending\nmemo: A retrospective review noticed a pattern.\nprompt: Should I note this in the briefing?\ninput:\n  type: confirm\ndirective: If yes, add to the briefing card's {% correction %} block that the\n  pattern holds.\nasked-at: 2026-04-28T21:47:22-05:00\n---\n",
  "newRelPath": "box/questions/Pattern.question.card",
  "relocated": false,
  "strippedAnsweredBy": true,
  "backfilledAskedAt": true,
  "usedFallbackAskedAt": false,
  "fixedDirectiveTag": true,
  "addedContext": false,
  "selectOptionsViolation": false,
  "skippedReason": null
}
```

## An already-clean canonical card is a no-op (idempotent)

```ts
const clean = `---
status: answered
prompt: Already answered.
input:
  type: text
asked-at: 2026-01-01T00:00:00-05:00
answer:
  text: yes
answered-at: 2026-01-02T00:00:00-05:00
answered-via: web
---
`;

migrateQuestionCard({
  relPath: "box/questions/Done.question.card",
  raw: clean,
  destRelPath: "box/questions/Done.question.card",
  gitAddDate: null,
  fallbackAskedAt: FALLBACK,
  scopeRef: "",
}).changed
=> false
```

## No git history falls back to the caller-supplied "now", and is reported

```ts
const noHistory = `---
status: pending
prompt: New card, no git history yet.
input:
  type: text
---
`;

const result = migrateQuestionCard({
  relPath: "box/questions/Fresh.question.card",
  raw: noHistory,
  destRelPath: "box/questions/Fresh.question.card",
  gitAddDate: null,
  fallbackAskedAt: FALLBACK,
  scopeRef: "",
});
JSON.stringify({ backfilledAskedAt: result.backfilledAskedAt, usedFallbackAskedAt: result.usedFallbackAskedAt })
=> {"backfilledAskedAt":true,"usedFallbackAskedAt":true}

result.content.includes("asked-at: 2026-07-10T09:00:00-07:00")
=> true
```

## A stray card outside `box/questions/` relocates and gains a `context:` ref when it references its own scope

```ts
const stray = `---
status: pending
prompt: What is unsure-008.jpg? (photo, back-of-photo, or trash)
input:
  type: text
directive: If a photo, create an image card. Otherwise delete box/inbox/scan-x.attach/unsure-008.jpg.
---
`;

const relocated = migrateQuestionCard({
  relPath: "box/inbox/scan-x.attach/unsure-008.question.card",
  raw: stray,
  destRelPath: "box/questions/scan-x_unsure-008.question.card",
  gitAddDate: GIT_DATE,
  fallbackAskedAt: FALLBACK,
  scopeRef: "box/inbox/scan-x.capture-session.card",
});
JSON.stringify({ relocated: relocated.relocated, newRelPath: relocated.newRelPath, addedContext: relocated.addedContext })
=> {"relocated":true,"newRelPath":"box/questions/scan-x_unsure-008.question.card","addedContext":true}

relocated.content.includes("ref: box/inbox/scan-x.capture-session.card")
=> true
```

## A stray card with no sibling-scope reference still relocates, but gets no `context:` ref

```ts
const strayNoSiblingRef = `---
status: pending
prompt: Generic question with nothing pointing back at its own directory.
input:
  type: text
---
`;

migrateQuestionCard({
  relPath: "box/inbox/scan-y.attach/loose.question.card",
  raw: strayNoSiblingRef,
  destRelPath: "box/questions/scan-y_loose.question.card",
  gitAddDate: GIT_DATE,
  fallbackAskedAt: FALLBACK,
  scopeRef: "box/inbox/scan-y.capture-session.card",
}).addedContext
=> false
```

## A `select` question with fewer than two options is reported, never auto-fixed

```ts
const badSelect = `---
status: pending
prompt: Pick one.
input:
  type: select
  options:
    - id: a
      label: Only option
---
`;

const violation = migrateQuestionCard({
  relPath: "box/questions/Bad.question.card",
  raw: badSelect,
  destRelPath: "box/questions/Bad.question.card",
  gitAddDate: GIT_DATE,
  fallbackAskedAt: FALLBACK,
  scopeRef: "",
});
violation.selectOptionsViolation
=> true

violation.content.includes("options:\n    - id: a\n      label: Only option\n")
=> true
```

## A card with no frontmatter block is left untouched and the reason is surfaced

```ts
migrateQuestionCard({
  relPath: "box/questions/Broken.question.card",
  raw: "not a card at all",
  destRelPath: "box/questions/Broken.question.card",
  gitAddDate: null,
  fallbackAskedAt: FALLBACK,
  scopeRef: "",
}).skippedReason
=> no frontmatter block
```
