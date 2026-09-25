---
title: "The admin page is one long scroll of 14 sections, with no structure and no addresses an agent can point at"
workstream: admin-structure
area: beebox
labels: [admin, ui, agent-surface]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder working in admin
resolution: implemented
---

> Closed 2026-09-25 on `worktree-admin-structure` (commits `10a492c13`,
> `2380b35ad`, `997ddb225`). Implementation matches the "Decision and
> implementation" section below: five pill tabs with Overview default, live
> per-section status, one section registry
> (`beebox/src/frontend/src/components/admin/admin-sections.ts`) driving scope
> badges, `bbx-admin-<section>` region landmarks, and `?tab=<tab>` deep links.
> The related Secrets internal-disclosure gap
> (`../bugs/2026-09-21-granting-an-existing-key-to-a-box-is-hidden-and-unguided.md`)
> is untouched and stays open.

The boxholder: "the admin page is very large and needs organization, sub-tabs
or something. Also should be labeled for the AI."

## What is there now

`beebox/src/frontend/src/pages/AdminPage.tsx` renders 14 sections in one
column, split only by two `ScopeHeading` labels — "This box" (6 sections) and
"Host and shared access" (8 sections). The sections behind them total about
3,100 lines across 22 files. Everything is mounted at once and reached by
scrolling; the page has no navigation of its own.

Finding a control means knowing which of the 14 sections owns it. Several are
large in their own right: Secrets alone is 8 files, and it has already grown
its own internal disclosure for the advanced case
([grant flow](../../bugs/2026-09-21-granting-an-existing-key-to-a-box-is-hidden-and-unguided.md)),
which is a section solving the page's problem locally.

## The second half is not cosmetic

"Labeled for the AI" means an agent should be able to name a part of this page
and point the boxholder at it. Today it mostly cannot. The `bbx-` id
convention exists and is what `bin/browse` and the in-app pointer resolve
against (`beebox/src/frontend/src/lib/ui-scan/`), but on this page the ids are
on *leaf controls* — buttons, links, fields — and not on the sections:

    AllowedEmailsSection   3 bbx- ids      TelegramSection   0
    ClaudeCodeSection      4               BackupSection     0
    CodexSection           5               SecretsSection-box/-forms/-guide/-machine   0 each
    GmailFiltersSection    7

So an agent can say "press this button" but cannot say "the Backup section" or
"the Telegram section" at all, and an instruction like "go to admin, find
Notifications" has nothing to resolve. The scan already models `region` as a
landmark role when it carries an accessible name
(`lib/ui-scan/roles.ts`), so the mechanism exists; the sections simply do not
use it.

## Why the two halves are one issue

Whatever structure gets chosen — sub-tabs, an in-page nav, collapsing
sections — creates the names. A tab called "Connections" is both the thing a
boxholder clicks and the thing an agent says. Deciding the grouping first and
bolting ids on afterwards will produce two vocabularies for one page, which
is the drift the repo's standing preference warns about.

## What has to be decided

- **The grouping.** The current two scopes (this box / host and shared) are a
  real distinction and may or may not survive as the top-level split. Some
  sections are per-box settings, some are machine-wide accounts, some are
  one-time setup a boxholder touches once.
- **Sub-tabs versus something else.** Tabs hide state: a boxholder who does not
  know Telegram is configured under a tab may not look. Collapsed sections keep
  everything findable by scrolling but do not shorten the page much. The
  workspace already has a tab primitive, so reusing it is cheap — check what it
  gives up on a phone first, where this page is already cramped.
- **Whether every section needs a stable address, or only the ones an agent
  would plausibly name.** Every section is the simple rule and the one that
  does not need revisiting.
- **Deep links.** If a section has an address, a URL that opens the page with
  that section selected follows naturally, and an agent could hand the
  boxholder a link rather than directions.

Related: [card chrome has no bbx- ids](../../features/2026-08-23-card-chrome-controls-have-no-bbx-ids.md)
is the same gap on a different surface.

## Decision and implementation (2026-09-25, worktree-admin-structure)

The boxholder chose tabs, styled as pills so they do not read as the
workspace's own tab strip, with a default Overview tab that shows what each
tab holds and each section's current state. The grouping is by what the
boxholder is doing rather than by scope, since scope did not split cleanly
(Notifications is per device; Allowed users and Invite are per box but sat
under "Host"; Google, Secrets, and Cloudflare are mixed):

| Tab | Sections |
|---|---|
| Overview | one row per section: title, scope badge, live status, blurb |
| Agents | Agent engine and model, OpenRouter models, Claude Code, Codex |
| People | Allowed users, Invite link |
| Connections | Google services, Gmail filters, Telegram, Secrets, Cloudflare publishing |
| Host | Tailscale, Backup, Notifications |

Scope stays visible as a badge on every section heading ("This box", "Whole
host", "This device", "Host and box").

Addresses, all from one registry (`components/admin/admin-sections.ts`):
tabs `bbx-admin-tab-<tab>`, panels `bbx-admin-panel-<tab>`, sections
`bbx-admin-<section>` as a named `region` whose name is the heading, overview
rows `bbx-admin-overview-<section>`. Deep links: `/<box>/admin?tab=<tab>`, and
the existing `?reconnect=google` opens Connections and scrolls to Google.

Every panel stays mounted; only the open one is shown. That keeps configured
state and the hang probe's per-section breadcrumbs unchanged on every load.
