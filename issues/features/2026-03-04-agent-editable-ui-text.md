---
title: "Agent-editable UI text"
workstream: unknown
area: beebox
needs: [decision, design]
---

The feedback confirmation messages ("Got it, I'll keep that in mind") feel like they come from a service, but they're actually queuing work for the agent. The agent can't directly respond in real-time, but it could edit a "translation file" of UI phrases to make them sound more like its own voice. This would let the agent personalize how the system communicates, even in places where it can't respond dynamically.

## Shape, if we do it: box self-localization (2026-07-19)

Boxholder's framing: **don't invent a bespoke "phrase file" — make it a
localization layer the box can override.** The box self-localizes; agent voice is
just one use of the same mechanism.

That's a better shape than an ad-hoc phrase list for several reasons:

- **It's a solved pattern.** Keyed message catalog, interpolation placeholders,
  a fallback chain (box override → shipped default). We don't design a new
  concept, and a missing/malformed override degrades to the default rather than
  producing a blank UI.
- **It bounds what the agent can change** to strings, not logic or markup — a
  much safer edit surface than "let the agent touch the frontend."
- **It leaves room for actual localization later** (real languages) without a
  second mechanism, if that ever matters.
- **The override is data**, so it travels with the box, diffs in git, and can be
  reviewed/reverted like any other card or config.

### The real cost — and the reason for the ambivalence

**There is no string externalization today.** The frontend has no i18n layer at
all; every user-facing string is inline in JSX across `src/frontend/src/`. So the
prerequisite isn't the override mechanism (that part is small) — it's extracting
every UI string into a keyed catalog and rewriting the call sites. That's a large
mechanical change touching most components, and it's a permanent tax on writing
UI afterward (`t("some.key")` instead of a literal).

So the honest trade is: **a small feature behind a large prerequisite.** Worth
noting the boxholder's own read is "I don't know if we really want to do this."
Filed as the shape to use *if* it's pursued, not as a recommendation to pursue.

A cheaper middle path, if the voice problem is the actual itch: externalize only
the handful of strings that genuinely sound wrong coming from a service (the
feedback confirmations that prompted this issue), rather than the whole UI. Same
override mechanism, tiny catalog, no global rewrite — and it can grow later if it
proves useful.

### Design questions

- **Not every string should be agent-editable.** Destructive-action
  confirmations, auth prompts, and error messages are safety-relevant — an agent
  rewriting "Delete this card?" into something breezy, or softening a failure
  into reassurance, makes the UI lie. Likely a protected namespace that overrides
  can't reach, or an explicit allowlist of overridable keys. Decide this *before*
  building, since it shapes the key structure.
- **Placeholder integrity.** If a message takes interpolation
  (`"{count} items"`), an override that drops or renames the placeholder breaks
  the render. Validate overrides against the default's placeholder set and reject
  (loudly) on mismatch — the same fail-closed posture as card validation.
- **Where the override lives.** Per-box `config/` as a card, so it validates and
  diffs like everything else? And does it apply to user-facing UI chrome only, or
  also to agent-facing prompt text (it should NOT — that's the prompt surface,
  which is a different concern with its own review discipline).
- **Relationship to the personality card.** The box's voice already lives in
  `main.personality.card` (with `source: inferred` traits the agent accumulates).
  UI-string voice should be an *expression* of that, not a second independent
  place where "how the box sounds" is defined — otherwise they drift and nobody
  knows which one is authoritative.
- **Who writes it, and when.** An agent rewriting UI copy as a background whim is
  different from doing it deliberately when it learns the boxholder's register.
  The latter fits the existing "arrange context, don't automate judgment" posture.
