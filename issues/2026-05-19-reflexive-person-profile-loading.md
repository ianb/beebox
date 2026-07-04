---
needs: [design]
area: callback-box
---

# Reflexive person-profile loading + person-as-directory promotion

Two related questions about how the agent handles people.

**Reflexive profile load.** Before producing output that involves a specific person (drafting a message to them, prepping for a meeting, summarizing their situation), the agent should *always* load that person's profile file if one exists — not rely on session memory, not improvise from general training. Session memory degrades; the profile file is the canonical reference. This should be a pre-condition for the operation class, not a judgment call — analogous to the autonomy matrix's reversibility-driven requirements ([Declared per-box autonomy matrix with encounter queue](2026-05-19-autonomy-matrix.md)). No "VIP tier" framing needed; presence-of-profile is the signal.

**People are directories, not cards.** Each person gets a directory under `people/` with:

- **A header card** — the canonical, structured profile. This is what the reflexive-load mechanism targets. Contains preferences, relationship context, sensitivities, active items, last-interaction notes, anything else that has consistent slots.
- **Free-form attachments** — anything else that helps track or explain the person. Notes the agent jotted down, photos, document copies, draft fragments, past correspondence excerpts, scanned letters, voice memos. No required shape, no schema, just "stuff related to this person."

The header card itself should document this expectation: it notes that attachments are intentionally free-form and the agent (or boxholder) can put whatever helps in there. Without that explicit note, agents tend to either over-constrain (refusing to add things because there's no schema for them) or under-utilize (sticking only to the structured header).

Decision rationale for directories-from-the-start rather than card-then-promote: the migration cost is real (links break, agents have to relearn paths), and the simplicity gain of single-card people is small. Setting up the directory structure once and never re-shaping it is cleaner.

Open questions:
- **Naming convention for the header.** `people/alice/alice.person.card`? `people/alice/profile.card`? `people/alice/_header.card`? Whatever fits the existing card conventions.
- **Connection to [Introspectable feedback as the storage layer for accumulated observations](2026-05-19-introspectable-feedback-storage.md).** Per-person feedback entries (hunches about Alice, parked observations) probably live in the central feedback layer with a person reference, so cross-cutting queries still work — not scattered into each person's directory.
