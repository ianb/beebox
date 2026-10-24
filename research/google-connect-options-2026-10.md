# Connecting Google without a Cloud Console afternoon: brokers, shipped clients, and non-OAuth paths

*2026-10-24. Companion to [google-auth-connect-approaches](google-auth-connect-approaches.md)
(July), which this note partly supersedes: the July note had no verification
evidence for any broker and preferred Nango, which was then built and rejected
([record](../issues/closed/decisions/2026-07-28-nango-google-auth-broker.md)).
Prompted by the boxholder reconsidering Composio because Google OAuth setup is
too hard for ordinary people. Level: discuss. Web research only; no sign-ups,
no live test. Three parallel research passes (brokers; newer entrants;
Google policy and non-broker paths), evidence in the last section.*

## The question, restated

Today a box operator creates a Google Cloud project, enables four APIs,
configures a consent screen, creates an OAuth client with a registered
redirect URI, stores two credentials, and then clicks through "Google hasn't
verified this app" for the restricted scopes the box asks for
(`gmail.readonly`, `gmail.compose`, `drive`). If they followed the doc and left
the consent screen in Testing, the grant dies every seven days. On two
production boxes this month a Google API that was never enabled in the
operator's own project stalled jobs until the operator found the Cloud
Console page. Every one of those steps is a BYO (bring-your-own-client) cost.

Only three things remove the Cloud Console entirely: a verified OAuth app that
someone else owns (a broker), a verified OAuth app that this project owns and
ships, or not using OAuth at all. This note weighs all three.

## Google policy facts that bound every option (official pages, 2026-10)

- Scope classes. Restricted: `gmail.readonly`, `gmail.modify`, `gmail.compose`,
  `mail.google.com`, `drive`, `drive.readonly`. Sensitive: `gmail.send`,
  `spreadsheets`, `calendar.*`, `documents.*`. Non-sensitive: `drive.file`,
  `gmail.labels`. The box asks for three restricted scopes.
- Testing status: 100 listed test users; every grant and refresh token expires
  seven days after consent. Production, unverified: the interstitial, and a
  lifetime cap of 100 users who have seen it, never resettable. Only
  `openid`/`email`/`profile` apps are exempt.
- The app owner's own account gets the interstitial too. Google's Apps Script
  verification table says the unverified flow applies to "Any Gmail account,
  including the account used to publish the app"; no page grants OAuth-client
  owners an exemption.
- Verification is per project, not per client type. A Desktop (loopback)
  client removes redirect-URI registration and the secret's confidentiality,
  nothing else.
- Internal user type (no interstitial, no cap) needs a Cloud Organization,
  which needs Workspace or Cloud Identity on a domain the operator owns. An
  existing `@gmail.com` mailbox cannot become Internal.
- Restricted-scope verification: brand review, scope justification, demo
  video, privacy policy, and, when restricted data is stored or transmitted
  through servers, a CASA assessment by a Google-empanelled lab every twelve
  months. Lab prices (2024-2025): Tier 2 from about $540 (TAC Security) to
  $1,200; Tier 3 $4,500 to $8,000. Google's own range is "$500 to $4,500".
  The free self-scan path appears to be gone; no primary source confirms
  either way.
- Shipping client credentials: Google says never commit a client secret to a
  public repository, but for installed apps the client ID and secret are
  embedded in source and "the client secret is obviously not treated as a
  secret." A Desktop-type client embedded in a distributed app is tolerated as
  a public client. OAuth clients idle for six months are deleted.
- No 2026 change to the unverified-app rules was found. Google's own new
  Workspace CLI (`gws`) is BYO with a Desktop client and tells users to add
  themselves as test users; Google ships no shared client for its own tool.

## The one fact: is any broker's shared Google app verified?

No broker states it for Gmail and Drive except Truto. The evidence by
candidate:

