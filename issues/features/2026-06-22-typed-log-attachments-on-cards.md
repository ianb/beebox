---
title: "typed log attachments on cards"
needs: [design]
area: callback-box
---

A card should be able to carry **typed, append-only logs** as a first-class kind
of attachment — kin to commentary, but *not itself a card*: a raw JSONL event
stream named by its type, e.g. `Learning_Progress.log.jsonl` (the general shape
`<logtype>.log.jsonl`, a log alongside its card the way `<name>.attach/` holds a
card's assets). Each line is one event; the file grows; the **type** declares the
entry shape, the way card schemas declare a card's frontmatter.

The motivating example is that **we already have exactly this shape and just
haven't generalized it**: a chat *session log* is a per-session append-only
`<sessionId>.jsonl` of turn events (`src/cli/lib/session.ts`,
`session-entry.ts`). But it lives outside the box in
`~/.claude/projects/<encoded-cwd>/`, is keyed to a *session*, and is tied to a
card only transiently — the open card rides the URL (`?card=store/chemistry/
learning-plan.md`) and the per-turn `<chat-app>` snapshot, never persisted as a
card-owned artifact (`InteractiveChat-card-hooks.ts`, `chat-session-start.ts`).
So a session that's "about" a learning-plan card leaves no durable, queryable log
*on* that card. The idea inverts that: the log belongs to the card.

Why this is a natural fit, not a new substrate:

- **Storage already exists.** `.jsonl` is already an accepted file type inside
  the `<name>.attach/` scope (raw attachments, `src/shared/attach-path.ts`,
  `asset-manifest.ts`). JSONL appends are git-friendly (line-diffable, no
  rewrite). So the question is *typing + discovery + rendering*, not plumbing.
- **A producer already exists.** The card-activity vocabulary
  (`scrolled`/`navigated`/`explored`/`modified` with free-text detail,
  `src/core/chat-card-activity.ts`) is computed per turn and embedded in the
  snapshot — but never persisted per-card. Persisting it to a card's
  `activity.log.jsonl` after `chatSession.send()` is the obvious first log type:
  a durable "what happened around this card" timeline.

How it differs from the two neighbors it sits between:

- **vs commentary** (`src/schemas/commentary.tsx`): commentary is a *card*
  (frontmatter + Markdoc body), authored by *replace* (the agent rewrites the
  body, anchored with `{% source %}`). A log is a *file*, authored by *append*,
  and is an event stream rather than prose. Same "attached, agent-authorable"
  family; different lifecycle.
- **vs raw attachments**: untyped today (discovered by extension). A log is
  *typed* — a registry of log types (parallel to `cardSchemas[]`) declares each
  type's entry shape so entries validate and a type-specific renderer can show
  them.

Open questions for an eventual plan (don't design here):

- **Naming/placement.** Sibling of the card (`<base>.<logtype>.log.jsonl`) vs
  inside `<base>.attach/`? The attach scope is the natural home (ref resolution,
  manifest, listing all come for free), but a log isn't quite an "asset."
- **Typing mechanism.** A log-type registry (entry schema + validator +
  renderer), mirroring how `cardSchema` + the registry + renderers compose. Are
  entries self-describing, or does the filename's `<logtype>` key the schema?
- **Who appends, and append safety.** Agent, connectors, and the system
  (card-activity) are all producers — concurrent appends need the same lock
  discipline as the rest of the box (`src/lib/file-lock.ts`).
- **Rendering.** A generic timeline/paginated viewer, plus per-type renderers
  (the renderers system is the precedent). How it surfaces on the host card
  alongside attachments/commentary.
- **Unify session logs?** Could a chat session log *be* a typed log attachment of
  the card it's about, rather than a separate `~/.claude/projects` artifact? That
  would close the "session about a card leaves no trace on it" gap directly — but
  it's a bigger move (the SDK owns session-log writing today).
