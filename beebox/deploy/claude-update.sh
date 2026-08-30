#!/usr/bin/env bash
# Wrapper for `claude update` that logs outcome to a persistent file.
# Installed by setup-server.sh at /usr/local/sbin/claude-update.sh and
# invoked by claude-update.service (oneshot, nightly).
#
# On success: appends "ok: ..." line to $LOG.
# On failure: appends "FAIL: ..." line, logs to syslog (daemon.err), exits
# with claude's exit code so systemd marks the service as failed (which
# fires claude-update-failure.service as a belt-and-suspenders signal
# in case this wrapper itself couldn't run).

set -u

LOG=/home/beebox/claude-update.log
CLAUDE=/home/beebox/.local/bin/claude

ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }

if [[ ! -x "$CLAUDE" ]]; then
  echo "[$(ts)] FAIL: $CLAUDE not found or not executable" >> "$LOG"
  logger -t claude-update -p daemon.err "claude binary missing at $CLAUDE"
  exit 127
fi

echo "[$(ts)] starting: claude update" >> "$LOG"
if "$CLAUDE" update >> "$LOG" 2>&1; then
  echo "[$(ts)] ok: claude update finished" >> "$LOG"
  exit 0
else
  rc=$?
  echo "[$(ts)] FAIL: claude update exited $rc" >> "$LOG"
  logger -t claude-update -p daemon.err "claude update failed (exit $rc) on $(hostname)"
  exit "$rc"
fi