| Broker | Shared Google app verified for restricted scopes? | Evidence |
|---|---|---|
| **Composio** | Implied yes for Gmail, not stated. Not for full Drive. | Managed Gmail app grants `https://mail.google.com/` (full mailbox, restricted) to strangers; their May 2026 incident disclosure counts thousands of connections, so the app cannot be under a 100-user cap. Managed Drive app is `drive.file` only; the full `drive` scope "may require the `drive` scope on the customer's Google OAuth app." Docs still carry an "App is blocked" FAQ for added scopes. |
| **Pipedream Connect** | Implied yes, not stated. | Shared Gmail client requests `gmail.modify`, `gmail.compose`, `gmail.send`, `gmail.labels`, `gmail.settings.basic`; shared Drive client requests full `drive`. Both restricted, served to arbitrary external users. No `gmail.readonly` on the shared client. |
| **Arcade** | Unknown; default app is not for strangers. | Default app lists Gmail read/compose/send/modify and `drive.file`, but "can only be used with the Arcade user verifier": every end user must hold an arcade.dev account in the project. "For production use, we strongly recommend creating your own Google OAuth provider." |
| **Nango** (cloud or self-hosted) | **No shared Google app at all.** | "Nango doesn't provide a test OAuth app for Google yet." Its Google guide spells out the 100-user cap, the 7-day expiry, and CASA via TAC at $540-$720. Unchanged since the July rejection. |
| **Paragon** | No; "development keys" only. | "Leaving the Client ID and Client Secret blank will use Paragon development keys." Sales-priced (about $30k/yr reported). |
| **Truto** | **Yes, stated:** "Our Google OAuth app is live and CASA Tier 2 certified" (2025-12-24). | Scopes are read-only or non-destructive (Gmail read + modify, Drive read-only, Calendar, Docs). $10/connection/month on the Google page, but the main pricing page starts at $999/connector/year with a ten-connector minimum, and Gmail onboarding is reviewed by use case. B2B. |
| Klavis, Scalekit, Auth0 Token Vault, Descope, Keycard, Unified.to, Apideck | No; all BYO client. | Each requires the customer's Google client; Auth0 even restates the 100-login limit. |
| Zapier MCP, n8n Cloud, Make, Activepieces cloud | Yes (long-standing verified apps), but no token access and action catalog only. | Zapier staff deflected a user asking to ride their verification. Self-hosted n8n is BYO with the same caveats. |
| Latchkey (Imbue) | Not OAuth. | A local CLI that captures browser-session cookies/tokens; no app, no interstitial, fragile and terms-adjacent. |

What this settles: the auth-only brokers (Nango, Arcade in production, Scalekit,
Auth0, Keycard) all hand the verification problem back to the operator. The
two brokers whose shared apps evidently pass restricted-scope review for
strangers at hobby prices are Composio and Pipedream, and both withhold the
raw Google token on that shared app:

- Composio, since the May 2026 incident: "APIs no longer return
  connected-account tokens"; reading connected-account state "is not a
  supported token-export workflow." Google calls go through Composio tools or
  its Proxy Execute endpoint.
- Pipedream: "Retrieve user credentials" is unavailable with Pipedream's
  client and available only with a custom (BYO) client; the shared client
  supports only its prebuilt actions and its API proxy.

So the "token source, not tool layer" shape the September issue proposed does
not exist for either verified broker. The available shape is "broker as
proxy": every Gmail, Calendar, and Drive request from the box goes through
the broker's servers with the broker's token. That is Level B of the
[policy-proxy issue](../issues/features/2026-07-28-google-auth-policy-proxy.md),
not Level A.

What remains unsettled, and how to settle it in fifteen minutes (boxholder
only; it needs accounts):

1. Create a throwaway Google account (not a Workspace account).
2. Sign up for Composio Hobby (free). In the dashboard, create a Gmail auth
   config with Composio-managed auth and default scopes; generate a Connect
   Link.
3. Open the link in a private window signed in as the throwaway account.
4. Record the consent screen: the requesting app name, the scope list, and
   whether an "unverified app" or "Access blocked" page appears.
5. Repeat for Google Drive (managed) and Google Calendar (managed).
6. Optional: the same on Pipedream Connect's demo app.

Outcomes: a clean consent screen under the broker's name confirms the
implied verification and makes the proxy shape viable as an opt-in mode. An
interstitial or block closes the broker route entirely; the remaining paths
are the shipped verified client and the non-OAuth paths below.

## Every option, on the same axes

"Steps" counts what a non-technical person does after the box is running.
"Custody" says where the refresh token or equivalent lives and who sees API
traffic. Cost is for one family box (one to five accounts, roughly 2,000 to
20,000 Google calls a month).

