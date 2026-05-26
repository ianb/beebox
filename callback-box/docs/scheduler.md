# Scheduler

The scheduler is a background daemon that runs `cb tick` for multiple boxes on a recurring basis. It's managed via launchd on macOS.

## Quick Start

```bash
# Add boxes to the scheduler
cb scheduler add ~/src/boxes/test1
cb scheduler add ~/src/boxes/hearthside

# Install launchd plist (auto-starts at login)
cb scheduler install

# Load it now
launchctl load ~/Library/LaunchAgents/com.callback.scheduler.plist
```

## How It Works

The daemon runs `cb tick` every 60 seconds for each configured box. `cb tick` checks all `config/schedules/*.scheduled-script.card` files against their cron/at/rrule schedules and runs any that are due.

Key behaviors:
- **Config reload** — The box list is reloaded each cycle, so `cb scheduler add/remove` takes effect without restarting
- **Error isolation** — One box failing doesn't affect others
- **Sleep recovery** — If the computer sleeps through a scheduled window, scripts fire on the next tick after wake (cron evaluation checks if the last scheduled time is after the last run)
- **Auto-restart** — launchd `KeepAlive: true` restarts the daemon if it crashes

## Configuration

Global config at `~/.config/cb/scheduler.json`:
```json
{
  "boxes": [
    "/Users/you/src/boxes/mybox"
  ]
}
```

Only explicitly added boxes run. Directories like `boxes/scenarios/` won't be included unless added.

## Logs

Per-box JSONL logs at `<boxRoot>/.callback-box/scheduler.jsonl` (gitignored, auto-rotated at 1MB).

Each tick produces one JSONL entry per box:
```json
{"ts":"2026-02-24T06:22:27Z","event":"tick","box":"/path/to/box","result":{"ran":2,"skipped":5,"errors":0,"scripts":[{"name":"check-email","status":"ran","command":"cb wakeup --connector gmail","durationMs":4523},{"name":"check-rss","status":"skipped"}]}}
```

View logs:
```bash
cb scheduler log                    # All boxes, last 20 entries
cb scheduler log --box ~/src/boxes/test1  # One box
cb scheduler log --errors           # Only entries with errors
cb scheduler log --json             # Raw JSONL
```

The webapp also serves logs at `GET /api/scheduler/log` (filtered to the current box).

## CLI Commands

```
cb scheduler start [--interval <s>]  # Run daemon foreground
cb scheduler add <path>              # Add box
cb scheduler remove <path>           # Remove box
cb scheduler list                    # Show configured boxes
cb scheduler status                  # Boxes + launchd status
cb scheduler log [options]           # View logs
cb scheduler install                 # Install launchd plist
cb scheduler uninstall               # Remove launchd plist
```

## Launchd

The plist is at `~/Library/LaunchAgents/com.callback.scheduler.plist`.

```bash
# Check status
launchctl list com.callback.scheduler

# Start/stop
launchctl load ~/Library/LaunchAgents/com.callback.scheduler.plist
launchctl unload ~/Library/LaunchAgents/com.callback.scheduler.plist

# Reinstall (after code changes, nvm updates, etc.)
cb scheduler install
```

The plist captures the current `PATH` at install time (needed for nvm). If you update node versions, re-run `cb scheduler install`.

Stderr goes to `~/.local/share/cb/scheduler-stderr.log` (for crash diagnostics only — structured logs are in per-box JSONL files).
