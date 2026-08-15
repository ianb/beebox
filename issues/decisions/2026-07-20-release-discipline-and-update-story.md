---
title: "Less-casual releases, and an update story paired with VPS deploy"
workstream: open-source-readiness
needs: [design]
area: callback-box
filed-by: agent
discovered-in: worktree-open-source-readiness — launch-readiness conversation with the boxholder
labels: [soft-launch]
---

Two coupled tensions, boxholder-raised 2026-07-20:

1. **The update story is a launch-journey hole.** The Docker/VPS guide
   says "update = `git pull` + rebuild," but nothing tells an operator an
   update exists, whether it's safe (are there box migrations?), or what
   changed. "VPS deploy should definitely be paired with updates" — a
   blessed deploy path implies a blessed update path.
2. **"Maybe we need to be less casual about releases."** Today main is
   the only release channel; every commit is implicitly shipped. Once
   strangers track the repo, some release discipline may be warranted:
   tags/versions, a changelog (or agent-generated release notes — same
   family as the
   [agent-maintained security report](../closed/features/2026-07-20-agent-maintained-security-report.md)),
   a statement of what "updating" means for existing boxes
   (`docs/migrations.md` is currently a maintainer runbook, not an
   operator answer).

To settle: does the soft launch track `main` or tagged releases; minimum
viable release ritual (tag + notes + migration flag?); how a running box
or its operator learns an update exists (a doctor check? a dashboard
health line?); and where the update section lives in
`docs/docker-install.md`. Interacts with the deferred npm-publish rung
([installation-remaining-work](../features/2026-07-19-installation-remaining-work.md)
item 6) but is upstream of it — release discipline is needed even for
git-pull distribution. Not a launch gate per the
[posture](2026-07-20-soft-launch-posture.md), but close behind.
