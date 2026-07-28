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
