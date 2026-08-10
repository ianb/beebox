---
title: "Connector secret files written/placed without mode 0600"
workstream: security-report
area: callback-box
labels: [soft-launch]
filed-by: agent
discovered-in: worktree-security-report — credential inventory for the security report
---

Every bespoke credential store in the codebase writes with an explicit
`mode: 0o600` (`~/.cb-auth.json`, token stores, google tokens,
`publish.secret.json`, …). Two exceptions found:

1. **Telegram**: `src/webapp/trpc/routers/admin.ts:96-101` writes
   `config/connectors/telegram.secret.json` (live bot token + webhook
   secret) via `fs.writeFile` with no `mode` argument — umask-default
   permissions. `deploy/add-box.sh`'s `chmod 600` backstop only covers
   `--secrets-from` copies, not a box that runs `telegramSetup` directly.
2. **Hand-placed provider keys**: `mistral.secret.json`,
   `deepgram.secret.json`, `openai.secret.json` have no writer in `src/`
   at all — permissions are whatever the operator's umask/editor
   produced. No code path enforces or heals their mode (contrast
   `local-users.ts:124-127`, which self-heals drift).

Fix direction: write telegram's file with `mode: 0o600` (or through
`writeFileAtomic`), and add a mode check/heal where connector secrets are
read (the pattern `local-users.ts` already uses). Related context:
[per-box-secret-management](../decisions/2026-03-15-per-box-secret-management.md).
