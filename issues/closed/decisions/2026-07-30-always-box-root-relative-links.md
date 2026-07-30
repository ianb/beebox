---
title: "Standardize agent-authored links on box-root-relative paths (drop document-relative)"
area: callback-box
filed-by: agent
discovered-in: main session — boxholder, recurring agent link error
resolution: implemented
design: ../../../callback-box/docs/implemented-plans/box-root-paths.md
---

## Implemented (2026-07-30)

Shipped in full by `callback-box/docs/implemented-plans/box-root-paths.md` (branch
`worktree-path-handling-model`, Tracks A–G): one `src/shared/ref-path.ts`
algebra behind every parse/resolve, chat re-based on the box root, nav and
landmark accepting/teaching the leading-`/` form, the guidance stated once in
`REF_PATH_RULE` with exemplars swept, `cb validate --canonical [--fix]` as the
opt-in normalizer, and three knowledge audits (`links-always-box-root`,
`landmark-ref-box-root`, `attach-is-the-exception`) authored and passing.

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
- **Guidance sent mixed signals.** The concrete link *examples* in
  `agent-guide/cards.ts` / `schemas/figure.ts` were already box-root-absolute
  (`/store/...`), but the ref-path *prose* in `cards.ts` and `source.ts` taught
  "a bare path resolves relative to the current card" as an equal option — so the
  model treated bare-relative as fine. (Nudged 2026-07-30, below.)
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

## Landed so far (2026-07-30)

- **Chat-embedded images now resolve from the box root**, not the chat's bound
  dir (`markdown-rendering.tsx`) — the concrete bug the boxholder hit. Chat has no
  meaningful "current directory," so a bare `![](photo.png)` was mis-rooting under
  a directory-scoped chat's subdir.
- **Guidance nudged**: `cards.ts` / `source.ts` ref-path prose now prefers the
  leading-`/` box-root form (part of lever 1). NOT yet done: chat *links* and
  non-image `![](card)` embeds still resolve against `contextDir`; the landmark
  schema is unchanged.

## Levers once decided (in increasing blast radius)

1. **Guidance consistency (safe, do first regardless):** make *every* agent-guide
   exemplar box-root-absolute (`/store/...`), and add one explicit rule: "always
   a leading `/`." This alone should cut the chat error a lot.
2. **Knowledge audit** that reproduces the error the way the bare-filenames one
   did — have the agent write a link *intuitively* and assert it uses a leading
   `/` (see [agent-emits-bare-card-filenames](../../bugs/2026-07-21-agent-emits-bare-card-filenames-in-chat.md)).
3. **Landmark schema semantics:** change `ref` from "relative to the landmark's
   directory" to box-root-relative — a schema-doc + resolution change, and
   **existing landmark cards with relative refs need migration** (or keep
   resolving relative for back-compat while only *recommending* `/`).
4. **Resolution posture:** keep document-relative resolution working (don't break
   existing box data) but stop teaching it; optionally a lint/validation nudge
   that flags a relative agent-authored ref.

## DECIDED (2026-07-30, worktree path-handling-model)

Boxholder call after the full path-surface mapping session: **everything is
box-root-based, always; `attach/` is the one exception.** No `.md`-dossier
exemption (we accept that leading-`/` links only work in our renderer), no
landmark exemption (dir-relative landmark refs lose their special status;
existing ones keep resolving). Resolution stays liberal — document-relative
forms keep resolving forever for existing data; the rule governs what is
*authored and taught*, plus validation nudges. Nav must accept the leading-`/`
form it currently rejects. Chat re-bases ALL message markdown (links + card
embeds, completing the image half-fix) to the box root; old directory-bound
transcripts' bare links retarget on re-render — accepted, since most bare
links were intended as box-root anyway.

The full surface map, per-surface spec, consequence analysis, and ranked
bug list (incl. two convention-independent bugs: `create-after-success[].path`
has no box-containment on its write path, and feedback `path#fragment` refs
false-flag as broken) came out of that session's analysis doc + Codex review;
implementation is not yet scheduled.

## Open questions (superseded by the decision above; kept for history)

- Full deprecation of document-relative, or "always recommend `/` but still
  resolve relative" (safer for existing boxes)?
- Landmark migration: auto-rewrite existing relative refs to `/`-absolute on
  `cb validate --fix`, or leave them and only change guidance?
- Does `attach/` (the sibling-attachment prefix) stay a relative exception? It's
  a genuinely local reference and reads naturally relative.

## Related

- [agent-emits-bare-card-filenames-in-chat](../../bugs/2026-07-21-agent-emits-bare-card-filenames-in-chat.md)
  — same surface (agent link output), different failure; the knowledge-audit
  approach there applies here.
