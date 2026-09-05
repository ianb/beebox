---
title: "Connector secret files written/placed without mode 0600"
workstream: secret-custody
area: beebox
labels: [soft-launch]
filed-by: agent
discovered-in: worktree-security-report — credential inventory for the security report
priority: important
resolution: implemented
---

**Closed 2026-08-17** — superseded by the secret-custody store
(`docs/implemented-plans/secret-custody.md`), not fixed the way this issue
proposed. Telegram's writer (`src/webapp/trpc/routers/admin.ts`) now writes
into the machine store, which enforces `mode: 0o600` centrally
(`src/core/secrets/store.ts`), rather than getting its own targeted fix. The
remaining per-box `*.secret.json` files (mistral, deepgram, openai, …) are
now a deprecated transition surface the store supersedes — see the plan's
Rollout-shape migration-status note for the pending removal of that fallback,
after which this class of file stops being written at all.

Every bespoke credential store in the codebase writes with an explicit
`mode: 0o600` (`~/.beebox-auth.json`, token stores, google tokens,
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
