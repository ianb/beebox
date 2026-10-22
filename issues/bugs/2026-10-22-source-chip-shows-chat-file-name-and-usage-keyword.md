---
title: "A source chip reads \"[→ 2026 10 22 0bda0c7a: verbatim]\": the chat's file name and a raw keyword"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-late-oct — C-reconnecting walk, 2026-10-22
---

Every person card in the C-reconnecting walk quotes the person's words inside `{% source ref="/_content/chat/web/2026-10-22_0bda0c7a.chat.card" usage="verbatim" %}`. The card shows a chip "[→ 2026 10 22 0bda0c7a: verbatim]". The walker did not understand it: "a small tag I don't understand".

Report: [C-reconnecting](../../beebox/test/user-stories/journeys/C-reconnecting/reports/2026-10-22.md) (row 16; shots 08, 09).

## Mechanism

`CitationChip` labels the chip with `refLabel(sourceRef)` (`beebox/src/frontend/src/components/Markdown/Source.tsx:67`). `refLabel` takes the file name and turns `_` and `-` into spaces (`beebox/src/frontend/src/lib/ref-label.ts:22-29`). The chip then prints the raw `usage` value (`Source.tsx:103`). The chat card has a title in its frontmatter ("Reconnecting with Idris, Noor, Marisol and Bram"); the chip does not read it. The [closed fix for session id prefixes](../closed/bugs/2026-10-09-recent-chats-show-session-id-prefix.md) removed the same leak from the chat list.

## Why the fix is not obvious

The label comes from the ref alone, with no card read. A label from the target's title needs a lookup per chip or a resolved-title cache. The `usage` word ("verbatim", "paraphrase", "summary") may read better as a tooltip, or as plain words ("your words, from a chat on Oct 22").
