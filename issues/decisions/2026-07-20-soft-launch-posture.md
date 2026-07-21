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
- **Register**: the audience is friendly but low-attention; what grabs
  attention is *personal* — the front door reads as a message from the
  boxholder to them, not neutral product docs. It should also state
  cost/usage expectations honestly (a running box burns the operator's
  Claude subscription quota).
- **Agent-legible docs as capability** (the SECURITY.md /
  [EXPORT.md](../features/2026-07-20-export-md-agent-instructions.md) /
  agent-install pattern): instruction docs addressed to the user's agent
  are the product surface; small helper tools, not end-to-end automation.
- **[Schedules off by default](../features/2026-07-20-schedules-off-by-default.md)**
  on fresh boxes — nothing runs until the user (or their agent, at their
  request) turns it on.
- Close behind but not gates:
  [release discipline + update story](2026-07-20-release-discipline-and-update-story.md)
  (paired with the blessed VPS path),
  [git push confirmation](2026-07-20-git-push-confirmation.md).

## Gates — before people see it

1. **Unauthenticated holes on the blessed deploy path**:
   [google-oauth-callback-unauthenticated](../closed/bugs/2026-07-19-google-oauth-callback-unauthenticated.md)
   (worst — credential swap; FIXED),
   [csp-report-endpoint-memory-exhaustion](../closed/bugs/2026-07-19-csp-report-endpoint-memory-exhaustion.md)
   (FIXED),
   [hub-mobile-auth-presence-only](../closed/bugs/2026-07-17-hub-mobile-auth-presence-only.md)
   (FIXED). All three gate-1 holes are now closed.
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
6. **Blessed-path bug review** (full ranking 2026-07-20; "high priority
   bugs 100% should be addressed or at least reviewed" — boxholder).
   Fix-before-launch tier beyond gate 1:
   [mobile-chat-unattributed](../closed/bugs/2026-07-17-mobile-chat-unattributed.md),
   [mobile-device-store-unlocked-rmw](../closed/bugs/2026-07-17-mobile-device-store-unlocked-rmw.md),
   [image-orientation-exif-boundaries](../bugs/2026-07-17-image-orientation-exif-boundaries.md),
   and the two landed-but-unverified mobile-web fixes awaiting a real
   phone
   ([landmark-menu-overflows-mobile](../bugs/2026-07-19-landmark-menu-overflows-mobile.md),
   [mobile-composer-grows-on-scroll](../bugs/2026-07-19-mobile-composer-grows-on-scroll.md)).
   Conditional:
   [ios-pairing-flow-robustness](../bugs/2026-07-17-ios-pairing-flow-robustness.md)
   escalates to a gate if the iOS app ships with the release (external-URL
   auto-redeem is a phishing surface).
7. **First-hour experience** — reviewed, boxholder-flagged ("the
   dashboard is crap"): at minimum decide how much of
   [first-run-experience](../features/2026-07-20-first-run-experience.md)
   and [chat-thread-management](../features/2026-07-20-chat-thread-management.md)
   (delete is the ask) lands pre-launch; the
   [day-to-day usage docs](../docs-and-chores/2026-07-20-day-to-day-usage-docs.md)
   are the docs half of the same gap.

## Explicitly not gates

[Explicit API-key config](../features/2026-07-20-explicit-api-key-config.md)
(easy early follow), invite links + web password change (launch-adjacent),
the Pages site, the real-infra install verifications (ACME/DNS, Tailscale
variant, macOS — the agent-reinterpretation path is the coverage story),
CI / CONTRIBUTING / issue templates (fast-follows per the release plan).

## Session issue index (this is the meta issue)

Every issue filed or closed in the `open-source-readiness` session
(all carry `discovered-in: worktree-open-source-readiness`, the
session tag; the [meta-issues](../docs-and-chores/2026-07-21-meta-issues.md)
convention itself came out of this session, and this doc is its first
instance).

Filed — features:
[inline-bug-submission](../features/2026-07-20-inline-bug-submission.md),
[agent-maintained-security-report](../features/2026-07-20-agent-maintained-security-report.md),
[web-password-change](../features/2026-07-20-web-password-change.md),
[invite-links](../features/2026-07-20-invite-links.md),
[github-pages-site](../features/2026-07-20-github-pages-site.md),
[explicit-api-key-config](../features/2026-07-20-explicit-api-key-config.md),
[export-md-agent-instructions](../features/2026-07-20-export-md-agent-instructions.md),
[schedules-off-by-default](../features/2026-07-20-schedules-off-by-default.md),
[chat-thread-management](../features/2026-07-20-chat-thread-management.md),
[first-run-experience](../features/2026-07-20-first-run-experience.md),
[agent-containment-allowed-directories](../features/2026-07-20-agent-containment-allowed-directories.md).

Filed — decisions:
this doc,
[release-discipline-and-update-story](2026-07-20-release-discipline-and-update-story.md),
[git-push-confirmation](2026-07-20-git-push-confirmation.md).

Filed — docs-and-chores / exploration:
[day-to-day-usage-docs](../docs-and-chores/2026-07-20-day-to-day-usage-docs.md),
[meta-issues](../docs-and-chores/2026-07-21-meta-issues.md),
[issues-inside-callback-box](../exploration/2026-07-21-issues-inside-callback-box.md).

Closed this session:
[google-oauth-callback-unauthenticated](../closed/bugs/2026-07-19-google-oauth-callback-unauthenticated.md),
[csp-report-endpoint-memory-exhaustion](../closed/bugs/2026-07-19-csp-report-endpoint-memory-exhaustion.md),
[hub-mobile-auth-presence-only](../closed/bugs/2026-07-17-hub-mobile-auth-presence-only.md)
(all fixed),
[release-cloud-provider-honesty](../closed/decisions/2026-07-08-release-cloud-provider-honesty.md),
[categorize-issues-into-subdirectories](../closed/decisions/2026-07-07-categorize-issues-into-subdirectories.md).

Substantially updated:
[writing-skill](../features/2026-07-05-writing-skill.md) (launch
writing as its first dogfood),
[first-run-experience](../features/2026-07-20-first-run-experience.md)
(the menu-of-flows direction), plus the scrub edits (four files) and
[installation-remaining-work](../features/2026-07-19-installation-remaining-work.md)
as standing context.
