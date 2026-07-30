---
title: "Standardize agent-authored links on box-root-relative paths (drop document-relative)"
area: callback-box
filed-by: agent
needs: [decision]
discovered-in: main session — boxholder, recurring agent link error
---

The chat agent **frequently writes the wrong link path**: in chat it uses a
relative (or bare) path where a box-root-absolute `[desc](/path)` is wanted, and
in landmarks it uses a relative `ref`. Boxholder's proposal: *"probably it
shouldn't even be relative — always box-root-relative."* This is a convention
call.

## Why the agent errs (the current mix)

- **Resolution** (`src/frontend/src/lib/view-url.ts` `resolveRelativePath`):
  leading `/` → box-root-absolute; no slash → **document-relative** (resolved
  against the containing card's directory); undefined base → treated as
  box-root-relative. So `/path` is unambiguous; a bare `path` means "relative to
  *what?*" — which an LLM can't reliably know in chat.
- **Guidance contradicts itself.** `agent-guide/source.ts` (leading `/` = box
  root) and `schemas/record.tsx` ("box-absolute `ref` reads clearest") point one
  way; `agent-guide/cards.ts` *shows relative examples*
  (`[…](store/notes/Trip_Report.doc.card)`) the other. Mixed exemplars → the
  model copies whichever it saw last.
- **Landmark `ref` is relative by schema design** (`schemas/landmark.ts`: "a
  literal path relative to the landmark's directory", e.g. `{ ref: Bread.recipe.card }`).
  So a relative landmark ref is the agent *following the schema* — but it's the
  ambiguous form.

## The decision

Adopt **box-root-relative (leading `/`) as the one rule** for agent-authored
links and refs, everywhere (chat, cards, landmarks). Rationale: unambiguous, the
agent always knows the box root, no "relative to what" reasoning — removes the
whole error class. Trade-off: document-relative paths survive a subtree move;
box-root-absolute ones break if the target moves. For *agent-authored* links,
unambiguous > portable (and moves are rare + fixable by validation).

## Levers once decided (in increasing blast radius)

1. **Guidance consistency (safe, do first regardless):** make *every* agent-guide
   exemplar box-root-absolute (`/store/...`), and add one explicit rule: "always
   a leading `/`." This alone should cut the chat error a lot.
2. **Knowledge audit** that reproduces the error the way the bare-filenames one
   did — have the agent write a link *intuitively* and assert it uses a leading
   `/` (see [agent-emits-bare-card-filenames](../bugs/2026-07-21-agent-emits-bare-card-filenames-in-chat.md)).
3. **Landmark schema semantics:** change `ref` from "relative to the landmark's
   directory" to box-root-relative — a schema-doc + resolution change, and
   **existing landmark cards with relative refs need migration** (or keep
   resolving relative for back-compat while only *recommending* `/`).
4. **Resolution posture:** keep document-relative resolution working (don't break
   existing box data) but stop teaching it; optionally a lint/validation nudge
   that flags a relative agent-authored ref.

## Open questions

- Full deprecation of document-relative, or "always recommend `/` but still
  resolve relative" (safer for existing boxes)?
- Landmark migration: auto-rewrite existing relative refs to `/`-absolute on
  `cb validate --fix`, or leave them and only change guidance?
- Does `attach/` (the sibling-attachment prefix) stay a relative exception? It's
  a genuinely local reference and reads naturally relative.

## Related

- [agent-emits-bare-card-filenames-in-chat](../bugs/2026-07-21-agent-emits-bare-card-filenames-in-chat.md)
  — same surface (agent link output), different failure; the knowledge-audit
  approach there applies here.
