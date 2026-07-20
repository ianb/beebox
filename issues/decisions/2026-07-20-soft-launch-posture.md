---
title: "Soft-launch posture: decisions made, gates remaining"
area: docs
filed-by: agent
discovered-in: worktree-open-source-readiness — launch-readiness conversation with the boxholder
---

Record of the 2026-07-20 launch-shape decisions (all made by the boxholder in
conversation), plus the remaining gates. Open until the repo is actually shown
to people; close when the soft launch happens. Builds on
[the source-available release plan](../../callback-box/docs/plans/source-available-release.md)
(secret scan clean, PII scrub, licensing — all done 2026-07) and
[the installation story](../../callback-box/docs/plans/installation-story.md)
(phase 1 shipped, verified).

## Decisions (2026-07-20)

- **Audience**: the boxholder's network, deliberately not promoted. Visitors
  are invited to **run it**. A Claude Code subscription is assumed — that's an
  audience filter, not a gap ("someone without one won't be interested at this
  stage").
- **Deploy**: local run first-class; **one blessed deploy happy path**
  (Docker/compose + optional Caddy, Tailscale as the protect story). No
  platform matrix — for unverified environments, the sanctioned path is
  handing [the agent install guide](../../callback-box/docs/agent-install.md)
  to the user's agent and letting it reinterpret. The iOS app is the known
  hard exception to "really easy."
- **Contribution stance**: bug reports invited; PRs/feature contribution not
  solicited. The README states this plainly.
  [Inline bug submission](../features/2026-07-20-inline-bug-submission.md)
  supports it.
- **The issue queue ships** — an honest working queue is part of the appeal.
  Targeted working-tree scrub done (sister/estate/box-family generalized,
  this commit); **no history surgery**, reaffirming the 2026-07-05
  no-rewrite decision.
- **Cloud honesty**: the README gets a plain "what leaves your machine"
  section (resolves
  [release-cloud-provider-honesty](../closed/decisions/2026-07-08-release-cloud-provider-honesty.md)).
- **Auth**: local password stays the default;
  [invite links](../features/2026-07-20-invite-links.md) and
  [web password change](../features/2026-07-20-web-password-change.md) are
  wanted; GitHub OAuth rejected (first members are developers, their
  collaborators aren't); Tailscale identity rejected (footgun-prone); Google
  OAuth stays the documented optional extra.
- **Front door**: README is the launch front door; a
  [GitHub Pages site](../features/2026-07-20-github-pages-site.md)
  (deliberately un-polished, cool in other ways) may follow.

## Gates — before people see it

1. **Unauthenticated holes on the blessed deploy path**:
   [google-oauth-callback-unauthenticated](../bugs/2026-07-19-google-oauth-callback-unauthenticated.md)
   (worst — credential swap),
   [csp-report-endpoint-memory-exhaustion](../bugs/2026-07-19-csp-report-endpoint-memory-exhaustion.md),
   [hub-mobile-auth-presence-only](../bugs/2026-07-17-hub-mobile-auth-presence-only.md).
2. **[boxes-share-one-origin](2026-07-19-boxes-share-one-origin.md)** —
   either fix or stop claiming isolation in `auth.ts`/docs. Honest-docs is
   the acceptable launch answer; the fix can follow.
3. **README front door** (the release plan's Track E; item 11 in
   [installation-remaining-work](../features/2026-07-19-installation-remaining-work.md)):
   what-is-this / should-you-use-it, the subscription requirement stated
   plainly, what-leaves-your-machine, contribution stance.
4. **SECURITY.md**, produced as the first run of the
   [agent-maintained security report](../features/2026-07-20-agent-maintained-security-report.md)
   (seed: [todo-security.md](../../callback-box/docs/todo-security.md)).
5. **Issues scrub** — done except one open question: whether "the ledger
   box" in
   [stale-image-refs-after-renames](../bugs/2026-05-14-stale-image-refs-after-renames.md)
   is a real box or the example slug (boxholder to confirm).

## Explicitly not gates

[Explicit API-key config](../features/2026-07-20-explicit-api-key-config.md)
(easy early follow), invite links + web password change (launch-adjacent),
the Pages site, the real-infra install verifications (ACME/DNS, Tailscale
variant, macOS — the agent-reinterpretation path is the coverage story),
CI / CONTRIBUTING / issue templates (fast-follows per the release plan).
