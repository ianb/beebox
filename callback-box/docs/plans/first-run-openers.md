---
title: First-run openers
status: active
workstream: first-run-openers
issues: []
---

# First-run openers

## Problem

A fresh box opens on an empty chat that says "Start a conversation with your
box assistant." The only card about the *person* is the root briefing, whose
body is the stub `{% purpose %}What this box is for.{% /purpose %}`. The
first move sits entirely on the person at the moment they know least.

## Decisions (settled with the boxholder)

- **Suggested opening questions, not a seeded agent turn.** A seeded turn
  fires in the flakiest moment the system has (first-send receipt race,
  `issues/bugs/2026-08-04-chat-send-receipts-fail-often-message-actually-sent.md`).
- **Clicking an opener sends it** through the same path as typing + enter.
- **Openers are briefing content, owned by the agent.** They live in the
  briefing card frontmatter as `openers:` — a list of strings — following
  the schema's own rule (records in frontmatter, free text in body). The
  briefing is already `@`-included into CLAUDE.md, so the agent sees what it
  is currently suggesting on every turn. When the list is empty or absent,
  the chat falls back to today's plain line. No onboarding flag, no
  stock-hash check in the chat path.
- **Lookup is per directory.** A chat is bound to a landmark directory; the
  openers shown are those in *that* directory's `briefing.briefing.card`
  (root chat → root briefing). An established box shows whatever the agent
  left there — usually nothing. That is the "established box" condition;
  no code condition is needed.
- **Two stock openers**, phrased from the person's side so the agent is never
  asked something it cannot answer yet:
  1. "Let me tell you what this box is for."
  2. "What can you do?"
- **Curation rides `process-retrospective`** as a third step, `openers`,
  with its own precheck. Not a new schedule.

## Changes

### 1. `openers:` frontmatter field

- `BriefingSchema` gains `openers: z.array(z.string()).optional()`.
- `compileBriefing` emits each as a `**Opener:** …` line alongside the
  key-people/properties records.
- The card viewer's field table renders frontmatter already; no new
  frontend component.

### 2. Stock briefing template + rollout

`createBriefingTemplate()` gains the two stock openers. Register the current
stock hash as a `priorStockHashes` entry (pattern: `TEMPLATE_STOCK_HASHES` in
`src/core/box/templates.ts`) so untouched-stock briefings take the update and
edited ones park as usual.

### 3. Schema `instructions` (briefing)

State plainly: openers are the agent's to maintain; they are suggestions
shown on an empty chat for the directory; rewrite them as the box's use
becomes clear, toward things the person has not yet tried; remove them when
the box is in regular use — an empty set is the normal end state, not a
regression. When the purpose is still the stock stub and the person says
"let me tell you what this box is for", ask, then write the answer into
`{% purpose %}`.

### 4. Retro procedure: `openers` step

`templates/procedures/process-retrospective.procedure.card`, new step after
`integrate`:

- precheck: `CHECK_SKIP` unless the root briefing (or any directory briefing)
  has a non-empty `openers:` AND `cb retro status --check` reported sessions this
  run (reuse scan's signal; the step can key off the same run report).
  Print the briefing(s) with openers, the capability summary from the agent
  guide, and recent session titles.
- run: one agent prompt — rewrite the `openers:` list only; keep them short; prefer
  next-step suggestions grounded in what the person has done; drop openers
  the person has plainly outgrown; remove all when the box is in regular use.
- The integrate step's "NEVER edit the briefing body" rule gets a one-line
  carve-out naming the `openers:` frontmatter field as the exception (they are hints, not
  beliefs, and are not subject to the evidence model).

### 5. Backend query

`chat.openers` (tRPC, `src/webapp/trpc/routers/chat.ts`), input
`{ contextDir?: string }`: read that directory's briefing card (root when
unset), return its frontmatter `{ openers: string[] }`. Missing briefing or
empty list → `[]`.

### 6. Empty-chat state

`InteractiveChat-messages.tsx` `messages.length === 0 && !isStreaming`
branch: when `openers` is non-empty render them as buttons above the
existing line; click → the existing `send` path. Only for `"new"` sessions
(an existing session with zero messages is a different state).

### 7. `cb init` closing line

`src/cli/commands/init.ts:240` — replace "Run 'cb status' to see the current
state." with the URL to open (the setup link is printed by the server; point
at `cb serve` / the box URL as appropriate).

## Tests

- `test/schemas/briefing-compile.doctest.md` — opener emission.
- Unit test for the opener extraction used by `chat.openers`.
- Frontend: empty-state renders openers and a click sends the text.

## Out of scope

A wizard; any "onboarding complete" state; connector-setup openers (they
dead-end on secrets).
