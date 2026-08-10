---
title: "A staging slot for pre-merge workstream testing"
workstream: workstreams
area: deploy
design: ../../callback-box/docs/implemented-plans/workstreams.md
filed-by: agent
discovered-in: worktree-workstreams — implementing the workstreams testing queue
---

The `/workstreams/testing/` queue currently points at each worktree's local
router URL. That is the right default: most verification is cheapest and most
truthful against the isolated local checkout and test1 clone.

Some changes eventually need a deployed environment before merge: remote
network behavior, production-like auth, or a device that cannot reach the
developer router. Explore one deliberately singular staging deployment slot,
where "test this" replaces the slot with one selected workstream rather than
creating a fleet of persistent environments.

The integration point is a target column/action on `/workstreams/testing/`.
The exploration must cover deployment serialization, authentication,
provisioning and cleanup, and how the UI makes it unmistakable that staging is
shared and mutable. Keep the local worktree URL as the primary target; staging
is an explicit escalation, not the default testing path.
