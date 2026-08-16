---
title: "bin/browse passes the box agent token via child argv/env (readable by other local users) and scopes it to the shared dev origin"
workstream: local-password-auth
filed-by: agent
discovered-in: worktree-local-password-auth — Codex adversarial review of the always-on-auth branch (finding #8, Track E)
area: callback-box
---

Surfaced by a cross-model (Codex) security review of the local-password-auth
branch (Track E — browse/tour agent-token injection). Filed rather than fixed on
that branch because the real fix needs an `agent-browser` change and the impact
is low on a single-user dev machine.

Two related weaknesses in the Track E wiring:

1. **Token in process metadata.** `bin/browse` exports the box's
   `.callback-box/agent-token` as `BROWSE_AGENT_TOKEN` (`bin/browse:~58`) and it
   ends up in the browser child's argv (`browse/src/cli.ts:~75`,
   `browse/packages/agent-browser-typed/src/runner.ts:~56`). A full bearer in
   argv/env is readable by any other local user via `ps`/`/proc/<pid>/environ`,
   bypassing the token file's `0600` protection. Low impact on a single-user
   machine; matters on shared hosts.
2. **Origin-wide, not worktree-wide, scoping.** `isOwnOrigin()`
   (`browse/src/worktree.ts:~59`) reasons about a worktree path, but
   `agent-browser --headers` scopes the injected header to the actual *origin*
   (`http://localhost:3210`), which the dev router shares across every worktree
   (`/<worktree>/...`). So after opening this worktree, a later navigation to a
   different worktree's path on the same origin can carry this token. Mostly
   inert (each box verifies its OWN agent-token, so a mismatched token is just
   rejected), but it means the "scoped to this worktree" guarantee is weaker than
   Track E's comments imply. External hosts are correctly excluded (upstream
   scopes by scheme/host/port).

Fix direction: pass the token to `agent-browser` via a file/stdin rather than
argv/env; and either scope the header by URL path-prefix (`/<worktree>/`) rather
than origin, or document that dev tokens are per-user-machine and the cross-
worktree bleed is acceptable. See the Track E section of
`../../callback-box/docs/implemented-plans/local-password-auth.md`.
