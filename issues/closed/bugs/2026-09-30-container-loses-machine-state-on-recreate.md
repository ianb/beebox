---
title: "The container install keeps accounts, secrets, and the session key in an unpersisted home, so recreating the container loses them"
workstream: unattached
area: beebox
labels: [install]
filed-by: agent
discovered-by: Ian
discovered-in: worktree-installable-app — the Mac spike app lost the boxholder's password after a restart
priority: important
resolution: implemented
---

> **Closed 2026-10-05.** Compose mounts a named `home` volume at
> `/home/node`, so everything beebox keeps in the runtime user's home
> survives a recreated container: accounts and invites, the session key,
> the secret store, `~/.local/share/beebox`, the Codex login, and the
> uv/Docling caches. The image keeps nothing it needs in home (Claude CLI
> in `/opt/claude`, corepack in `/opt/corepack`, git settings in the system
> config). The suspected transcript mismatch is fixed by
> `BBX_CLAUDE_PROJECTS_DIR=/app/claude-config/projects` in the image.
> Verified in the Mac spike app, which mounts the same home: a password
> account and a signed-in session both survived a full stop and restart.
> Not carried over: state from an install that predates the volume (it lives
> in the old container layer). `beebox/docs/install/docker.md` "Updating"
> says so; a copy-across procedure was not written because it could not be
> tested without a Docker daemon.


Machine-level beebox state defaults to the runtime user's home directory:

- `~/.bbx-auth.json` — local accounts and invites (`beebox/src/webapp/local-users.ts:86`, override `BBX_AUTH_FILE`).
- `~/.config/beebox/secrets.json` — the machine secret store (`beebox/src/core/secrets/store.ts:160`, override `BBX_SECRETS_FILE`).
- `~/.bbx-session-secret` — the session signing key (`beebox/src/webapp/auth.ts:43`, no override).
- `~/.local/share/beebox` and `~/.config/beebox` — `BBX_STATE_DIR` / `BBX_CONFIG_DIR` (`beebox/src/lib/state-dir.ts:15`).

`beebox/docker/compose.yaml` persists only `/data/box` and the Claude config
volume. The image sets none of the overrides. So any container recreation —
an image update, `docker compose down` then `up`, a changed compose file —
starts with no accounts, no stored provider keys, and a new session key. The
box returns to first-run setup: existing members cannot sign in, and a
new setup token is printed to the server log.

Observed 2026-09-30 in the Mac spike app (`mac-app/`), which recreates the
container on every start: the boxholder created an account, restarted, and
the password no longer worked. The spike now mounts a `machine` folder and
sets `BBX_AUTH_FILE` and `BBX_SECRETS_FILE`; that is a workaround, not the fix.

## Related, suspected

The image sets `CLAUDE_CONFIG_DIR=/app/claude-config`, so Claude Code writes
transcripts under `/app/claude-config/projects`. Beebox reads
`~/.claude/projects` unless `BBX_CLAUDE_PROJECTS_DIR` is set
(`beebox/src/core/chat/session/transcript-paths.ts:44`). Chat-history
discovery in the container probably looks in the wrong place. Not verified.

## Why the fix is not only "set two env vars"

The session key has no override, and the state and config directories are
fixed. One persistent machine-state directory that every one of these
derives from (or a persistent `HOME` that does not hide the Claude CLI
installed under `~/.local`) is the shape to decide.
