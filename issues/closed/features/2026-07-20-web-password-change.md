---
title: "Web self-service password change"
area: callback-box
filed-by: agent
discovered-in: worktree-open-source-readiness — launch-readiness conversation with the boxholder
labels: [soft-launch]
resolution: implemented
---

Closed by `604080ed` and its preceding invite-auth implementation commits. The
shipped route verifies the current password, rotates the stored hash and session
generation, and returns a fresh cookie to the Settings UI.

A logged-in user cannot change their own password in the web UI — the only
password surfaces are login, first-run setup, and the host-side CLI
(`cb auth set-password`, `src/cli/commands/auth.ts`). For a box with invited
members (see [invite links](2026-07-20-invite-links.md)), "ask the operator
to run a CLI command on the server" is the wrong recovery/rotation story.

The machinery all exists: the scrypt store (`src/webapp/local-users.ts`),
and session revocation on password change via the per-user `gen` bump (the
CLI path already does this). Needed: a tRPC mutation (current password +
new password, rate-limited like login) and a small settings page. The
mutation revokes other outstanding sessions the same way the CLI does.

Boxholder approved 2026-07-20; launch-adjacent, not a gate
([soft-launch posture](../../decisions/2026-07-20-soft-launch-posture.md)).