| Option | Custody | Interstitial | Steps | Self-host | Cost | Lock-in | Box code change |
|---|---|---|---|---|---|---|---|
| **BYO web client (today)** | Box holds secret and tokens; traffic direct to Google | Yes, including the owner; 7-day expiry if left in Testing | ~12 plus per-API enablement | n/a | $0 | None | None |
| **BYO Desktop client** | Same | Yes | ~10 | n/a | $0 | None | Loopback redirect must land on the user's machine, not the box; awkward for a server-hosted box |
| **Workspace Internal app** | Box | No | ~15 plus mail migration | n/a | $7/user/month plus a domain | Google | None, but useless for an existing `@gmail.com` mailbox |
| **Composio managed (proxy)** | Composio holds the token; every call transits Composio; logs kept unless Zero Data Retention add-on | Probably no (untested) | ~3: open link, sign in, allow | No (enterprise only) | Hobby $0 up to 20K managed-app calls/month, hard stop; Pro $29/month | Tool catalog or Proxy Execute; MCP yes | Transport swap in `createAuthedApi` to Proxy Execute; connect flow; connection id instead of tokens. Drive by URL breaks: managed app is `drive.file` only |
| **Pipedream Connect (proxy)** | Pipedream holds the token; calls transit Pipedream | Probably no (untested) | ~3 | No | Free for development only; external users in production need a paid plan (~$99/month annual) | Actions or API proxy; MCP yes | Same transport swap. Shared client grants `gmail.send`, which the box today deliberately lacks |
| **Arcade** | Arcade vault; raw token available to developer | Unknown | Every family member needs an arcade.dev account | Enterprise only | Free 2K auth events + 2K calls; Team $25 + $0.01/call | Low | Seam swap would work, but the user model does not fit a family |
| **Nango self-hosted** | Operator's infra | Yes (operator's own app) | Same ~12 | Yes (Auth+Proxy) | $0 | Low | Removes nothing the user feels; rejected in July |
| **Truto** | Truto proxy | No (stated) | ~3 | No | $10/connection/month claimed; B2B minimums and a use-case review | Unified API | Not reachable for a hobby operator |
| **Project-shipped verified client** | Box holds tokens; traffic direct to Google; the project is the accountable app owner | No | ~3 | n/a | CASA about $540 to $4,500 per year plus weeks of review, annually | Google; shared per-project quota across every box | Ship a client ID (Desktop type to avoid a secret); loopback redirect problem as above, or a Web client with a public secret |
| **Gmail IMAP/SMTP, app password** | Box holds a password equal to full mailbox access; traffic direct to Google | No | 3 to 5: turn on 2-Step Verification, create an app password, paste it | n/a | $0 | None | New Gmail backend over IMAP/SMTP reusing the MIME and threading path; labels are IMAP folders; drafts via append; send via SMTP |
| **Gmail forwarding filter** | Box receives mail at its own address | No | 3 | n/a | $0 (needs the box mailbox) | None | [Filed](../issues/features/2026-10-08-gmail-forwarding-as-the-read-path.md); new mail only, read only |
| **Calendar secret iCal address** | Box holds a URL | No | 2 | n/a | $0 | None | Read-only `.ics` poll; no writes, one URL per calendar |
| **Apps Script bridge** | Script runs in the user's account; box holds a webhook token | Yes, even for the owner | ~8 | n/a | $0; 90 trigger-minutes a day, 100 recipients a day | None | New push intake; the user must trust visible script code |
| Drive share links, Takeout, Data Portability API | Box | No | per file | n/a | $0 | None | Read-only snapshots; Data Portability covers no Gmail/Calendar/Drive |

Facts behind a few cells:

- Composio's May 2026 incident (disclosure 2026-05-21, updated 2026-09-16):
  an attacker reached an auxiliary credential cache through compromised
  employee Gmail OAuth tokens and leaked 5,241 API keys and about 0.3% of
  active connections, including 12 Gmail and single Calendar, Drive, Sheets
  connections. Remediation claimed: envelope encryption, SOC 2 Type II,
  third-party audits, no more token export.
- Composio managed auth polls triggers at a 15-minute minimum and shares one
  quota across all Composio users. The Hobby cap of 20K managed-app calls a
  month is about one call every two minutes; three connectors polling every
  five minutes exceed it.
