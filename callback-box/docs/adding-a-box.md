# Adding a New Box

How to create a new box and deploy it to box.example.com.

## Prerequisites

- SSH key loaded in agent: `ssh-add` (needed for GitHub access on the server via agent forwarding)
- GitHub repo created (private, under `ianb/` — convention is `box-<name>`)

## Steps

### 1. Create the GitHub repo

Go to GitHub and create a new private repo. Convention: `ianb/box-<name>`.

### 2. Initialize locally

```bash
cb init ~/src/boxes/<name>
```

This creates the full box directory structure, installs default procedures/guides/schedules, generates agent docs, and makes an initial git commit. It also creates a seed `briefing.briefing.card` — fill this in with the box's purpose and key people.

### 3. Push to GitHub

```bash
cd ~/src/boxes/<name>
git remote add origin git@github.com:ianb/box-<name>.git
git push -u origin main
```

### 4. Deploy to server

```bash
cd ~/src/callback/callback-box
./deploy/add-box.sh ianb/box-<name> <name>
```

The second argument overrides the directory name on the server (otherwise it uses the repo name, e.g. `box-<name>`). You almost always want to pass this so the URL is clean.

This clones the repo on the server, registers it with the scheduler, rebuilds the systemd service to include the new box, and restarts services.

The box is now live at `https://box.example.com/<name>/`.

### 5. Fix file ownership

The deploy script clones as root and runs `chown -R callback:callback` on the box. However, if `cb init` is run again later (e.g., after a code update that adds new directories), it runs as the `callback` user but the code itself runs from `/opt/callback/` which is root-owned. New directories created by `cb init` (like `people/`) will be owned by root if the init happens during deploy rather than from the callback user.

After deploying or running `cb init` on the server, verify ownership:

```bash
./deploy/ssh-server.sh "ls -la /home/callback/boxes/<name>/"
# If anything is root-owned:
./deploy/ssh-server.sh "chown -R callback:callback /home/callback/boxes/<name>/"
```

### 6. Configure access

Edit `config/box.json` to restrict who can access the box:

```bash
./deploy/ssh-server.sh
vi /home/callback/boxes/<name>/config/box.json
```

```json
{
  "publicUrl": "https://box.example.com/<name>",
  "allowedEmails": ["ian@ianbicking.org"]
}
```

If `allowedEmails` is empty or missing, any authenticated user can access.

### 7. Copy connector secrets

**This is easy to forget.** New boxes have no API keys — features like transcription will fail silently with "API key not configured." Secrets are per-box, stored in `config/connectors/`.

Copy secrets from an existing box:

```bash
./deploy/ssh-server.sh
# See what secrets exist on other boxes
ls /home/callback/boxes/*/config/connectors/*.secret.json

# Copy what you need
cp /home/callback/boxes/hearth/config/connectors/mistral.secret.json \
   /home/callback/boxes/<name>/config/connectors/
chown callback:callback /home/callback/boxes/<name>/config/connectors/*.secret.json
chmod 600 /home/callback/boxes/<name>/config/connectors/*.secret.json
```

Common secrets:
- `mistral.secret.json` — `{"apiKey":"..."}` — needed for Voxtral transcription
- `telegram.secret.json` — `{"botToken":"...","webhookSecret":"..."}` — needed for Telegram connector
- Google connector tokens are per-box in `google.secret.json`

Alternatively, set the `CALLBACK_MISTRAL_API_KEY` env var in `/home/callback/.env` to provide a server-wide default (but connector-specific secrets like Telegram must still be per-box).

### 8. Fill in the briefing card

The seed briefing card from `cb init` has placeholder content. Fill in:
- `<purpose>` — what this box is for
- `<key-people>` — who's involved (inline or referencing person cards in `people/`)
- `<agent-needs-to-know>` — critical context the agent should always have

Then run `cb wakeup` (or wait for the scheduler) to compile the briefing into agent docs.

## Updating a deployed box

Push changes to GitHub, then:

```bash
./deploy/add-box.sh ianb/box-<name> <name>
```

If the box already exists on the server, it pulls the latest instead of cloning.

## Troubleshooting

### SSH agent forwarding fails

The `add-box.sh` script uses `-A` for SSH agent forwarding. If the clone fails with "Permission denied (publickey)":

1. Make sure your key is loaded: `ssh-add -l` (should show at least one key)
2. If empty, run `ssh-add`
3. To auto-load keys on macOS login, add to `~/.ssh/config`:
   ```
   Host *
     AddKeysToAgent yes
     UseKeychain yes
   ```

### Box exists but isn't served

The systemd service lists boxes explicitly. If you added a box manually (not via `add-box.sh`), the service file won't include it. Either re-run `add-box.sh` or manually edit `/etc/systemd/system/callback-serve.service` on the server and restart.

### "API key not configured" errors

The box is missing a secret file. See step 7 above. Check which secrets exist:

```bash
./deploy/ssh-server.sh "ls /home/callback/boxes/<name>/config/connectors/"
```

### Permission denied writing to box directories

Files or directories owned by root instead of `callback`. See step 5 above.
