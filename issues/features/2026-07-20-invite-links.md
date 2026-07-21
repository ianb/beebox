---
title: "Invite links: add a member without sharing a password"
needs: [design]
area: callback-box
filed-by: agent
discovered-in: worktree-open-source-readiness — launch-readiness conversation with the boxholder
labels: [soft-launch]
---

Today adding a member means the operator runs `cb auth add-user` and hands
the person a password out of band. The boxholder wants to invite people
(family, collaborators — not developers) without sharing a credential.

Shape: the owner mints a one-time invite URL (CLI and/or admin UI); the
invitee opens it and sets **their own** password. No external service, works
on loopback/Tailscale, and it's a thin extension of machinery that exists:
first-run setup already does exactly token-URL → create-account
(`src/webapp/routes/auth.ts`, 15-minute TTL, self-disabling route). An
invite token is the same pattern scoped to "create one member account."

Alternatives considered and rejected (boxholder, 2026-07-20):

- **GitHub OAuth** — first members are developers, but their invitees
  ("collaborators") aren't GitHub users. Rejected.
- **Tailscale identity** (tailnet membership = logged in) — "feels like
  it's inviting foot guns." Rejected.
- **Generic OIDC** — moves setup burden onto the operator; not this cut.
- **Google OAuth** — already exists as the optional extra; unchanged.

Design notes: single-use, short-TTL tokens; the invite carries the email
(or the invitee enters it — decide); pairs with
[web password change](2026-07-20-web-password-change.md) for the full
no-password-sharing lifecycle. Mind the same throttling/enumeration
discipline the login surface already has.

Launch-adjacent, not a gate
([soft-launch posture](../decisions/2026-07-20-soft-launch-posture.md)).
