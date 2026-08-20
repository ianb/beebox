---
title: "No web password reset / account recovery — a member who forgets their password is stuck"
workstream: unknown
area: callback-box
labels: [soft-launch]
resolution: implemented
filed-by: agent
discovered-in: main session — boxholder asked whether password reset works over the web
---

Implemented by `68c5e537`: owners can mint a short-lived reset capability for
an existing allowed member from Allowed Users, and the member chooses a new
password without exposing it to the owner. Successful redemption revokes old
sessions and returns the member to ordinary login; email self-service remains
intentionally out of scope.

> **Decided (2026-08-07):** build **option 2** — an operator-driven member
> password reset that reuses the invite-link machinery: the operator mints a
> reset link (a fresh invite-style capability pinned to the member's email) and
> hands it to the member, who sets their own new password. **Option 3 (email
> self-service) is rejected** — outbound mail is operationally complex. Option 1
> (document `cb auth set-password` host recovery) is the interim floor until this
> lands.

> **Job to be done:** *When I'm an invited member of someone's box and I've
> forgotten my password, I want to get back in on my own — the way every web app
> lets me — so I'm not locked out waiting on the operator to notice my message and
> hand me a new password over chat.*

**Current state (verified 2026-08-07):**

- **Web has password *change*, not *reset*.** `src/webapp/routes/auth-password-change.ts`
  rotates a password but **requires the current password** (`verifyPassword` on
  `currentPassword`, 401 otherwise). No use to someone who forgot it. There is no
  forgot-password / reset route.
- **Recovery is host-side only.** `cb auth set-password --email <email>`
  (`src/cli/commands/auth.ts:238`) resets *any* user's password and revokes their
  sessions — but it needs **shell access to the server**.

So a **single-operator** always recovers themselves (they own the host). The gap
is **invited members**: invite links ship at launch
([invite-links](2026-07-20-invite-links.md)), so a box can now
have users who are *not* the operator. If one forgets their password, they cannot
self-serve, there is no admin-UI reset button, and the only path is: contact the
operator out-of-band → operator SSHes in → `cb auth set-password` → new password
communicated back over a trusted channel. For a launch that invites people to add
collaborators, that's a rough recovery story.

## Why it wasn't built (and the tension)

Full email-based self-service reset was explicitly deferred in the auth plan
(`docs/implemented-plans/local-password-auth.md`, NOT-in-scope: "requires outbound
mail identity; the recovery path is `cb auth set-password` on the host, which
matches the single-boxholder trust model"). That reasoning holds for a lone
operator — but invite links changed the trust model to include members who don't
have the host. The subagent breakdown of `todo-security.md` classified
"no password reset" as accept-forever on the *single-operator* reading; the
boxholder is now reconsidering it specifically because members exist.

## Options to weigh (decision first — how much lands pre-launch)

1. **Document operator-driven recovery** as the launch answer (honest-docs
   pattern): the day-to-day / SECURITY docs state plainly that a forgotten member
   password is reset by the operator via `cb auth set-password`. Cheapest; leaves
   the member dependent on the operator.
2. **Admin-UI "reset member password"** — an operator-only button in the existing
   admin user list that sets a member a fresh temporary password (or re-issues an
   invite-style link), so the operator recovers a member without SSH. Uses the
   existing invite-capability machinery
   ([web-password-change](2026-07-20-web-password-change.md) and
   [invite-links](2026-07-20-invite-links.md) are the adjacent
   pieces). Medium; keeps recovery operator-mediated but removes the shell step.
3. **Full self-service email reset** — the real thing, but needs outbound mail
   identity the system deliberately doesn't have yet. Bigger; likely a fast-follow,
   not a launch item.

**Decided (2026-08-07):** option 2 — operator-driven, invite-machinery-based
member reset; option 3 rejected (email operationally complex); option 1 is the
interim floor. This is the account-
recovery half of the same auth lifecycle that
[web-password-change](2026-07-20-web-password-change.md) and
[invite-links](2026-07-20-invite-links.md) opened; it feeds the
identity/credentials section of the
[agent-maintained security report](2026-07-20-agent-maintained-security-report.md).
