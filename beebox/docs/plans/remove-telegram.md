---
title: "Remove Telegram"
status: draft
workstream: plugins-planning
issues:
  - ../../../issues/features/2026-10-11-remove-the-telegram-connector-and-chat-channel.md
---
# Remove Telegram

Telegram is a connector (a bot the box reads and replies through), a
notification channel, and the only producer of three pieces of chat
machinery: chat-thread cards, chat jobs, and thread sessions. The boxholder
decided on 2026-10-11 to remove it: "I'm confident it doesn't work right."
This plan removes the connector and channel (Track 1) and the chat machinery
nothing else uses (Track 2), keeps the `chat-thread` schema because old
threads exist on three production boxes, and needs no data migration.

**Issues addressed:**
[remove the Telegram connector and chat channel](../../../issues/features/2026-10-11-remove-the-telegram-connector-and-chat-channel.md).
Related, found by grepping the queue for `telegram`:
[notifications and proactive design](../../../issues/features/2026-09-25-notifications-and-proactive-design.md)
(names Telegram as one channel of three; the design question survives with
two), [thread-authoritative box slug](../../../issues/code-quality/2026-07-19-thread-authoritative-box-slug.md)
(its Telegram example goes; the issue is about delivery paths generally),
and the closed [Telegram thread session context](../../../issues/closed/features/2026-08-29-telegram-thread-session-context.md),
whose code Track 2 deletes.

## Design

What a person meets:

- When I open Admin, I want to see the connections I can use, so I can set
  up what I need. The Telegram section (a probe card with connect and
  disconnect) is gone from the Connections tab
  (`src/frontend/src/pages/AdminPage.tsx:104`,
  `components/admin/sections.ts:27, 54, 77`). Nothing replaces it.
- When the box needs to reach me, I want it to use the channels I set up,
  so I am told. The channel rule (`docs/notifications.md`, *Channels*) has
  two columns after this: the iPhone app and the browser. A box that was
  reached on Telegram would hear nothing; no production or local box has
  `healthAlerts.telegramChat` set (checked 2026-10-11), so no one is.
- When I look at an old Telegram conversation in my box, I want it still
  there. The `chat-thread` cards under `_content/chat/telegram/` stay and
  validate; the schema is kept, with its wording no longer naming Telegram
  as a live connector.
- The one where the person does not want this: a box that was reached only
  on Telegram. None exists; if one did, the loss is loud, since the
  `notifications-no-channel` health check counts intents nothing could
  carry (`docs/notifications.md:230`).

Right place and time: nothing acts or shows; the Admin section's absence is
the whole change. Trust: no action is taken on anyone's behalf.

## Smallest fix and budget

**Smallest fix (Track 1 alone):** delete the connector, its service, schema,
webhook route, admin procedures and section, and the notification channel;
leave the chat-thread sessions, chat jobs and their reactor path in place
with no producer. About 2,900 lines deleted and 350 edited across 55 files.

**Chosen:** Track 1 plus Track 2, which deletes the chat machinery only
Telegram fed: `ChatSessionPool` and `ChatThreadSession`
(`src/core/chat/session/pool.ts`, 402 lines; `thread.ts`, 435), the
`chat-job` schema and the reactor's chat-job path with its session store,
and the thread helpers in `src/job-cards/chat-utils.ts`. The simplest
version leaves 1,500 lines that run for nobody and a reactor branch
(`cycle.ts:257`, `typeFilter === "chat"`) no card can reach; principle 7
(absence means non-existence) says delete them, and they return with a real
messaging connector if one comes.

Like for like: about 4,450 lines deleted (code 3,100; tests 1,010; docs
120; the rest generated box docs), about 450 lines edited across 60 files,
plus the public site's ten pages that mention Telegram. **BIG CHANGE**, by
deletion. The boxholder's "kill it" is the approval for Track 1; Track 2
widens it to the machinery only Telegram used, and the *Open design
questions* section holds that choice.

## Stated preferences this plan trades against

