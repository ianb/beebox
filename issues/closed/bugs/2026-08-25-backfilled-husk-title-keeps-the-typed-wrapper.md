---
title: "A husk titled from an existing transcript keeps the raw <typed> wrapper, email and all"
workstream: live-vs-stored
resolution: implemented
area: beebox
filed-by: agent
discovered-in: worktree-live-vs-stored — noticed while verifying session-media in the running app
labels: [code-error]
---

> **Fixed 2026-08-25.** `readSnippetTitle` now calls `extractSnippet` — the one
> cleaning step between a raw user message and a display label — instead of
> reimplementing half of it. Covered by a `<typed>`-wrapped case in
> `test/core/chat-husk.doctest.md` that asserts the resulting card carries no
> email address.
>
> **No repair needed for existing data.** A survey of every chat husk in the
> local boxes found no title carrying a `<typed>` wrapper: the backfill path is
> narrow enough that the leak had not been hit. (One stale title carries an old
> `<chat-app>` prepend, which the previous code already stripped — it predates
> that stripping rather than showing a live defect.) Had one existed, a data
> migration would have bought little anyway: the address would already be in the
> box's git history, which a title rewrite cannot reach.

`readSnippetTitle` (`src/core/chat/husk.ts:60-81`) builds a husk title from the
transcript's first user message and strips only the `<chat-app …>` snapshot tag.
It does not strip the `<typed>`/`<speech>` shell, so the title it writes reads:

    title: <typed user="Ada Lovelace" user-email="ada@example.com">here is the drawer photo</typed>

That is the chat's display name in the session chip, the Recent-chats panel, and
the picker — and it puts the sender's **email address** into a committed card
title.

The cleaning step already exists and is documented as the only one:
`extractSnippet` → `stripSpeechWrappers` (`src/cli/lib/session-text.ts:38-62`)
unwraps `<typed>`/`<speech>` along with `<chat-app>`, and that is what
`readFirstUserSnippet` uses for list labels. `readSnippetTitle` reimplements
half of it.

**Narrow in practice, not zero.** `ensureChatHusk` usually runs at session
creation, when the transcript is still empty, so the title starts null and gets
set editorially later. The raw-wrapper title appears on the *backfill* path —
a husk created for a transcript that already has turns (`ensureChatHusk` with a
`date` from the transcript mtime). Reproduced by dropping a transcript with a
web-composer-shaped first message into a box and loading its chat.

Fix is to call the shared cleaner instead of the partial one. Existing husks
carrying a wrapped title would need a one-off cleanup, since the title is
editorial once written and nothing rewrites it.
