---
title: "Set up connectors through Composio's managed auth — connect Google in two clicks instead of a Cloud Console afternoon"
workstream: unattached
area: beebox
priority: normal
labels: [connectors, google, auth]
filed-by: agent
discovered-by: Ian
discovered-in: main session — "Getting an OAuth account with Google and all that jazz to connect seems like a pain, would that solve it?"
---

Connecting Google today means the operator creates their own Cloud project,
consent screen, and OAuth client, registers the redirect, sets two env vars,
and then clicks through Google's "unverified app" interstitial for restricted
scopes (Gmail, Drive) — see
[google-oauth-pairing-broken](../bugs/2026-07-28-google-oauth-pairing-broken.md).
Bring-your-own is the right architecture for a self-hosted box, but it is an
afternoon a stranger will not spend.

The ask: let a box set up connectors through
[Composio](https://composio.dev)'s managed auth. The user clicks "connect
Google" and Composio's session runs the OAuth flow, holds the grant, and
refreshes it; the box reads an access token per request and its connectors
stay as they are. The boxholder's position: "it works, which is the point";
the privacy cost (tokens and every API call through a third party, logs
retained 7–90 days by tier) is a disclosed opt-in, not a default — it goes in
the "what leaves your machine" section next to Google OAuth.

## First step, before any code

Confirm the one fact that decides it: **is Composio's managed Google app
verified for restricted scopes**, so a user never sees the interstitial or the
100-user cap? Nothing public says so. Test on their free tier with a throwaway
Google account: connect Gmail and Drive through a Composio-managed app and see
whether the warning appears. If it does, Composio is only a token holder with a
tool catalog attached, and the question closes.

## Shape, if it passes

- **Token source, not tool layer.** Composio holds the grant; the box asks it
  for the current access token and calls Google itself. The connectors do not
  move onto Composio's tool catalog. This is the slot the unmerged
  `nango-google-auth` worktree already carved (six commits: Nango owns the
  grant, `NANGO_SECRET_KEY` switches the mode, an allowlisted child env) —
  reuse that seam or replace Nango with Composio in it; do not build a second
  one.
- **Optional, beside direct mode.** Direct BYO OAuth stays the default and the
  documented self-host path
  ([byo-google-oauth-self-host-story](../decisions/2026-07-28-byo-google-oauth-self-host-story.md)).
  One secret (a Composio API key in the secret store) turns the mode on, the
  same one-key-no-config rule the OpenRouter work follows.
- **Pricing as of 2026-08:** free tier 100K tool calls/month with unlimited
  connected accounts; Composio-managed apps get 20K of those free, then
  $0.0005 per call; Pro $29/month. A family box's connector traffic is far
  below the free tier.
- **Disclosure.** Admin shows which mode a connector is on; the security
  report's egress table and the front door's "what leaves your machine" gain a
  line for it.

## Which connectors it would actually help (surveyed 2026-09-06)

Checked ~130 services against Composio's catalog (their site 404s on an
unknown toolkit, so a miss is real) and read one toolkit's auth block
(Dropbox: OAuth2 with Composio-managed auth offered).

- **Already connected in beebox, OAuth setup removable:** Gmail, Google
  Calendar, Google Drive, Sheets, Docs, Dropbox, Raindrop.
- **New connectors it would make cheap, personal-box value:** Splitwise,
  YNAB, Strava, Fitbit, Todoist, TickTick, Outlook and Box for non-Google
  people. Struck after a closer look (boxholder, 2026-09-06): Google Photos
  (since 2025 the Library API sees only app-uploaded media; the Picker API
  is user-driven selection, so "ingest my library" is not available through
  anyone), YouTube and Reddit (not interesting).
- **Not Composio's, but came up:** Instacart's toolkit is the API-key
  Developer Platform — it creates shopping lists and recipe pages that open
  in Instacart, not orders from your account; a fine direct trick for a
  family box ("this week's recipes → one list"), no OAuth to remove. Bank
  transactions: Composio has no aggregator (no Plaid, Teller, MX, Finicity,
  SimpleFIN, Akoya); for a personal box the direct answer is SimpleFIN
  Bridge (consumer-priced, API key), or the statement PDFs and emails the
  scanner and Gmail paths already carry. Weather: absent, irrelevant —
  Open-Meteo and `api.weather.gov` are keyless and the tricks already call
  them.
- **Present, low value for a box:** Facebook, Instagram, LinkedIn,
  Pinterest, TikTok (business-oriented APIs), Telegram and Discord (bot
  tokens; no OAuth pain to remove), Trello, Asana, Linear, Jira, Zoom,
  Calendly, Coinbase, QuickBooks.
- **Absent:** TMDB, OMDb, Open Library, Letterboxd, Trakt, Goodreads,
  weather APIs, Home Assistant, Hue, Nest, Sonos, Apple (iCloud, Reminders,
  Health), Garmin, Oura, Withings, Plaid and banks, Obsidian, Bear, Things,
  Zotero, Pocket, Readwise, Signal, iMessage. The movie and book databases
  the boxes use today are keyless or API-key and stay direct.

So the scope is OAuth consumer platforms only: the Google set plus Dropbox
and Raindrop now, and the second group as the connectors it unlocks.