- **Principle 7, hierarchy is a discoverability contract**
  (`docs/engineering-principles.md:87`), and the file-layout rule that
  *"a directory does not promise content held elsewhere"*: a `chat-job`
  schema in the registry promises a producer. After Track 1 there is none.
- **Principle 8, one way to do each thing** (`:95`): `safeFilename` lives in
  `src/job-cards/chat-utils.ts:36` and is imported by Drive, Clerk and Share
  (`src/connectors/google-drive/folder-convert.ts:22` and five more). When
  the rest of that file goes, the helper moves to `src/lib/safe-filename.ts`
  so the file's name stops promising chat utilities.
- **Keep data, drop code** (`docs/box-work.md`, and the boxholder's standing
  rule that box content is theirs): the old thread cards stay; nothing
  deletes or rewrites them.
- **Bias toward strict**: leftovers are reported, not tolerated silently.
  A `telegram-message` card would make `bbx validate` exit 1 as an unknown
  type (`src/cli/commands/validate/command.ts:200`); none exists in any
  production or local box (checked 2026-10-11).

## What already exists

- **Connector:** `src/connectors/telegram/` (8 files, 1,102 lines); registry
  row `src/connectors.ts:46` `telegram: createTelegramConnector,`; the
  hand-built list in `src/cli/commands/finalize.ts:71` and its
  `services: { tg?: TelegramService; push?: PushService }` (`:22, 32`).
- **Service:** `src/services/telegram.ts` (182), `telegram-schemas.ts`
  (57); `src/services/container.ts:33` `telegram?: TelegramService | undefined;`.
  No npm dependency: raw `fetch`.
- **Webhook route:** `src/webapp/routes/telegram.ts` (189), registered at
  `src/webapp/server-box-scope.ts:389`; `src/core/telegram-send.ts` (65),
  used only by that route.
- **Schema:** `src/schemas/telegram-message.ts` (58), registered at
  `src/schemas.ts:122`; `src/core/search/extract/core.ts:278`
  `case "telegram-message":`; frontend file type
  `src/frontend/src/file-types/builtins.tsx:50`.
- **Admin:** `src/webapp/trpc/routers/admin/router.ts:75, 104, 167`
  (`telegramStatus`, `telegramSetup`, `telegramDisconnect`) and its imports
  at `:7-8, 11`; `components/admin/TelegramSection/` (236);
  `AdminOverview/use-admin-overview.ts:16, 64, 86` and
  `admin-overview-summaries.ts:107`.
- **Notification channel:** `src/core/notification/intent.ts:19`
  `CHANNELS = ["apns", "web-push", "telegram"]`; `audience.ts:23-24, 30,
  40, 45, 54`; `health.ts:66` (message text); `notify-boxholder.ts:13-14,
  38, 75, 84, 105, 185-209, 218`; `question-alert.ts:18, 71, 74, 109`;
  `question-aging.ts:34, 63, 220`; `src/cli/commands/notify/command.ts:180,
  258`; `notify/dry-run.ts:26, 28`; `src/core/box/config.ts:87-89`
  `healthAlerts.telegramChat`.
