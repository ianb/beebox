---
title: "Inline bug submission: agent-drafted, user-confirmed reports to the public repo"
workstream: open-source-readiness
needs: [design]
area: callback-box
filed-by: agent
discovered-in: worktree-open-source-readiness — launch-readiness conversation with the boxholder
labels: [soft-launch]
priority: backlog
---

Once the repo is public and bug reports are the invited contribution mode
(see [soft-launch posture](../decisions/2026-07-20-soft-launch-posture.md)),
the box itself is the best bug-reporting surface: the agent already has the
error context (client debug log, the failing operation, versions) and can
draft a far better report than a user starting from a blank GitHub form.

Shape: the agent offers ("want me to file this?") or the user asks; the agent
assembles a draft with the relevant context.

**Hard requirement (boxholder, 2026-07-20): submission is 100%
user-confirmed.** The user sees the exact final payload and explicitly
approves before anything leaves the box. This is not just consent mechanics —
the draft is assembled from box content, so the confirmation step *is* the
privacy review. No auto-submit path, ever.

Open design questions:

- **Transport.** A prefilled `github.com/.../issues/new` URL (no credentials
  needed, user submits under their own account, confirmation is inherent in
  the browser form) vs. `gh`/API submission (smoother, but needs a token and
  makes the confirmation step load-bearing). The URL-prefill approach is the
  simplest thing that satisfies the hard requirement.
- **What context is auto-gathered** (engine version, platform, sanitized
  error text) vs. never included (card content, paths, box names) — the
  draft should be born-scrubbed, not scrubbed-at-review.
- Where the affordance lives: chat-only, or also on error surfaces (the
  generic agent-error message in chat UI already wants improvement — see
  [surface-agent-error-detail-in-chat-ui](2026-07-11-surface-agent-error-detail-in-chat-ui.md)).
