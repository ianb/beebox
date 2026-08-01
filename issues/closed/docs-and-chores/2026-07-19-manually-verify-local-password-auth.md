---
title: "Manually verify local password auth (login/setup/WS/browse + prod hardening)"
resolution: implemented
filed-by: agent
discovered-in: worktree-local-password-auth — always-on auth shipped; flows an agent can't exercise
area: callback-box
---

**Closed (boxholder-verified) 2026-07-31.** Boxholder walked the login / setup /
WebSocket-auth / browse-tooling flows and the prod-hardening step; all hold.
Nothing to reopen unless a specific auth flow regresses.

The always-on local-password-auth feature is implemented, cross-model reviewed
(twice), and green on the full doctest suite (4374/4374). What automated tests
**cannot** cover — the real browser flows, a live WebSocket auth upgrade, browser
tooling against an authed box, and real-Google coexistence on prod — needs you.
Do not clear this until you've walked it. Design + review:
[../../callback-box/docs/implemented-plans/local-password-auth.md] (and `.review.md`);
origin: [../closed/features/2026-07-16-local-password-auth-default-on.md].

Fastest path: run a local dev serve with no `~/.cb-auth.json` and no
`CB_ALLOW_UNAUTHENTICATED`, then work down the list. Items 1–7 are local; item 8
is post-deploy.

1. **Fresh box forces setup.** Open the dev box. → Redirected to a login wall;
   the server console prints `First-run setup: …/auth/setup?token=…`; opening it
   shows the account form with the "why" copy. Create the owner → logged in.
2. **Password login.** Log out, log back in. → Success redirects to `returnTo`.
   Wrong password → inline "Invalid credentials". Hammer it → 429 with a retry
   countdown.
3. **Setup self-disables.** Revisit `/auth/setup?token=…` after an account
   exists → 410. Restart, wait 15+ min, reuse the old token → 410 (expired).
4. **`gen` revocation.** Log in on two browsers; run `cb auth set-password` →
   both are logged out on the next request. (This is the fix that was broken at
   the hub and is now covered — worth confirming end to end.)
5. **Open-mode opt-out.** Start with `CB_ALLOW_UNAUTHENTICATED=1` → loud boot
   warning + persistent non-dismissible banner on every page, no login needed.
   `=1` on a non-loopback bind → startup refuses; `=network` → serves open with
   the warning.
6. **Browse/tour tooling.** With auth on, `bin/browse open /<box>/…` against the
   running box → reaches the page (agent token injected), not the login wall.
7. **WebSocket auth.** While logged in via cookie on a standalone serve, open a
   box page using live chat/subscriptions → the WS connects and streams (the
   raw-`IncomingMessage` cookie path).
8. **Prod hardening (after merge/deploy).** Create the prod owner account
   (`cb auth create-user`); confirm Google login still works alongside it and
   that existing Google sessions were not invalidated.

If anything misbehaves, that's a bug to file/fix; if it all holds, clear the
`needs: [manual-testing]` flag here.