- **Secrets:** family `telegram-bot/<slug>` in `format-registry.ts:74`,
  `probe-registry.ts:80, 125-132`, `guide-registry.ts:175-179`,
  `migrate.ts:76, 99-102` (legacy `telegram.secret.json` import),
  `uses.ts:93-95`; `src/requirements.ts:70` `storeNameAliases` and `:79`
  `perBoxOnly`, both Telegram-only; lifecycle comments use it as the
  per-box example (`lifecycle.ts:178, 282`), and the other per-box secret
  (publish's bucket token) keeps `shareable: false` meaningful.
- **Chat machinery (Track 2):** `chat-thread` cards are created only by
  `ensureThreadFile` from `src/connectors/telegram/ingest.ts:85`;
  `createChatJob` is called only from the connector and webhook
  (`connector.ts:252, 337`, `webhook.ts:79`); `ChatSessionPool` is
  constructed only in `src/webapp/routes/telegram.ts:21`; `thread.ts` is
  reached by `pool.ts:19`, by `app.ts:49` (`quiesceChatThreads`,
  `chatThreadsAreIdle` at `:427-429`) and by the dev prompt tools
  (`src/dev/lib/prompt-inventory.ts:14, 65-67`,
  `context-assembly/assembly.ts:22, 163`); the reactor's chat path is
  `cycle.ts:19, 257-258` and `chat-jobs.ts` with `reactor-sessions.ts`
  (`core.ts:29-32, 125-127`, the `--reset-sessions` branch);
  `src/shared/chat-channel.ts:17` `AgentChatChannel = ChatChannel | "telegram"`
  used by `session-context.ts:21, 202`, `chat/features.ts:15, 171`,
  `reactor/engine/chat-jobs.ts:60` and `reactor/prompts.ts:22`.
- **Agent-facing text:** `src/core/agent-guide/guide.md:309, 405`,
  `ledger.yaml:836`; skills `content.ts:110`; `src/core/docs-gen/content.ts:56-62,
  142` and `package-docs/core.ts:60`; `src/schemas/chat-thread.ts:39, 51`,
  `chat-job.ts:4, 29`, `memo.ts:61`, `guide/templates.tsx:172`;
  `src/dev/knowledge-audits.yaml:594, 1108, 1940-1949, 2020`.
- **Docs:** `docs/connectors/telegram.md` (120); mentions in
  `docs/connectors.md`, `docs/notifications.md`, `docs/security-overview.md`,
  `docs/security-report.md`, `docs/secrets.md`, `docs/chat*.md`,
  `docs/glossary.md`, `docs/install.md`, `README.md`,
  `src/connectors/AGENTS.md`, `src/services/AGENTS.md`,
  `deploy/add-box.sh:44, 407`; the public site `site/docs/*` (ten pages).
- **Tests:** Telegram-only `test/connectors/telegram.doctest.md`,
  `telegram/{output-cards,webhook}.doctest.md`,
  `test/webapp/trpc/routers/admin.telegram-secrets.doctest.md`,
  `test/core/chat/session/{pool.thread-maintenance,thread.session-messages}.doctest.md`;
  tests that import `createFakeTelegram`: `test/core/notify-boxholder.doctest.md`,
  `test/webapp/trpc/routers.notifications-presence.doctest.md`,
  `test/cli/commands/notify/command.doctest.md`,
  `test/services/connector-response.doctest.md`; twenty more that mention
  it in prose or fixtures (`test/core/notification/channels.doctest.md`,
  `test/requirements.doctest.md`, the secrets doctests, the reactor
  doctests, `test/transient-state.doctest.md:74`).
- **Box leftovers, checked on every production and local box 2026-10-11:**
  no `telegram-message` or `chat-job` cards; no `telegramChat` in any
  box.json; `_bookkeeping/connectors/telegram.state.json` on three
  production boxes (gitignored transient state, read by nothing after the
  change); old `chat-thread` cards under `_content/chat/telegram/` on three
  production boxes and test1.

## Prior art (external)

No decision depends on an external premise; this is a deletion inside the
repository. No search made.

## Ontology

No new nouns. Removed nouns: **Telegram connector**, **Telegram channel**
(`ChannelName` member), **telegram-message** card, **chat-job** card (Track
2), **thread session** (`ChatThreadSession`, `ChatSessionPool`, Track 2).
Kept with narrower meaning: **chat-thread** card, now "a conversation a
messaging connector once appended to; no connector appends today". The
`connector` field on `chat-thread` stays a string: the old cards carry
`telegram` and must still validate.

## Tracks / scope

### Track 1: the connector and the channel

**What.** Delete the connector directory, the two service files, the
schema, the webhook route and `telegram-send.ts`, the admin procedures and
the admin section with its overview summary, and `docs/connectors/telegram.md`.
Remove `telegram` from `CHANNELS` and everything the union pulls through:
audience, the stranded-alerts message, `notify-boxholder`'s service and
send path, the `tg` parameter of `question-alert`/`question-aging`, the
notify CLI's `--channel` list and dry-run, and `healthAlerts.telegramChat`
from box config. Remove the `telegram-bot/` family from the five secrets
registries and the two Telegram-only tables in `requirements.ts`. Drop the
registry row, the `finalize` list entry and its `tg` service, the container
field, the search `case`, the frontend file type, and the docs-gen row.
Rewrite every prose mention listed above; regenerate `box-docs`; edit the
ten site pages. Delete the four Telegram-only doctests and fix the four
that import the fake and the twenty that mention it.

**Why.** The boxholder's decision. Each part is reached only through the
others: the route needs the service, the channel needs the service, the
secrets family exists for the route.

**Direction.** Deletion first, then let `pnpm typecheck` list every
remaining reference; then the prose grep (`grep -rni telegram src docs
test ../site/docs`) to zero, except history (`docs/implemented-plans/`,
closed issues, user-story reports, `CHANGELOG`-like records), which is not
rewritten. `CHANNELS` becomes `["apns", "web-push"]`; the `Audience`
record and `ChannelFlags` shrink with it; `channelsToTry` is unchanged in
logic. `perBoxOnly` and `storeNameAliases` in `requirements.ts` go entirely
(both Telegram-only); the comment on `lifecycle.ts:178` names the publish
bucket token as its example instead.

**Vocabulary lock-ins.** `ChannelName` is `"apns" | "web-push"`. The
`chat-thread` schema keeps `connector: z.string()`.

**First chunk.** The deletions and the typecheck-driven edits, one commit;
prose, docs, site and box-docs regeneration, a second commit; tests, a
third.

### Track 2: the chat machinery only Telegram fed

**What.** Delete `pool.ts`, `thread.ts` and their two doctests; the
`quiesceChatThreads`/`chatThreadsAreIdle` calls in `app.ts:427-429`; the
thread prompt entries in the two dev prompt tools; the `chat-job` schema and
its registration; `reactor/engine/chat-jobs.ts`, `chat/reactor-sessions.ts`,
the `--reset-sessions` branch in `reactor/engine/core.ts:124-129` and its
CLI flag, the `typeFilter === "chat"` branch in `cycle.ts:257`, and the
*Chat jobs* section of `src/core/reactor/DESIGN.md:37`; the thread helpers
in `job-cards/chat-utils.ts` (`ensureThreadFile`, `ensureParticipant`,
`appendMessageToThread`, `findUnsentAgentMessages`, `stampSentMessage`,
`createChatJob`, `updatePersonEntry`), moving `safeFilename` to
`src/lib/safe-filename.ts` with its six importers; collapse
`AgentChatChannel` to `ChatChannel` in `shared/chat-channel.ts:17` and the
four readers; drop the `channel: "telegram"` reactor prompt rule
(`reactor/prompts.ts:22`). The `chat-thread` schema stays; its description
and instructions stop naming Telegram as the connector that appends.

**Why.** Every item has one producer or one consumer, and it is Telegram
(citations in *What already exists*). The `.beebox/chat-thread-sessions.json`
and `.beebox/chat-sessions.json` state files are written by the deleted
code only (`pool.ts`, `reactor-sessions.ts`); a leftover file is inert.

**Direction.** Same deletion-then-typecheck discipline. The reactor keeps
batch jobs and `typeFilter` for other job types. `updatePersonEntry` is
checked for other callers before deletion (grep found none outside the
file; typecheck confirms).

**Vocabulary lock-ins.** `safeFilename` at `src/lib/safe-filename.ts`.

**First chunk.** One commit after Track 1, since it depends on the route
and connector being gone.

## Could this be simpler?

The simplest version is Track 1 alone. It leaves `ChatSessionPool`,
`ChatThreadSession`, chat jobs and a reactor branch with no producer, which
fails principle 7 (a `chat-job` type in the catalogue promises a producer)
and leaves `app.ts` quiescing sessions that cannot exist. Track 2 costs one
more commit. Simpler still would be to delete the old `chat-thread` cards
and the schema with them; declined, they are the boxholder's conversations.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A `telegram-message` card appears (restored from a backup) | `bbx validate` unknown-type | exit 1 names the file (`validate/command.ts:200`) | clear |
| A `telegram-bot/<slug>` entry remains in a machine secret store | none | `lookupByName` finds no registry entry: no probe, no guide, no use text; the secrets page lists the name without a description | silent but visible: it is listed; accepted, no store on the server holds one (listing checked 2026-10-11) |
| An old box.json carries `healthAlerts.telegramChat` | none | the config parser's handling of an unknown nested key is checked in implementation; if it throws, the key is removed by the deploy's template sweep or by hand | to verify; none exists today |
| `channelsToTry` with two channels changes a loudness rule | `test/core/notification/channels.doctest.md` | n/a | clear: the doctest's expectations change with the union and the diff shows each |
| A leftover `telegram.state.json` or `.beebox/chat-sessions.json` | n/a | read by nothing | inert |
| A site page still says Telegram after the push | none | the prose grep in Track 1's done-when | clear at review |

No critical gap.

## Agent-flow / user-flow edge cases

- Wrong tag / wrong field: n/a.
- Stale ref: old chat-thread cards reference `_content/chat/telegram/...`
  siblings only; they stay. ADDRESSED.
- Two agents touching the same card: n/a.
- Hand-edit drift: an agent that read the old guide might create a
  `telegram-message` card; `bbx validate` names it. ADDRESSED.
- Fabricated free-form value: n/a.
- Validation error UX: the unknown-type message already reads well
  (`lint-cards.ts:136-150`).
- Partial migration / transition state: none; no data shape changes.
  ADDRESSED.

## NOT in scope

- **Deleting old thread cards or the `chat-thread` schema.** The cards are
  the boxholder's; the schema validates them.
- **A replacement messaging channel.** The notifications issue
  (2026-09-25) owns that design.
- **Rewriting history docs**: implemented plans, closed issues, user-story
  reports and catalogues keep their Telegram mentions.
- **The hub's webhook comment** (`src/hub/server/core.ts:304`) is reworded,
  not the JSON-POST behaviour it describes.
- **`bbx finalize` itself** stays: Gmail drafts, Calendar and Drive push
  still flush through it.

## Open design questions

- **Track 2 in or out.** Lean: in, for the reasons in *Could this be
  simpler?*. If out, the plan ships Track 1 and files the dead machinery
  as a code-quality issue.

## Knowledge audits

No new concept. Two audits assume Telegram (`knowledge-audits.yaml:1940-1949`
and `:2020`, sending to a Telegram chat from a thread); they are deleted.
Two mention it in wording (`:594`, `:1108`) and are reworded; they are rerun
against test1 after the change (`pnpm knowledge-audit run --box
~/src/boxes/test1 --filter <id>`), status recorded here.

## What will hold this after it ships

The type checker holds the code: nothing can import a deleted module. The
notification doctests hold the two-channel rule. The prose grep is a
one-time check; `pnpm doc-check` holds links. The `chat-thread` cards are
held by `bbx validate` on each box.

## Implementation order

1. Track 1 code deletions and typecheck-driven edits. Commit.
2. Track 1 prose, docs, site pages, box-docs regeneration. Commit.
3. Track 1 tests. Commit.
4. Track 2, if chosen. Commit.
5. Verification: `pnpm typecheck`, `pnpm lint`, `pnpm layout-check`,
   `pnpm test:changed`, `bin/smoke`; `bbx validate` on test1 and on the
   three production boxes with old threads (read-only, over `prod-ssh`);
   the two reworded audits run. Cross-model diff review. Plan to
   `implemented-plans/`.

## Rollout shape

Done when the five checks pass, the prose grep over `src`, `docs`, `test`
and `site/docs` finds Telegram only in history, and `bbx validate` is clean
on a box with old threads. No migration. The deploy sweep has nothing to
run; the server's single Telegram environment variable, if it is one, is
left for the boxholder to drop from `.env` (not touched by a deploy).
