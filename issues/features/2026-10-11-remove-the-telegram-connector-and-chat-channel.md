---
title: "Remove the Telegram connector and chat channel"
workstream: unattached
area: beebox
labels: [connectors, telegram, removal]
filed-by: agent
discovered-by: agent
discovered-in: worktree-plugins-planning — plugins slice 3 sizing, 2026-10-11
---

The plugins design notes list Telegram under removals, not plugins: *"Telegram
(a connector and a chat channel; its own issue)"*
(`beebox/docs/implemented-plans/plugins-design-notes.md`, Candidates). The
issue did not exist; this is it. Nothing here is decided: a box that uses
Telegram loses its bot chat, so the boxholder says whether any box does
before this is `do-it`.

## What Telegram touches

Measured by grep for `telegram` outside its own directories on 2026-10-11:

- The connector `src/connectors/telegram/` and its registry row in
  `src/connectors.ts`; the service `src/services/telegram*`; the
  `telegram-message` schema (`src/schemas/telegram-message.ts`, registered in
  `src/schemas.ts`); the `chat-thread` cards it writes under
  `_content/chat/telegram/`.
- Core that names it: `src/core/telegram-send.ts`, the notification channel
  set (`src/core/notification/{channels,health,audience,intent}.ts`),
  `notify-boxholder.ts`, `question-aging.ts`, `question-alert.ts`, the
  chat session prompts, `src/requirements.ts`, `src/transient-state.ts`,
  box config, and the secrets registries (`src/core/secrets/{migrate,name-match,lifecycle,format-registry,guide-registry,probe-registry}.ts`).
- Admin: the admin router imports it (`src/webapp/trpc/routers/admin/router.ts`).
- Docs and tests: `docs/connectors/telegram.md`, the static connector table in
  `src/core/docs-gen/content.ts`, `test/connectors/telegram.doctest.md`,
  `test/connectors/telegram/{output-cards,webhook}.doctest.md`.

About twenty core files beyond the connector, most of them the notification
channel. Removing the channel is the person-facing part: a boxholder who is
reached on Telegram today would need another loud channel first
(`docs/notifications.md`).

## Before it is do-it

- Which production or local boxes have a Telegram bot token in the machine
  store, and whether anyone is reached on it.
- Whether the notification channel abstraction keeps a second channel after
  removal or collapses to one.
