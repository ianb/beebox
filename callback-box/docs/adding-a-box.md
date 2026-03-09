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

This creates the full box directory structure, installs default procedures/guides/schedules, generates agent docs, and makes an initial git commit.

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

### 5. Configure access (optional)

To restrict who can access the box, edit `config/box.json` on the server:

```bash
./deploy/ssh-server.sh
vi /home/callback/boxes/<name>/config/box.json
```

```json
{
  "allowedEmails": ["ian@ianbicking.org"]
}
```

If `allowedEmails` is empty or missing, any authenticated user can access.

### 6. Add connector secrets (optional)

```bash
./deploy/ssh-server.sh
cd /home/callback/boxes/<name>/config/connectors/
echo '{"botToken":"..."}' > telegram.secret.json
```

Then restart: `systemctl restart callback-serve`

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

### Updating a deployed box

Push changes to GitHub, then:

```bash
./deploy/add-box.sh ianb/box-<name> <name>
```

If the box already exists on the server, it pulls the latest instead of cloning.
