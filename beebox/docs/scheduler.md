# Scheduler

The scheduler is a background daemon that runs `bbx tick` for multiple boxes on a recurring basis. It's managed via launchd on macOS.

## Quick Start

```bash
# Add boxes to the scheduler's manifest
bbx boxes add ~/src/boxes/test1
bbx boxes add ~/src/boxes/hearthside

# Install launchd plist (auto-starts at login)
bbx scheduler install

# Load it now
launchctl load ~/Library/LaunchAgents/com.beebox.scheduler.plist
```

## How It Works

The daemon runs `bbx tick` every 60 seconds for each configured box. `bbx tick` checks all `_config/schedules/*.scheduled-script.card` files against their cron/at/rrule schedules and runs any that are due.

Key behaviors:
- **Config reload** — The box list is reloaded each cycle, so `bbx boxes add/remove` takes effect without restarting
- **Error isolation** — One box failing doesn't affect others
- **Sleep recovery** — If the computer sleeps through a scheduled window, scripts fire on the next tick after wake (cron evaluation checks if the last scheduled time is after the last run)
- **Auto-restart** — launchd `KeepAlive: true` restarts the daemon if it crashes
- **Engine unavailability (deferred-recoverable)** — When the box's agent
  engine is out of quota, the failure is recognized from the provider's
  message and recorded in a machine-level store
  (`~/.local/share/beebox/engine-availability.json`). Due scripts then *skip*
  with `waiting on <provider> quota until <t>` instead of burning attempts
  (`--force` overrides), a run that failed because of the episode records a
  `deferred` outcome that neither increments nor resets
  `consecutiveFailures`, and `bbx health` shows `waiting`, not `failing`.
  The boxholder is notified once per episode with the reset time. Design:
  `docs/plans/deferred-recoverable-agent-failures.md`.
- **Inconclusive runs (no verdict)** — A script whose work completed but whose
  check never decided exits **3** (`INCONCLUSIVE_EXIT_CODE`) and prints one
  `Inconclusive: …` line on stderr (`bbx procedure run` when a validate step's
  review runs out of turns — see `docs/procedure-implementation.md`; `bbx handle`
  when a category's handler procedure does). Both signals are required, and the
  line must appear on stderr in the full shape `formatInconclusiveLine` /
  `formatHandleInconclusiveLine` produce: a command can print anything on
  stdout, and reading that as a non-verdict would launder a real failure. The
  scheduler records that
  as `lastResult: "inconclusive"`, which — like `deferred` — neither
  increments nor resets `consecutiveFailures`, and unlike a success does not
  set `lastSuccess`. `bbx health` shows `?` / `inconclusive` and does **not**
  exit 1 for it: nothing found a defect, so gating a script on health must not
  report a healthy box as broken. The vocabulary is in
  `src/shared/inconclusive.ts`.

## Configuration

Global config at `~/.config/beebox/boxes.json` (managed by `bbx boxes add/remove/list` — `bbx scheduler add/remove/list` still work but are deprecated aliases). This manifest now only feeds the scheduler; serving is routed by `bbx hub` via its own `~/.config/beebox/hub.json`:
```json
{
  "boxes": [
    "/Users/you/src/boxes/mybox"
  ]
}
```

Only explicitly added boxes run. Directories like `boxes/scenarios/` won't be included unless added.

## Logs

Per-box JSONL logs at `<boxRoot>/.beebox/scheduler.jsonl` (gitignored, auto-rotated at 1MB).

Each tick produces one JSONL entry per box:
```json
{"ts":"2026-02-24T06:22:27Z","event":"tick","box":"/path/to/box","result":{"ran":2,"skipped":5,"errors":0,"scripts":[{"name":"check-email","status":"ran","command":"bbx wakeup --connector gmail","durationMs":4523},{"name":"check-rss","status":"skipped"}]}}
```

View logs:
```bash
bbx scheduler log                    # All boxes, last 20 entries
bbx scheduler log --box ~/src/boxes/test1  # One box
bbx scheduler log --errors           # Only entries with errors
bbx scheduler log --json             # Raw JSONL
```

The webapp also serves logs at `GET /api/scheduler/log` (filtered to the current box).

## CLI Commands

```
bbx scheduler start [--interval <s>]  # Run daemon foreground
bbx boxes add <path>                  # Add box to the manifest
bbx boxes remove <path>               # Remove box
bbx boxes list                        # Show configured boxes
bbx scheduler status                  # Boxes + launchd status
bbx scheduler log [options]           # View logs
bbx scheduler install                 # Install launchd plist
bbx scheduler uninstall               # Remove launchd plist
```

## Launchd

The plist is at `~/Library/LaunchAgents/com.beebox.scheduler.plist`.

```bash
# Check status
launchctl list com.beebox.scheduler

# Start/stop
launchctl load ~/Library/LaunchAgents/com.beebox.scheduler.plist
launchctl unload ~/Library/LaunchAgents/com.beebox.scheduler.plist

# Reinstall (after code changes, nvm updates, etc.)
bbx scheduler install
```

The plist captures the current `PATH` at install time (needed for nvm). If you update node versions, re-run `bbx scheduler install`.

Stderr goes to `~/.local/share/beebox/scheduler-stderr.log` (for crash diagnostics only — structured logs are in per-box JSONL files).
