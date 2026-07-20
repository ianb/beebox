---
title: "Git push confirmation: should the box confirm before pushing content off-machine?"
needs: [decision]
area: callback-box
filed-by: agent
discovered-in: worktree-open-source-readiness — launch-readiness conversation with the boxholder
---

"Git push confirmation is something to definitely consider" (boxholder,
2026-07-20). Today `cb wakeup` pushes the box repo to its configured
remote automatically. The push is the backup story's engine — but it is
also the box sending the user's entire personal-data history to wherever
the remote points, on an automatic cadence, with no per-push consent.

The tension: for the boxholder's own boxes automatic push is obviously
right (own remote, backup). For a new operator, "the agent pushed my
data somewhere" is exactly the kind of surprise the
[soft-launch posture](2026-07-20-soft-launch-posture.md) is trying to
avoid — and a remote misconfigured (or maliciously configured, e.g. by a
prompt-injected agent editing config) is an exfiltration channel.

Options to weigh: confirm-on-first-push per remote (then remembered —
the SSH known-hosts shape); a config flag (`push: auto | confirm |
never`) defaulting to confirm-until-blessed; treating remote *changes*
(not pushes) as the consent point, since the remote URL is the thing
that matters; surfacing push destination + last-push in the dashboard's
system info so it's at least visible. Related:
[EXPORT.md](../features/2026-07-20-export-md-agent-instructions.md)
(the backup paragraph), the security report's data-flow inventory
([agent-maintained security report](../features/2026-07-20-agent-maintained-security-report.md)).
