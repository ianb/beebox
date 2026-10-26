# Local box backup with launchd

For a box installed directly on a Mac, install the checksum-verified pinned
restic binary and configure the backup repository first:

```sh
mkdir -p "$HOME/.local/bin" "$HOME/Library/Logs/beebox"
bash beebox/deploy/install-restic.sh "$HOME/.local/bin/restic"
```

Then copy
[`com.beebox.backup.plist.template`](./com.beebox.backup.plist.template) to
`~/Library/LaunchAgents/com.beebox.backup.plist` and replace these placeholders
with absolute paths:

- `__BBX_EXECUTABLE__`: output of `command -v bbx`
- `__BOX_ROOT__`: the box root
- `__LOG_DIRECTORY__`: an existing directory such as `~/Library/Logs/beebox`
- `__LOCAL_BIN__`: `$HOME/.local/bin`, where the verified `restic` binary was installed

Validate and load it in the logged-in user's session:

```sh
plutil -lint ~/Library/LaunchAgents/com.beebox.backup.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.beebox.backup.plist
```

The template runs daily at 03:15 local time. If the Mac is asleep then,
launchd runs the missed calendar event after wake. Inspect the two log files
for backup or retention failures. To unload the schedule:

```sh
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.beebox.backup.plist
```
