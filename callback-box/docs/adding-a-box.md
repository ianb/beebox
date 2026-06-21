# Adding a New Box

How to create a new box and deploy it to box.example.com.

## Prerequisites

- SSH key loaded in the agent: `ssh-add -l` (agent forwarding gives the server GitHub access)

## 1. Create the repo and init locally

```bash
gh repo create ianb/box-<name> --private     # convention: ianb/box-<name>
cb init ~/src/boxes/<name>
```

`cb init` builds the full box structure, installs default
procedures/guides/schedules, generates agent docs, and makes the initial
commit — including a seed `briefing.briefing.card` (you fill it in at step 4).

## 2. Push to GitHub

```bash
cd ~/src/boxes/<name>
git remote add origin git@github.com:ianb/box-<name>.git
git push -u origin main
```

## 3. Deploy

From the monorepo's `callback-box/`:

```bash
./deploy/add-box.sh ianb/box-<name> <name> --allow <user@email> --secrets-from personal
```

The second positional is the slug/directory on the server (pass it so the URL
is clean). **One command does the whole provision:** clone the repo, run
`cb init`, write access config, seed connector secrets, fix ownership, register
with the manifest, restart serve + scheduler, and run a health check. Live at
`https://box.example.com/<name>/`.

**Access (`--allow`, repeatable):**
- The **owner always has access to every box** — you never list them. `--allow`
  grants *additional* users. It writes `config/box.json` as
  `{"allowedEmails": [...]}`, **for a new box only** — it never clobbers an
  existing config, so change access on a live box by editing `box.json` directly.
- Empty/missing `allowedEmails` ⇒ any authenticated user can access. (Note: the
  box.json schema has no `publicUrl` field — the URL is derived from the slug.)

**Secrets (`--secrets-from <box>`):**
- Copies every `config/connectors/*.secret.json` from a reference box. Without a
  key, transcription/connectors emit a health *warning* ("API key not
  configured") but the box still runs. The shared Mistral (Voxtral) key lives on
  every box, so `--secrets-from personal` is a fine default.
- Per-box secrets are the real mechanism. (`getMistralApiKey` also falls back to
  a `CALLBACK_MISTRAL_API_KEY` env var, but that isn't set on the server — don't
  rely on it.)

## 4. Fill in the briefing card

The seed `briefing.briefing.card` from `cb init` has placeholder content. Fill in
the box's purpose, key people (inline or referencing `people/` cards), and the
critical context the agent should always have. Then `cb wakeup` (or wait for the
scheduler) compiles it into the agent docs.

Other optional `config/box.json` keys (edit by hand): `timezone`,
`googleServices` (`{ "calendar": true, ... }`), and proactive health alerts —
`{ "healthAlerts": { "telegramChat": "<chat-id>" } }` (without it, `cb health`
and the session-start snapshot still surface problems; nothing just pings you).

## Updating a deployed box

Push to GitHub, then re-run the deploy (idempotent — it pulls latest, re-inits,
and restarts, leaving access config and secrets untouched):

```bash
./deploy/add-box.sh ianb/box-<name> <name>
```

## Troubleshooting

### SSH agent forwarding fails

`add-box.sh` uses `-A` for agent forwarding. If the clone fails with "Permission
denied (publickey)":

1. Confirm a key is loaded: `ssh-add -l`
2. If empty: `ssh-add`
3. Auto-load on macOS login — add to `~/.ssh/config`:
   ```
   Host *
     AddKeysToAgent yes
     UseKeychain yes
   ```

### Box exists but isn't served

`cb serve` with no path arguments serves every box in the manifest
(`cb boxes list`); the systemd unit should be the argless form:
`ExecStart=/usr/local/bin/cb serve --host 0.0.0.0 --port 3210`. If a box is in
the manifest but not served, check whether the unit still hard-codes explicit box
paths (the pre-manifest form from `migrate-to-callback-user.sh` — this bit the
workshop add, 2026-06-12). Fix by removing the path list from `ExecStart`, then
`systemctl daemon-reload && systemctl restart callback-serve`. The startup log
line `Serving N box(es) from manifest:` confirms the mode.

### File-watcher errors (ENOSPC) in the serve log

Each served box gets a recursive file watcher, and large trees (e.g. a busy box's
`procedure/runs/`) can exhaust `fs.inotify.max_user_watches` — watchers then
silently fail for everything initialized after the limit. The server pins a
higher limit in `/etc/sysctl.d/90-callback-inotify.conf` (524288, set
2026-06-12). If ENOSPC reappears, raise it again — and consider excluding
high-churn directories from the box watcher in code.

### "API key not configured" warnings

The box is missing a connector secret. Seed it with `--secrets-from <box>` on a
re-deploy, or copy by hand. Check what's present:

```bash
./deploy/ssh-server.sh "ls /home/callback/boxes/<name>/config/connectors/"
```

### Permission denied writing to box directories

Files owned by `root` instead of `callback`. `add-box.sh` re-chowns at the end,
so this only bites if `cb init` was run standalone on the server (the code runs
from root-owned `/opt/callback/`). Fix:

```bash
./deploy/ssh-server.sh "chown -R callback:callback /home/callback/boxes/<name>/"
```
