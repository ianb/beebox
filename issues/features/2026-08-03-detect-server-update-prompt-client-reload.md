---
title: "Detect a server update and prompt the client to reload"
workstream: unknown
area: beebox
filed-by: agent
discovered-in: main session — boxholder asked for it
priority: normal
---

When the deployed server updates while a client (web tab or iOS webview) is
already open, the client keeps running the **old** bundle against the **new**
server. Nothing tells it to reload, so it silently drifts out of sync until the
person happens to hard-refresh.

## Job to be done

*When I have a box tab open for hours and a deploy lands mid-session, I want the
app to tell me it has updated and let me reload, so I stop hitting weird
half-broken behavior without knowing why.*

The person is not watching for deploys — they are mid-conversation, or glancing
at the box between other things. The signal has to come to them (a quiet,
dismissible "A new version is available — reload" affordance), not require them
to suspect a version mismatch and reload on a hunch.

## Why it matters: it also kills a class of "dumb server-update bugs"

Several intermittent bugs are really **version skew** — an old client talking to
a new server (or vice-versa) across a deploy: a changed wire shape, a renamed
route, a WS/tRPC contract that moved. They present as flaky one-offs that never
reproduce on a fresh load, so they burn debugging time. A reliable "server
changed → reload the client" path makes the skew window explicit and short, and
removes the whole category of "worked after I refreshed" ghosts.

## Fix direction (sketch — not settled)

- Give the server a **build/version identity** (deploy already knows the commit
  hash — the deploy notification shows it; see `deploy/deploy.sh`). Expose it so
  the client can compare its own build id against the server's current one.
- **Detect the mismatch** on the channel the client already holds open — the
  per-box WebSocket (tRPC subscriptions / event bus) is the natural carrier;
  the server can announce its version on connect and broadcast on change, so no
  new polling loop is needed. A cheap fallback is stamping the version on
  ordinary responses and comparing.
- **Surface it gently**: a non-blocking banner/toast "A new version is available
  — Reload", never an auto-reload (that would nuke an in-progress compose or a
  streaming turn). Let the person finish and reload when ready.
- Decide behavior on the **iOS webview** too — it should get the same signal and
  reload path (`docs/mobile-contract.md`; bbx-ios-overlap territory).

## Open questions

- Version identity granularity: whole-deploy commit hash vs. a frontend-bundle
  hash (a docs-only deploy doesn't change the client — don't nag for those).
- How hard to push: purely optional banner, or escalate (force a reload) once the
  skew is known to break a specific call?
- Does the same mechanism want to cover the **dev router** (worktree restarts /
  bundle rebuilds), or is that out of scope?
