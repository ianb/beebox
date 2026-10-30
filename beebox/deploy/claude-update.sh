#!/usr/bin/env bash
# Wrapper for `claude update` that logs outcome to a persistent file.
# Installed by hetzner/provision.sh as the ExecStart of claude-update.service
# (oneshot, nightly), run from the deployed tree at
# /opt/beebox/beebox/deploy/claude-update.sh so a deploy picks up edits.
#
# Runs as root. Claude Code has one binary for every user at
# /usr/local/bin/claude (box units hide /home, where the native installer puts
# its versioned binary). This updates root's native install, then re-copies
# the result over /usr/local/bin/claude.
#
# On success: appends "ok: ..." line to $LOG.
# On failure: appends "FAIL: ..." line, logs to syslog (daemon.err), exits
# with the failing step's exit code so systemd marks the service as failed
# (which fires claude-update-failure.service as a belt-and-suspenders signal
# in case this wrapper itself couldn't run).

set -u

LOG=/var/log/beebox/claude-update.log
CLAUDE=/root/.local/bin/claude
INSTALLED=/usr/local/bin/claude

ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }

if [[ ! -x "$CLAUDE" ]]; then
  echo "[$(ts)] FAIL: $CLAUDE not found or not executable" >> "$LOG"
  logger -t claude-update -p daemon.err "claude binary missing at $CLAUDE"
  exit 127
fi

echo "[$(ts)] starting: claude update" >> "$LOG"
if "$CLAUDE" update >> "$LOG" 2>&1 && install -m 0755 "$(readlink -f "$CLAUDE")" "$INSTALLED" >> "$LOG" 2>&1; then
  echo "[$(ts)] ok: claude update finished, copied to $INSTALLED" >> "$LOG"
  exit 0
else
  rc=$?
  echo "[$(ts)] FAIL: claude update or copy to $INSTALLED exited $rc" >> "$LOG"
  logger -t claude-update -p daemon.err "claude update failed (exit $rc) on $(hostname)"
  exit "$rc"
fi
