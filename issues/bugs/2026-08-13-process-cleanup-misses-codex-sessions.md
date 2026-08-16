---
title: "Router startup cleanup does not recognize live Codex sessions"
workstream: unattached
area: router
labels: [router, agents, lifecycle]
filed-by: agent
discovered-by: agent
discovered-in: workstreams — isolated resident-app router rehearsal
---

An isolated router startup ran `process-cleanup.ts` and reclaimed an
`agent-browser` process belonging to this live Codex worktree. The cleanup guard
recognizes live Claude sessions but does not recognize Codex sessions, so it can
mistake a Codex-owned browser daemon for an orphan.

Extend live-session ownership detection to Codex without weakening orphan
cleanup. Reproduce with an isolated router and a Codex-owned browser process;
do not test by restarting the shared router.
