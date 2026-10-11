---
title: "Remove Telegram: plan review record"
status: draft
workstream: plugins-planning
issues: []
---
# Plan review — remove Telegram

Cross-model plan review by codex gpt-6-sol, 2026-10-11, prompt
`scratch/cross-model/remove-telegram.plan.prompt.md`. Seven findings.

## Findings and adjudication

### The "loud loss" claim was wrong
Pending-question alerts return before `notifyBoxholder` when no channel is
configured, so nothing is logged and the no-channel health check cannot
count it. **Accepted:** the Design section now says the loss is quiet for
that path and why it is accepted (no box is in that state; the
notifications issue owns the design).

### Track 2's state files have another reader
The retrospective walker reads both session registries to attribute old
transcripts. **Accepted:** the reader stays with a comment; the plan's
"inert" claim is corrected. The reviewer's advice to ship Track 1 alone and
assess Track 2 separately was put to the boxholder, who chose Track 2 in.

### Shrinking `CHANNELS` changes how old logs are read
`z.enum(CHANNELS)` would skip every historical `telegram` delivery line
with a warning on each read. **Accepted:** the read schema accepts
`RETIRED_CHANNELS`; live sends stay two-channel; a doctest case is added.

### `chat-thread` needs an archive-only contract
Its instructions still tell an agent to reply and expect delivery, and the
chat guide seed advertises `chat-job`. **Accepted:** the instructions
become two lines (history; do not append), and the unused `chat` guide
seed is deleted (no box installs it).

### A stray machine secret keeps looking like an ordinary grant
**Accepted as a documented risk:** the production store was listed by name
and holds no Telegram entry; the failure-modes row now says what a stray
one would look like and that forgetting a value is the boxholder's call.

### The config-key contingency was already decidable
**Accepted:** the row now states that unread keys are ignored by the
per-field parser.

### The prose inventory undercounted
Fifteen site pages, not ten; the dev doc graph links the deleted connector
doc. **Accepted:** the site pages are classified (two deleted, twelve
edited or kept) and the doc-graph link is in Track 1.

## Reviewer's single most important change
Ship Track 1 first and assess Track 2 separately. Put to the boxholder as
the plan's one open question; decided in, with the retro reader kept.
