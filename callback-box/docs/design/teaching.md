# Teaching — how the system learns what to do

The connectors and processing loop are machinery; the user has to tell the
system what to do, correct it, and get its ideas surfaced back. The system
should feel like something you're **teaching, not configuring** — that framing
is current. Scope check (ruling 11): this area is more ambition than reality,
still important, but **not central** — don't let it crowd out the working
system when prioritizing.

## What shipped of it

The teaching relationship exists, through a different stack than the original
design guessed:

- **Personality/guide cards** holding `source: inferred` beliefs.
- **The retro procedure** (`cb retro`): mines recent chat sessions for what
  the boxholder implicitly taught, integrates it as beliefs with
  recurrence-based confidence, and turns authoritative changes into question
  cards (`../implemented-plans/box-retrospectives.md`).
- **Briefing cards** — per-directory agent context.
- **Category rules on landmark cards** — triage corrections accrete as prose
  rules at the destination ([`../triage.md`](../triage.md)).

The original §23 "meta-processes (future)" — behavior review, instruction
distillation — is **implemented** as the retro system.

## What remains aspiration

- **Proposals** — the system creating "I think we should do X" artifacts and
  waiting for buy-in. No proposal-card schema exists; the closest living path
  is a retro-generated question card. Proactive suggestion ("you have three
  meetings tomorrow and no prep time — want me to block some?") is wanted
  (see `interaction-model.md` on proactivity) but not built.
- **Feedback loops from edits** — user modifies a draft, system learns tone.
  Retro covers the chat-visible slice of this; nothing systematic beyond it.

The goal stands: better at knowing what you want in familiar territory, better
questions in unfamiliar territory. This is where the personality of a box
lives — what makes it *yours* rather than generic automation.
