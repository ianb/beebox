---
title: "Central Google auth + policy proxy: escape-proof filtering and per-client capabilities"
area: callback-box
filed-by: agent
needs: [design]
discovered-in: main session — boxholder idea, out of the Google-auth thread
---

A standalone service that **holds the Google OAuth grant once** and re-serves it
to many boxes as **scoped, filtered, escape-proof views**. You authorize the
stable proxy against Google; individual boxes then authorize to *the proxy*, not
to Google. The proxy is both an auth broker **and** a policy-enforcement boundary
that advertises to each client exactly what it's allowed to see and do.

This is the unifying answer to the whole Google-auth thread — see "Why this ties
it together" below.

> **Direction settled (2026-07-28):** carry **Tier 1** (token custody + proxy +
> refresh) with **self-hosted Nango** rather than rebuilding auth-broker plumbing
> (Composio rejected — cloud custody + breach + lock-in; see
> [research](../../research/google-auth-connect-approaches.md)). Build only the
> **Tier 2** differentiated layer — escape-proof filtering, capability
> advertisement, per-client policy — on top. First concrete step when this is
> picked up: a **Nango self-hosted spike** wiring one Google connection through
> its auth+proxy.

## The core idea

- **One stable Google connection, many box clients.** The proxy owns the Google
  tokens; boxes hold only a credential to the proxy. Boxes come and go, migrate,
  or get rebuilt without re-doing Google OAuth.
- **Filtering at a real trust boundary.** We already do Gmail **label filtering
  inside the box** (`config/connectors/gmail.json`) — but *inside the box it is
  subject to escapes*: the agent can read/rewrite its own config and widen its
  view, because the filter lives on the same side of the trust boundary as the
  agent. Moving the filter **into the proxy** makes it escape-proof: the
  unfiltered data never crosses to the box at all. This is the key security win.
- **Advertise the view's limits to the client.** The proxy tells each client
  *exactly* what it's getting — which labels/folders are included, which actions
  are permitted — so the box can **reason within known limits** and be honest to
  the user ("I can only see mail labeled X; to change that, go here"). A client
  that knows its own blind spots is far better than one silently given a partial
  view.
- **Per-client capability policy.** Capabilities are configured per box-client
  against the shared account. E.g. **allow draft composition but not actual
  send**; read Calendar but not write; Drive read but not create. Each box gets
  a different, narrower slice.
