---
title: "Card names shown in the frontend come from seven helpers, and some show the card type"
workstream: dup-sweep-frontend
area: beebox
labels: [code-quality]
filed-by: agent
discovered-by: agent
discovered-in: worktree-dup-sweep-frontend — frontend pass of the functional-duplication sweep
resolution: implemented
---


**Closed:** implemented by the dup-sweep-frontend branch (plan frontend-unify-formatters-refresh-storage; commits 65147fadb through 1bb95099e). Each commit message names the behavior changes. Wording was covered by unit/DOM tests, not checked in a browser.

Part of the [functional-duplication sweep](../../code-quality/2026-10-22-functional-duplication-sweep.md).
`lib/display-name.ts` exists so a card reads as \"Soup\", not \"Soup.recipe.card\".
Other helpers turn a path into a name with different rules:

| Helper | `my-soup.recipe.card` | Notes |
|---|---|---|
| `lib/display-name.ts` displayName | my soup | `[_-]` to space |
| `lib/ref-label.ts` refLabel | my soup | also strips `#fragment`, leading `/` |
| `chat/ChatMessages/activity-wording.ts:80` cardTitle | my-soup | only `_` to space |
| `exports/view-widgets.tsx:34` filenameTitle | my-soup | cuts at the first dot (`Foo.v2.doc.card` gives Foo) |
| `chat/user-message-text.tsx:19` docBasename | my-soup.recipe | strips only `.card`: the type shows |
| `chat/InteractiveChat-layout/ChatSelections.tsx:16` docName | my-soup.recipe | same as above; fallback "Chat" vs "chat" |
| `shared/attach-path.ts` cardBasename | my-soup | no frontend callers |

Titles from frontmatter have a second split: `lib/card-title.ts` cardTitle uses
`title`, then a landmark's `navigation.label`, then `name`. `FileView/view.tsx:56`
has a private `cardTitle` that reads only `title`. So the chat header of a person,
place or landmark card shows the filename while its tab shows the name.

Each merge changes a visible name. The likely shape: one path-to-name rule
(displayName or refLabel, perhaps built on `shared/card-name.ts`
parseCardFileName), and FileView's chat header using `lib/card-title.ts`.
