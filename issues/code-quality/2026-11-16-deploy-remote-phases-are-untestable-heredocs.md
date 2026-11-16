---
title: "deploy.sh remote phases are heredoc text that no test can run"
workstream: unattached
area: beebox
labels: [deploy]
filed-by: agent
discovered-in: worktree-retrospective — retrospective 20261116-005159
---

`beebox/deploy/deploy.sh` builds its server-side work by queueing heredoc
blocks into one remote script. A decision inside a block cannot be unit-tested
where it sits. Moving a block into a reusable function means editing nested
heredocs, and a syntax error shows only on the server. The activation trap's
rollback branch was reviewed, not tested.

The atomic-deploy work checked the activation locally by extracting the
assembly, running it with stub variables, and running `bash -n` and
shellcheck on the output. That is a manual step.

Seam: each remote phase a named function in one generated script, invokable
alone. Then a local harness could run the activation against stub
`systemctl` and `node`. This also makes
[a fast manual rollback](../features/2026-11-13-deploy-fast-manual-rollback-command.md)
cheaper.

Evidence: `atomic-deploy/20261113T180556Z-plan-reviewed.md`,
`atomic-deploy/20261113T181537Z-implemented.md`,
`atomic-deploy/20261113T182529Z-review-adjudicated.md`.