- **Privilege separation the box can't undo.** Boxes are clients of an
  **extended protocol (a superset of Google's APIs)** — they understand the
  capability metadata and can **direct the user into the proxy's management
  screens**, but **cannot edit their own policy**. A compromised or escaping box
  can point you at where to grant more, but can't grant itself more.

## Two-tier OAuth (the box authorizes to the proxy, not Google)

There are **two distinct OAuth flows**:

- **Tier 1 — proxy ↔ Google.** The real Google OAuth, held **once** at the proxy.
  This is the *only* place Google's consent screen, restricted scopes, and
  verification/CASA burden apply. The unverified-app friction is borne here, one
  time, not per box.
- **Tier 2 — box ↔ proxy.** A **separate OAuth flow** where the proxy is the
  **authorization server** and each box is a registered client. The box "connects
  Google" by authorizing to *the proxy* — so a box never sees Google's consent or
  verification screens at all; it just gets a proxy-issued token.

This maps onto standard OAuth cleanly, which is the appeal:

- **Per-client policy = OAuth client registration + scopes** at the proxy. Each
  box's capabilities (labels it may see, draft-not-send, read-not-write) are the
  scopes of *its* proxy grant.
- **"Advertise exactly what you're getting" = scopes + token introspection.** The
  box can introspect its proxy token to learn its own view limits — the
  capability advertisement rides the same OAuth machinery, no bespoke channel.
- **Privilege separation falls out of it.** A box can *request* scopes and
  deep-link the user to the proxy's grant screen, but only the proxy admin
  approves them — the box can't widen its own token.
- **Revocation is per-box at the proxy** — kill one box's access without touching
  the Google grant or the other boxes.
- **Reuse question:** is Tier 2 a full OAuth flow, or does it reuse callback-box's
  existing session/device-token auth against the proxy? OAuth gives introspection
  + scopes for free; the device-token model is simpler but would need the
  capability-advertisement bolted on. Decide during design.

## Why this ties the whole thread together

- **Auth lifecycle** — one grant to keep alive instead of N per-box grants; the
  7-day/revocation re-auth problem
  ([google-auth-expiry-health-and-notify](2026-07-28-google-auth-expiry-health-and-notify.md))
  is handled once at the proxy, not per box.
- **BYO vs broker** — this is a **self-hosted broker with policy**
  ([byo-google-oauth-self-host-story](../decisions/2026-07-28-byo-google-oauth-self-host-story.md),
  [research on brokers](../../research/google-auth-connect-approaches.md)):
  it keeps tokens on your own infra (unlike Composio/Arcade), and adds the
  filtering + capability-advertisement that off-the-shelf brokers
  ([composio](../exploration/2026-07-09-investigate-composio-tool-layer.md))
  don't emphasize.
- **Untrusted-config / containment** — directly advances the "the box's own
  config is inside the escape boundary"
  ([config-untrusted-principle-drift](../decisions/2026-07-22-config-untrusted-principle-drift.md))
  tension by moving the enforcement out of the box.

## How much of this is just Composio/Nango? (be honest — it's a lot)

The **auth-broker core is commodity** — holding one grant, per-client connected
accounts, a token vault with refresh, a layer between agent and Google. That's
exactly what **Composio** does (SaaS) and what **Nango** does (open-source,
self-hostable). Building that plumbing ourselves would be reinventing it.

What is **genuinely different** (the part worth our own code):

1. **Self-hosted token custody.** Composio-SaaS holds your Google tokens on *its*
   cloud — the opposite of "your data, your box." Only **Nango** matches the
   self-hosted requirement, so if we adopt anything it's Nango, not Composio.
2. **Threat model: the proxy as an escape-proof boundary against an *untrusted*
   box agent.** Composio/Nango assume the calling app is the trusted principal;
   their scoping is about what the app *should* call, not defense against a box
   that tries to widen its own view. Our whole point is that the box agent can
   escape in-box config, so filtering must live on the far side of the boundary.
   That security framing is ours, not theirs.
3. **Reuse our own connectors against a Google-mirroring proxy** — not adopt
   Composio's action SDK / tool abstraction. We keep `src/connectors/` and
   repoint them; that's a different integration paradigm than "call Composio's
   actions."
4. **Capability advertisement + privilege separation** — the box introspects its
   own limited view and can direct-but-not-edit its policy. Composio exposes
   available actions to an agent; it doesn't center "here is the filtered slice
   you're allowed and you can't change it."

**So the real decision is build-vs-adopt, not build-from-scratch:** likely
*don't* rebuild the token-vault/refresh plumbing — evaluate **self-hosted Nango**
for Tier 1 + token custody, and put the callback-box-specific **policy
enforcement + capability advertisement + connector fit** on top. A thin bespoke
proxy is only justified if mirroring Google's API for our existing connectors
(§ protocol shape) turns out simpler than bending Nango to it. Fold this into
[investigate-composio-tool-layer](../exploration/2026-07-09-investigate-composio-tool-layer.md),
which is the same evaluation from the other direction.

## What supporting Nango as an option takes (the seam already exists)

The Google integration is already shaped for this — every service depends on the
tiny `GoogleAuthService` interface (`src/services/google-auth.ts`, just
`getAccessToken(): Promise<string>`), and each service (`google-calendar.ts`,
`google-drive.ts`, `google-gmail.ts`) reaches Google through one
`createAuthedApi(baseUrl, auth)` transport. So Nango is a **new implementation +
config switch**, not a rewrite. Two levels:

**Level A — Nango as token source (small; retires our OAuth/refresh):**
1. New `GoogleAuthService` impl `createNangoGoogleAuth({ nangoHost, secretKey,
   providerConfigKey, connectionId })` whose `getAccessToken()` pulls the current
   (Nango-refreshed) token from Nango's connection API. **The calendar/drive/gmail
   services are unchanged** — they depend only on the interface (this is exactly
   the services real/fake pattern; add a third real variant).
2. **Config switch** `google.mode: direct | nango` (+ Nango params) at the point
   where the auth service is constructed today.
3. **Connect flow branch** — a "connect via Nango" path (Nango Connect session →
   store the connection id) alongside the current OAuth initiate/callback
   (`admin-google.ts`, `routes/admin.ts`, `routes/auth-google.ts`).
4. **Token storage conditional** — `google-oauth-state.ts` stores a Nango
   connection ref in nango mode, not Google tokens.
5. **Reauth/health** reads Nango connection status instead of catching
   `invalid_grant` (folds into
   [reauth-health](2026-07-28-google-auth-expiry-health-and-notify.md)).
6. **Scopes/consent move to Nango's provider config** — `GOOGLE_SCOPES` + the
   box's OAuth client become direct-mode-only.
   - *Trade-off:* Level A still returns the token to the box, so it outsources
     custody/refresh but is **not** the escape boundary yet.

**Level B — Nango proxy (medium; the escape boundary / Tier 1):** route the
service HTTP through Nango's proxy so the Google token never reaches the box.
Because all traffic funnels through `createAuthedApi`, this is a **transport
variant in one helper** — map each Google base URL + path to a Nango proxy call
(the fiddly bit: calendar/gmail/drive/sheets/docs each have their own host, all
behind one Nango provider config). This is what earns the escape-proof property;
Level A is the stepping stone.

Fakes already exist (`createFakeGoogleAuth`), so service doctests are unaffected;
add a doctest for the Nango auth impl against a fake Nango.

## Design questions (large — this is a new trust anchor)

- **Where it runs + trust model.** A new always-on service beside the hub? It
  becomes the token custodian and the policy root of trust — its own auth,
  storage, and hardening story.
- **Protocol shape (NOT MCP).** Our connectors are direct integrations
  (`src/connectors/`), not MCP — so the proxy is not "an MCP server," and boxes
  consume it through the **same connector mechanisms we already have**. The
  natural shape is: the proxy **mirrors Google's own API surface** (so a connector
  changes little more than its base URL — proxy instead of `googleapis.com`),
  plus a thin **extension for the capability/limitation metadata** (the "advertise
  exactly what you're getting" part) that connectors learn to read. The
  "superset of Google's protocols" the boxholder described *is* Google's API +
  that capability layer. (MCP could be a separate, optional external exposure
  later, but it's not the mechanism boxes use here.)
- **Capability grammar.** How to express "labels X,Y read-only", "draft-not-send",
  "calendar read, no write" per client, in a form both the proxy enforces and
  the client can render/understand.
- **Filtering fidelity.** Server-side Gmail query/label filters, Drive folder
  scoping, Calendar selection — what's enforceable at the API boundary vs. needs
  proxy-side post-filtering, and how to keep it leak-free.
- **Management UI.** The proxy owns config; boxes only deep-link into it (the
  privilege-separation property). Who authenticates to the management screens.
- **Migration.** Relationship to today's in-box connectors — do connectors
  become thin clients of the proxy, or does the proxy sit behind them?
- **Scope creep guard.** This is a big new component; worth scoping a minimal
  first slice (e.g. Gmail read with label filtering + draft-not-send for one box)
  before the general capability system.
