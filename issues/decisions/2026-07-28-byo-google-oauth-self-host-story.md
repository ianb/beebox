---
title: "Google auth for self-hosters: formalize the bring-your-own-Cloud-project story"
workstream: unknown
area: beebox
filed-by: agent
discovered-in: main session — boxholder asked about BYO-domain auth
needs: [decision]
---

The Google OAuth verification pain (unverified-app warning, restricted-scope
CASA assessment — see
[google-oauth-pairing-broken](../bugs/2026-07-28-google-oauth-pairing-broken.md))
is only a problem if there's a **central, shared** OAuth app. beebox
already avoids that: it's **bring-your-own**. This item is about deciding to lean
into that explicitly and smoothing it.

## It's already BYO (the mechanism exists)

- Client creds come from **`GOOGLE_OAUTH_CLIENT_ID/SECRET` env vars**
  (`connectors/google-auth.ts`) — per deployment, not baked in.
- The redirect_uri derives from the operator's own `publicUrl` / domain.
- The consent screen the user approves is **the operator's own app**, on the
  operator's domain.
- `docs/google-setup.md` already walks an operator through consent screen +
  authorized redirect URIs + setting the env vars.

So each self-hoster brings their own Google Cloud project + OAuth client + domain.
There is **no central app to globally verify** — the verification/CASA burden is
per-operator and personal-scale (a family box is ~1 user, far under the 100-user
unverified cap; CASA is never forced). This is the right architecture for a
"your data, your box" tool, and the correct answer to the verification problem:
don't be the SaaS middleman that has to pass CASA.

## The decision

Commit to **BYO-only** (no project-hosted shared OAuth app), and treat the
one-time Google Cloud setup as an accepted operator cost — vs. ever offering a
hosted/shared OAuth app (which would force mandatory CASA + a 100-user cap + make
beebox the custodian of everyone's Gmail/Drive tokens). Recommendation:
BYO-only; the alternative contradicts the project's privacy posture.

## If BYO-only, smooth it (the actual work)

1. **Set expectations in `docs/google-setup.md`** — the "unverified app" warning
   is *normal and expected* for your own personal app; click through Advanced →
   continue; you never need Google verification/CASA for personal/family use.
   Note publishing status (Production, unverified) and the 100-user cap being a
   non-issue at self-host scale.
2. **Least-privilege scopes** — trim restricted scopes where possible
   (`drive.file` instead of full `drive`, etc.) so each operator's consent asks
   for less and any *optional* self-verification is lighter. Ties to
   [boxes can't create new Google Drive docs](../features/2026-07-27-boxes-cant-create-new-google-drive-docs.md).
3. **Canonical redirect_uri** — finish the origin-derivation cleanup noted in the
   OAuth bug issue so an arbitrary BYO domain resolves to one canonical redirect
   URI (no per-origin drift to register).
4. **Optional `bbx google setup` helper** — a guided walk-through of the Cloud
   project steps (or at least a checklist the box agent can hand the operator),
   to cut the ~15-minute setup friction.

## Competitive context (2026-07-28 research)

[How comparable systems connect Google](../../research/google-auth-connect-approaches.md)
confirms this bet: **OpenClaw and the popular self-hosted Google MCP servers all
do BYO too**, and eat the same unverified-app / 7-day-token friction — it's a
universal BYO condition, not a beebox defect. The only frictionless
alternative is a **managed auth broker** (Composio/Arcade/Nango/Pipedream) that
owns the OAuth app and vaults tokens — which trades away local token custody.
Finding: keep BYO as default; consider an **opt-in broker path** (ideally
self-hostable **Nango**, which keeps creds on your infra) for convenience-first
operators. **Boxholder leaning confirmed 2026-07-28: Nango is the chosen broker**
if/when we add one (Composio rejected — cloud custody + breach + lock-in). Transferable UX ideas from OpenClaw: one plugin/one OAuth for all
Google services, chat-driven grant, and a "Desktop app" loopback client to dodge
redirect_uri registration.

## Related

- [google-oauth-pairing-broken](../bugs/2026-07-28-google-oauth-pairing-broken.md)
  — where the verification/unverified-app friction was diagnosed.
- [investigate-composio-tool-layer](../exploration/2026-07-09-investigate-composio-tool-layer.md)
  — the managed-broker option.
- Per-box secret management overlaps how creds are supplied.