- Gmail app passwords: IMAP is always on for personal accounts since January
  2025; app passwords need 2-Step Verification, are revoked when the account
  password changes, are unavailable with security-key-only 2SV or Advanced
  Protection, and Google calls them "not recommended". No shutdown is
  announced for consumer accounts; Workspace's 2025 basic-auth cutoff
  explicitly excepted app passwords. CalDAV is OAuth-only; app passwords do
  not reach Calendar.
- Thunderbird and rclone are open-source projects that ship a verified
  Google client for restricted scopes in their source. Whether a verified
  project may ship a client that strangers run on their own servers, with the
  project never touching the data, is not addressed by any Google page; a
  sibling project's analysis is linked below. CASA attaches to storing or
  transmitting restricted data on servers; whose servers count is Trust and
  Safety discretion.

## Which non-Google connectors each route would make easy

- Composio managed OAuth: Dropbox, Todoist, TickTick, Splitwise, YNAB,
  Outlook, Box, GitHub, Notion, Slack, Discord. Not Spotify (own app), not
  Raindrop (API key only), no Fitbit toolkit.
- Pipedream: the broadest catalog (Dropbox, Todoist, Strava, Fitbit, Spotify,
  Outlook, Box, YNAB, Splitwise, Raindrop), but behind the same no-token
  rule and paid production tier.
- Arcade: Dropbox, Outlook, Box, TickTick, GitHub, Notion, Slack; Spotify and
  Reddit need an own app; no Raindrop, Splitwise, YNAB, Strava, Fitbit,
  Todoist.
- Non-OAuth paths: none. Each service is its own protocol.
- Shipped verified client: Google only; other providers' verification is
  lighter and would be separate shipped clients.

## Dispositions

- **Reject Nango, Arcade, Paragon, Truto, and the auth-only brokers** for
  this problem. None removes the interstitial for a stranger at family scale
  without the operator owning a Google client (Truto does, at B2B prices and
  gating). The July Nango record stands and is now in the tree.
- **Hold Composio as the one broker candidate, pending the fifteen-minute
  test.** It is the only broker that is free at family scale, open to
  strangers, and runs a restricted Gmail scope on its shared app. If adopted
  it is an opt-in proxy mode with disclosure, not a token source: the box
  routes Google traffic through Composio, Composio's log retention applies,
  the shared Drive app cannot sync Drive files by URL, and a 2026 breach is
  on record. Pipedream is the cleaner-scoped alternative but withholds
  tokens equally and prices production out of hobby range.
- **Adopt the non-OAuth read paths for Gmail and Calendar** as the
  ordinary-person route that needs no Cloud Console and no third party:
  Gmail over IMAP/SMTP with an app password (full history, labels, drafts,
  send; three to five steps), forwarding for near-real-time new mail
  ([filed](../issues/features/2026-10-08-gmail-forwarding-as-the-read-path.md)),
  and the secret iCal address for read-only calendars. Filed:
  [gmail-over-imap-app-password](../issues/features/2026-10-24-gmail-over-imap-app-password.md).
  Calendar writes and Drive still need OAuth; those are the smaller share of
  a family box's use.
- **Adapt the BYO path for the people who still take it.** Two of the worst
  costs are self-inflicted and cheap to fix: the doc tells operators to stay
  in Testing (hence the 7-day expiry), and a disabled API surfaces as a stall
  instead of a link. Both are items in
  [byo-google-oauth-self-host-story](../issues/decisions/2026-07-28-byo-google-oauth-self-host-story.md);
  the API-enable deep link can ride the existing `SERVICE_DISABLED`
  classification in `beebox/src/google/api-error.ts`.
- **Later: a project-shipped verified client** is the only route that gives
  both three-click setup and tokens on the box with traffic direct to Google.
  It costs CASA money and paperwork every year, makes the project the
  accountable app owner for every stranger's grant, shares one quota across
  all boxes, and its policy standing for self-hosted installs is unsettled.
  It becomes worth pricing when beebox has a public audience installing it,
  not before.

## Decisions for the boxholder

1. **Custody versus ease, for Google.** Allow an opt-in "connect through
   Composio" mode? Outcome yes: a family member connects Gmail in three
   clicks and all their mail traffic transits a third party that was
   breached this year; Drive sync by URL is lost in that mode. Outcome no:
   Google stays BYO plus the non-OAuth paths. Lean: no, until the
   fifteen-minute test shows a clean consent screen and the non-OAuth paths
   prove insufficient.
