---
title: "Documentation structured like code: connectors"
status: implemented
workstream: doc-structure
issues: []
---
# Documentation structured like code: connectors

Fourth cluster under the [organizing principles](../README.md#organizing-principles).
The connector framework page already has the shape of a parent (an inventory
table with one row per connector); the five setup and reference pages become
its members under `docs/connectors/`. Same four-commit procedure.

**Issues addressed:** none filed.

## Smallest fix and budget

Smallest fix: correct the calendar page's stale state and token paths in
place. Chosen: parent plus five members, about 900 doc lines moved and ~80
rewritten, one manifest allowlist line, about 40 hand-repaired references.

## Stated preferences this plan trades against

The principles as written. Setup pages keep their step order as headings
without numbers.

## What already exists

The pilot's tooling; publish paths stay flat.

## Prior art (external)

None needed.

## Ontology

Members in the code's names: Google auth (`src/connectors/google-auth.ts`,
`google-token-store.ts`), calendar (`google-calendar*.ts`), Gmail
(`gmail*.ts`), Drive (`drive-*.ts`, `google-drive.ts`), Telegram
(`telegram*.ts`). The framework (the `Connector` interface, `syncConnector`,
the activity record, service injection) is the parent's.

## Tracks / scope

Stale facts found by reading against the code (2026-09-25), fixed in chunk 2:

| Page | Says | Code |
|---|---|---|
| calendar.md "Config and state" | state in `_config/connectors/google-calendar-state.json`; tokens in `_config/connectors/google-calendar.secret.json` | `google-calendar-state.ts:62`: `_bookkeeping/connectors/google-calendar-state.json`; tokens in the central store (`google-token-store.ts`) |
| calendar.md "Auth" | "unlike Gmail, which accepts app passwords" | Gmail uses the shared Google OAuth API (`gmail-setup.md`, `src/connectors/CLAUDE.md`) |
| connectors.md inventory | Drive card types: `sheet` | `gsheet`, `gdoc` (handlers), `gfolder`, `glink` |

Target tree:

| Old | New |
|---|---|
| `connectors.md` | stays; framework plus the members table; per-connector configuration moves to each member |
| `google-setup.md` | `connectors/google-auth.md` |
| `calendar.md` | `connectors/calendar.md` |
| `gmail-setup.md` | `connectors/gmail.md` |
| `google-drive.md` | `connectors/drive.md` |
| `telegram-setup.md` | `connectors/telegram.md` |

## Could this be simpler?

Leave the files flat and fix the calendar page. The directory is what makes
"connectors" a name a reader can walk into.

## Subplans

none.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Fact dropped in the move | section-hash check | zero missing before commit | clear |
| Code comments cite old paths | no | repo-wide grep | clear once grepped |

## Agent-flow / user-flow edge cases

Stale ref: `doc-check`. Hand-edit drift: periodic review.

## NOT in scope

`secrets.md` (the store is its own subject), `src/connectors/CLAUDE.md`,
`server/configuration.md`'s Google OAuth env vars.

## Open design questions

none.

## Knowledge audits

Skipped: nothing box-loaded changes.

## What will hold this after it ships

`doc-check`; periodic review.

## Implementation order

Before-run (done); chunk 1 moves; chunk 2 rewrite; after-run; Codex review.

## Rollout shape

Questions (pilot protocol):

| # | Question | Key string |
|---|---|---|
| 1 | Which Google APIs must be enabled? | `Google Sheets API` |
| 2 | Where do Google OAuth tokens live on a multi-box server; fallback? | `BBX_GOOGLE_TOKENS_FILE` |
| 3 | Where does a box's Google connector read the OAuth client id and secret? | `google-oauth-client-id` |
| 4 | Default Gmail track budget; what happens beyond it? | `25 threads` |
| 5 | What does a `stage` action do; which command reads it? | `stage` |
| 6 | Where is the calendar sync state, and the key shape? | `google-calendar-state.json` |
| 7 | How long does a rejected calendar push retry; where does the file go? | `stranded/` |
| 8 | The kinds of Drive card and their promises? | `.glink.card` |
| 9 | Where is the Telegram bot token stored, under what name, with what? | `telegram-bot/` |
| 10 | What counts as a connector "new item"? | `new item` |

### Before (2026-09-25)

| # | Found | Steps | Cited | Locations |
|---|---|---|---|---|
| 1 | yes | 3 | google-setup.md#2. Enable APIs | 1 |
| 2 | yes | 13 | server/boxes.md#Connector secrets (the carve-out sentence) | 2; the home, google-setup.md#5, has no heading naming tokens |
| 3 | yes | 3 | google-setup.md#4 | 1 |
| 4 | yes | 3 | gmail-setup.md#Automatic rules | 1 |
| 5 | yes | 3 | gmail-setup.md#Automatic rules | 1 |
| 6 | yes | 3 | calendar.md#Config and state | 1, wrong (stale path) |
| 7 | yes | 3 | calendar.md#Failure and recovery | 1 |
| 8 | yes | 8 | google-drive.md#CLI Commands | the home is the intro above any heading |
| 9 | yes | 3 | telegram-setup.md#4 | 3: also connectors.md#Configuration, secrets.md |
| 10 | yes | 3 | connectors.md#Activity record | 1 |

### After (2026-09-25)

| # | Found | Steps | Cited | Locations |
|---|---|---|---|---|
| 1 | yes | 3 | connectors/google-auth.md#Enable APIs | 1 |
| 2 | yes | 4 | connectors/google-auth.md#Where tokens live | 1 |
| 3 | yes | 4 | connectors/google-auth.md#Create OAuth credentials | 1 |
| 4 | yes | 3 | connectors/gmail.md#Automatic rules | 1 |
| 5 | yes | 3 | connectors/gmail.md#Automatic rules | 1 |
| 6 | yes | 3 | connectors/calendar.md#State | 1, now correct |
| 7 | yes | 3 | connectors/calendar.md#Failure and recovery | 1 |
| 8 | yes | 3 | connectors/drive.md#What it is | 1 |
| 9 | yes | 3 | secrets.md#Multi-field credentials | 2: the store's name registry and the Telegram page; left |
| 10 | yes | 3 | connectors.md#Activity record | 1 |

The two slow walks (13 and 8 steps) are 4 and 3 after the headings named the
facts.

### Cross-model review of the diff (Codex, 2026-09-25)

Five findings, all applied: the calendar "State" fix was itself half wrong
(sync tokens live in the transient `.state.json`, the index file's own
`syncTokens` is written empty); the parent's configuration sentence claimed
every connector has a config file; the shared Google auth page carried a
calendar-only verify; the Telegram webhook URL is built from a server base
with the box slug removed, not `$PUBLIC_URL` verbatim; the doc-graph table
followed the moves.
