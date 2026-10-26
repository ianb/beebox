# Encrypted box backups

`bbx engine backup` saves a box, its Git history and annex objects, durable
`.beebox/` state, and selected outside-the-box state in a restic repository.
It is an operator command. The box's Git remote remains useful, but a Git
push does not carry every file or the annex object bytes.

The encrypted snapshot includes that box's secrets and its Claude/Codex
conversation files when present. On the production server, Claude and Codex
login files are per-box and included; the hub owns local account and session
credentials, so those are skipped and must be recovered or recreated with the
hub. The server's Google grant is either per-box state inside the box tree or
hub-managed. The Mac VM and provided Compose install include home-level auth,
session, token, origin, Claude, and Codex state because those installs give
the box a dedicated home. A local box sharing a home with other boxes omits
shared home files; expect to sign in and reconnect affected services after
recovery there.

Backups are opt-in and scoped to one box. Each box gets its own repository.
Restic encrypts it before upload. Keep the repository password in a password
manager or offline record **outside the machine being backed up**: a lost
password makes the backup unreadable. The unattended password file and the
destination's access credentials must be readable by the box's OS user; that
user can also delete backups if the destination permits deletion. Use
destination-side versioning or immutability when available.

## Configure and check

Install restic 0.19.1 on a local host. The server and container installation
provide it with the engine. Choose a restic repository URL that the box
runtime can reach. SFTP/SSH keys and S3 credentials can be supplied through
protected files, which work with scheduled runners. Native `b2:` repositories
require `B2_ACCOUNT_ID` and `B2_ACCOUNT_KEY` in the runner environment;
scheduled server and Mac commands do not inherit arbitrary shell variables.
For unattended B2 on the server or Mac app, use its S3-compatible endpoint
with file-backed S3 credentials. A local scheduler or per-box Compose project
can use native `b2:` only if its own environment supplies those variables.
Restic's `rclone:` backend requires rclone to be installed
separately; it is not bundled with the engine. A bare local box may use an
accessible local directory. The production sandbox and Mac VM do not gain
access to arbitrary host disks from this command.

Create a strong recovery password and a 0600 file containing it. For a box
at `<box-root>`, run:

```sh
bbx engine backup configure <box-root> \
  --repository <restic-repository> \
  --password-file <protected-password-file>
bbx engine backup status <box-root>
bbx engine backup check <box-root>
```

Configuration validates or initializes the repository and makes the first
snapshot. It records the repository, password-file path, and retention in
the box user's machine configuration, outside the captured box. By default
the operator schedule is daily and retention keeps seven daily, four weekly,
and twelve monthly verified snapshots. `configure` accepts `--keep-daily`,
`--keep-weekly`, and `--keep-monthly` counts. Every run first captures a
verified snapshot, then applies retention. A retention failure returns a
nonzero result while leaving the new verified snapshot available.

After reinstalling on a new machine, use `restic snapshots --json` to read the
old snapshot's `bbx-backup:<uuid>` tag, then pass `--backup-id <uuid>` when
configuring the same repository. The command accepts that identity only if
every snapshot in the repository belongs to it. Do not adopt while the old
installation can still write to the repository.

Run a backup by hand with `bbx engine backup run <box-root>`. The command
briefly closes the box to new work, waits for admitted work to finish, then
holds that pause while restic reads the files. A large annex collection or
slow destination can make the pause long. The result prints the **verified**
snapshot ID; tagging a restic snapshot changes its ID. Timer logs carry
failures. `status --json` is for install schedulers; ordinary `status` prints
the latest verified snapshot or a clear unconfigured state. Run `check
--read-data` periodically if you want restic to read every stored byte.

## Schedule by installation

- **Production server:** configure as its `bbx-<slug>` Unix user with the
  unit environment loaded and `--configure-only`, then run the first capture
  through `systemctl start --wait beebox-backup@<slug>.service`. Only after
  that succeeds, enable `beebox-backup@<slug>.timer`. The daily timer runs
  the same sandboxed service as that box user. Keep the password file under
  `/var/lib/beebox/<slug>/` outside `box/`; network repositories are the
  portable destination in this sandbox. Keep backend credentials per box.
  For example, with shell variables set to your slug, repository, and
  password file:

  ```sh
  sudo -u "bbx-$slug" -H bash -c \
    'set -a; source /etc/beebox/box.env; set +a; bbx engine backup configure "/var/lib/beebox/$1/box" --repository "$2" --password-file "$3" --configure-only' \
    backup-setup "$slug" "$repository" "$password_file"
  sudo systemctl start --wait "beebox-backup@$slug.service"
  sudo systemctl enable --now "beebox-backup@$slug.timer"
  ```
- **Mac app:** while the app hosts its local box, it checks for a due backup.
  After reopening, it waits for ten minutes without admitted box work before
  an overdue run. If the app stays closed, no backup runs until it reopens.
  Use the app bundle's `BeeBoxMac backup` command to configure and inspect
  the repository inside its running VM; see the
  [Mac backup commands](../../mac-app/README.md#backup-commands).
- **Docker or NAS:** schedule `docker compose run --rm box bbx engine backup
  run /data/box` from the Compose directory with the host's scheduler. This
  one-shot uses the current box image and its machine-state volumes.
- **Local laptop box:** use the provided launchd template or another host
  scheduler to invoke `bbx engine backup run <box-root>` daily. The password
  file and repository must be available in that scheduler's environment.

Do not put backup inside a box-authored scheduled script. It would enter the
normal scheduler's box-work admission before the backup could take its
exclusive capture hold.

## Recover onto another machine

Install the engine and restic, obtain the repository address and recovery
password from outside the failed machine, and restore into an **empty**
directory outside any box:

```sh
bbx engine backup restore \
  --repository <restic-repository> \
  --password-file <protected-password-file> \
  --target <empty-restore-directory>
```

This first command previews the selected verified snapshot, its captured
source paths and exclusions, and the planned `box/` and `external/` output
paths. It leaves the restore target untouched. Copy the full snapshot ID from
the preview, then run the same command with `--snapshot <full-id> --apply` to
write it. `--apply` prints the preview again and requires that exact ID; a
short prefix or an unpinned newest snapshot cannot write files.

`--snapshot <verified-id>` selects an older point in time for the preview.
The applied restore puts the recovered box in `box/` and staged machine state
in `external/` beneath the target. It validates Git and annex content; a
validation failure leaves both recovered directories for inspection and exits
nonzero. Inspect both
before activation. Merge only this box's external
state into a shared home or secret store; never replace another box's state
with the staged files. Repair ownership and any encoded session paths,
reinstall or relink the engine, then register and start the box. The restore
command does not activate connectors or send data. Restic's own `restore --include`
supports extracting a single file for inspection.

The repository stores snapshots, not the engine, image, VM disk,
`node_modules`, caches, generated docs, or search indexes. A verified tag
means backup completed and a repository check passed; an isolated test
restore is still the final proof that this particular installation can
recover. This release does not include Mac-initiated backup of a remote box
onto the Mac.