2. **Gmail without OAuth.** Accept an app password (a credential equal to the
   mailbox password, stored on the box) as the ordinary-person Gmail path?
   Outcome yes: no Cloud Console, no interstitial, history and send included.
   Outcome no: Gmail stays OAuth or forwarding-only. Lean: yes; the box
   already holds a refresh token of equal power, and custody is unchanged.
3. **Be the app owner, someday.** Is there a public audience worth about
   $540 to $4,500 a year and an annual review to ship a verified client?
   Lean: not yet; revisit with the installable-app work.

## Evidence

Composio: toolkit page `docs.composio.dev/toolkits/gmail`; managed versus
custom `docs.composio.dev/docs/authentication/custom-app-vs-managed-app.md`;
token custody `docs.composio.dev/docs/security/token-custody.md`; Drive KB
`docs.composio.dev/kb/guide/toolkits-googledrive.md`; blog
`composio.dev/blog/ship-gmail-integration-in-minutes` (2026-09-30); incident
`composio.dev/blog/composio-may-2026-security-incident`; pricing
`composio.dev/pricing`; self-hosting `support.composio.dev/m/1340459156334837791`.

Arcade: `https://docs.arcade.dev/home/auth-providers/google`;
`https://docs.arcade.dev/en/home/auth/secure-auth-production`;
`https://docs.arcade.dev/en/home/auth/call-third-party-apis-directly`;
`arcade.dev/pricing`.

Pipedream: `pipedream.com/apps/gmail`, `pipedream.com/apps/google-drive`,
`pipedream.com/docs/connect/oauth-clients`.

Nango: `nango.dev/docs/api-integrations/google`,
`nango.dev/docs/api-integrations/google-shared/google-security-review`,
`nango.dev/pricing`.

Paragon: `docs.useparagon.com/resources/integrations/gmail`. Truto:
`truto.one/blog/our-google-oauth-app-is-live-and-casa-tier-2-certified/`,
`truto.one/google/`, `truto.one/pricing`. Others: Scalekit
`docs.scalekit.com/agentkit/connectors/gmail.md`; Auth0
`auth0.com/ai/docs/connections/google`; Keycard
`docs.keycard.ai/admin/catalog/api-servers/gmail`; Apideck
`developers.apideck.com/connectors/gmail/docs/application_owner+oauth_credentials`;
Zapier thread `community.zapier.com/general-discussion-13/...-50950`; n8n
`docs.n8n.io/integrations/builtin/credentials/google/oauth-single-service/`;
Latchkey `docs.imbue.com/latchkey`.

Google policy: scopes `developers.google.com/workspace/gmail/api/auth/scopes`,
`developers.google.com/workspace/drive/api/guides/api-specific-auth`,
restricted list `support.google.com/cloud/answer/13464325`; publishing status
`support.google.com/cloud/answer/15549945`; user cap
`support.google.com/cloud/answer/13463817`; exceptions
`support.google.com/cloud/answer/13464323`; verification
`developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification`;
CASA `support.google.com/cloud/answer/13465431`, `appdefensealliance.dev/casa`,
lab prices `switchlabs.dev/post/casa-tier-2-tier-3-security-review-providers-pricing-and-the-cheapest-option`;
credential policy `developers.google.com/identity/protocols/oauth2/policies`,
installed apps `developers.google.com/identity/protocols/oauth2`, native
`developers.google.com/identity/protocols/oauth2/native-app`; Apps Script
`developers.google.com/apps-script/guides/client-verification`, quotas
`developers.google.com/apps-script/guides/services/quotas`; app passwords
`support.google.com/accounts/answer/185833`, IMAP
`support.google.com/mail/answer/7126229`; forwarding
`support.google.com/mail/answer/10957`; iCal address
`support.google.com/calendar/answer/37648`; CalDAV
`developers.google.com/workspace/calendar/caldav/v2/guide`; Workspace pricing
`workspace.google.com/pricing`; `gws` CLI `github.com/googleworkspace/cli`;
shared-client analysis by another project
`github.com/JarvusInnovations/gws-axi/blob/HEAD/docs/shared-client-future.md`.
