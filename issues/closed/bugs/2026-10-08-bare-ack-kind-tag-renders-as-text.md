---
title: "A bare ack kind tag such as <todo-added> shows as text in the chat reply"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-oct — A-lending journey walk, 2026-10-08
resolution: implemented
---

Fixed 2026-10-08: `normalizeAckAliases` now rewrites a bare tag for every registered ack kind (self-closing, paired, or lone opening tag) to `<ack kind=…>`; covered in `structured-output-parsing.doctest.md`.

In the A-lending walk the reply at 10:22:27 contained a literal `<todo-added>`
in the text the person read
([report](../../../beebox/test/user-stories/journeys/A-lending/reports/2026-10-08.md), row 21, shot 06). The agent
wrote the kind as a tag name instead of `<ack kind="todo-added">`. The
C-reconnecting walk showed the correct form rendering as chips ("Created",
"Done"), so the canonical form works.

## Mechanism

- The prompt lists `todo-added` as a value of `<ack kind=…>`
  (`beebox/src/core/chat/session/prompts.ts:155`).
- `normalizeAckAliases` rewrites only the bare `<no-response>` shorthand
  (`beebox/src/frontend/src/lib/structured-output-parsing.ts:75-83`).
- `stripStructuredOutputTags` removes `<ack>`, `<callout>` and chat-app tags
  (`structured-output-parsing.ts:155-158`). A bare kind tag survives and
  reaches Markdown as text.

## Fix direction

Either normalize every known kind the way `no-response` is normalized, or
strip unknown lowercase-kebab tags that match an ack kind. The first keeps
the tolerance rule already in the file header ("regex-based and tolerant").

## Related

[Design review: the emoji ack badges](../../features/2026-09-27-ack-badge-design-review.md)
covers the badge design, not parsing.
