#!/usr/bin/env bash
#
# Smoke test for the per-box units (deploy/systemd/beebox-box@.*, box-sandbox.conf).
# Runs AS ROOT ON A THROWAWAY SYSTEMD HOST with the units installed and bbx on
# PATH (the probe VM from docs/plans/per-box-units.md; `deploy.sh` installs the
# units, or install them by hand as the header of each file says). It makes two
# fixture boxes with two users, starts one through its socket, and checks from
# inside that box's view that the other box does not exist and is unreadable by
# path. Never run it on a host with real boxes: it creates and deletes users.
#
#   box-units.smoke.sh            run every case, then clean up
#   box-units.smoke.sh --keep     leave the fixtures for inspection
set -euo pipefail

[[ "$EUID" -eq 0 ]] || { echo "run as root" >&2; exit 1; }
keep=""
[[ "${1:-}" == --keep ]] && keep=1
for unit in beebox-box@.socket beebox-box@.service; do
  [[ -e "/etc/systemd/system/$unit" ]] || { echo "missing /etc/systemd/system/$unit" >&2; exit 1; }
done
[[ -e /etc/systemd/system/beebox-box@.service.d/box-sandbox.conf ]] || { echo "missing box-sandbox.conf drop-in" >&2; exit 1; }
id beebox >/dev/null || { echo "no beebox user" >&2; exit 1; }
command -v bbx >/dev/null || { echo "bbx is not on PATH" >&2; exit 1; }

A=smoke-a; B=smoke-b
failures=0
ok()   { echo "ok   $1"; }
fail() { echo "FAIL $1"; failures=$((failures + 1)); }
check() { # check <name> -- command...   (passes when the command exits 0)
  local name="$1"; shift 2
  if "$@" >/dev/null 2>&1; then ok "$name"; else fail "$name"; fi
}
check_not() { # passes when the command exits non-zero
  local name="$1"; shift 2
  if "$@" >/dev/null 2>&1; then fail "$name"; else ok "$name"; fi
}

# Invoked by the EXIT trap below.
# shellcheck disable=SC2329
cleanup() {
  [[ -n "$keep" ]] && { echo "keeping fixtures ($A, $B)"; return; }
  for slug in "$A" "$B"; do
    systemctl stop "beebox-box@$slug.socket" "beebox-box@$slug.service" 2>/dev/null || true
    systemctl reset-failed "beebox-box@$slug.service" 2>/dev/null || true
    rm -f "/run/beebox/$slug.hub-secret"
    if id "bbx-$slug" >/dev/null 2>&1; then userdel -r "bbx-$slug" 2>/dev/null || userdel "bbx-$slug" || true; fi
    rm -rf "/var/lib/beebox/$slug"
    getent group "bbx-$slug" >/dev/null && groupdel "bbx-$slug" || true
  done
}
trap cleanup EXIT

make_box() { # make_box <slug>
  local slug="$1" home="/var/lib/beebox/$1"
  getent group beebox-boxes >/dev/null || groupadd beebox-boxes
  if ! id "bbx-$slug" >/dev/null 2>&1; then
    useradd --system --user-group -G beebox-boxes -d "$home" -m -s /bin/bash "bbx-$slug"
  fi
  chmod 0751 "$home"
  # The box: made as the box user with the unit's umask, so nothing in it is readable by path.
  runuser -u "bbx-$slug" -- bash -c "umask 077 && cd '$home' && bbx engine init box >/dev/null"
  chmod 0751 "$home/box"
  echo "marker-$slug" > "$home/box/marker.txt"
  chown "bbx-$slug:bbx-$slug" "$home/box/marker.txt"
  chmod 0600 "$home/box/marker.txt"
  # The hub secret, as the hub would write it: owned by the hub user, 0600.
  runuser -u beebox -- bash -c "umask 077 && head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' > /run/beebox/$slug.hub-secret"
  systemctl start "beebox-box@$slug.socket"
}

echo "== fixtures"
make_box "$A"
make_box "$B"
check "socket for $A listens" -- test -S "/run/beebox/$A.sock"
check "socket is bbx-$A:beebox 0660" -- bash -c "[[ \$(stat -c '%U:%G %a' /run/beebox/$A.sock) == 'bbx-$A:beebox 660' ]]"

echo "== activation"
# The hub user connects; the service starts on this first connection.
code=$(runuser -u beebox -- curl -s -o /dev/null -w '%{http_code}' --max-time 120 --unix-socket "/run/beebox/$A.sock" http://box/api/build-info || true)
if [[ "$code" == 200 ]]; then ok "first connection starts $A and answers 200"; else fail "first connection: HTTP $code"; journalctl -u "beebox-box@$A.service" -n 30 --no-pager; fi
check "beebox-box@$A.service is active" -- systemctl is-active --quiet "beebox-box@$A.service"
check "the engine runs as bbx-$A" -- bash -c "[[ \$(ps -o user= -p \$(systemctl show -p MainPID --value beebox-box@$A.service)) == bbx-$A ]]"
check_not "a sibling box user cannot connect" -- runuser -u "bbx-$B" -- curl -s --max-time 5 --unix-socket "/run/beebox/$A.sock" http://box/api/build-info
check "$B is still inactive (not woken)" -- bash -c "[[ \$(systemctl is-active beebox-box@$B.service) == inactive ]]"

echo "== the hub secret reaches the engine as a credential"
# systemd copies the hub's file into the unit's credentials directory, which the
# engine turns into BBX_HUB_SECRET at start (src/lib/systemd-credentials.ts; its
# test covers the adoption). /proc/<pid>/environ shows the exec-time environment,
# so the credential must not appear there, and neither may the sibling's secret.
main_pid=$(systemctl show -p MainPID --value "beebox-box@$A.service")
cred_dir=$(cat "/proc/$main_pid/environ" | tr '\0' '\n' | sed -n 's/^CREDENTIALS_DIRECTORY=//p')
check "the unit has a credentials directory" -- test -n "$cred_dir"
check "hub-secret credential equals /run/beebox/$A.hub-secret" -- bash -c "[[ \$(cat '$cred_dir/hub-secret') == \$(cat /run/beebox/$A.hub-secret) ]]"
check_not "the secret is not in the exec-time environment" -- bash -c "tr '\0' '\n' < /proc/$main_pid/environ | grep -qF \"\$(cat /run/beebox/$A.hub-secret)\""
check_not "the sibling's secret is not in $A's environment" -- bash -c "tr '\0' '\n' < /proc/$main_pid/environ | grep -qF \"\$(cat /run/beebox/$B.hub-secret)\""

echo "== the scheduler's one root path"
if [[ -e /usr/local/sbin/bbx-box-run ]] && id beebox-sched >/dev/null 2>&1; then
  check "a pass runs for $A through bbx-box-run" -- runuser -u beebox-sched -- sudo -n /usr/local/sbin/bbx-box-run "$A" scheduler-pass
  check "the pass wrote the box's scheduler log" -- test -s "/var/lib/beebox/$A/box/.beebox/scheduler.jsonl"
  check_not "an unknown slug is refused" -- runuser -u beebox-sched -- sudo -n /usr/local/sbin/bbx-box-run no-such-box scheduler-pass
  check_not "an operation outside the set is refused" -- runuser -u beebox-sched -- sudo -n /usr/local/sbin/bbx-box-run "$A" shell
  check_not "the hub user may not call it" -- runuser -u beebox -- sudo -n /usr/local/sbin/bbx-box-run "$A" scheduler-pass
else
  echo "SKIP bbx-box-run: wrapper or beebox-sched user absent (deploy installs them)"
fi

echo "== the view from inside $A's unit"
# The same sandbox the unit runs with, applied to a one-off command as the box user.
props=()
while IFS= read -r line; do
  [[ "$line" =~ ^[A-Za-z]+= ]] || continue
  props+=(-p "${line//%i/$A}")
done < /etc/systemd/system/beebox-box@.service.d/box-sandbox.conf
# Invoked through check/check_not.
# shellcheck disable=SC2329
in_a() { systemd-run --quiet --wait --pipe --collect --uid "bbx-$A" --gid "bbx-$A" "${props[@]}" -- "$@"; }
check "own home is visible and writable" -- in_a bash -c "ls /var/lib/beebox/$A/box/package.json && touch /var/lib/beebox/$A/write-probe && rm /var/lib/beebox/$A/write-probe"
check "the sibling's home does not exist in the view" -- in_a bash -c "[[ ! -e /var/lib/beebox/$B ]]"
check "the boxes directory lists only this box" -- in_a bash -c "[[ \$(ls /var/lib/beebox) == '$A' ]]"
check_not "/home is hidden" -- in_a ls /home/beebox
check_not "the system tree is read-only" -- in_a touch /usr/local/bin/probe
check_not "no sudo (NoNewPrivileges)" -- in_a sudo -n true
check "the toolchain runs inside the view" -- in_a bash -c "git --version && node --version && git annex version --raw"

echo "== by path, outside any unit, as the sibling user"
check "the sibling home is traversable (0751)" -- runuser -u "bbx-$B" -- test -d "/var/lib/beebox/$A/box"
check_not "the sibling home is not listable" -- runuser -u "bbx-$B" -- ls "/var/lib/beebox/$A"
check_not "a file in the sibling box is unreadable" -- runuser -u "bbx-$B" -- cat "/var/lib/beebox/$A/box/marker.txt"
check_not "the sibling's hub secret is unreadable" -- runuser -u "bbx-$B" -- cat "/run/beebox/$A.hub-secret"
check_not "the hub user cannot read the box's files by path" -- runuser -u beebox -- cat "/var/lib/beebox/$A/box/marker.txt"

echo "== stop"
check "the service stops cleanly" -- systemctl stop "beebox-box@$A.service"
check "the socket keeps listening after the service stopped" -- test -S "/run/beebox/$A.sock"
code=$(runuser -u beebox -- curl -s -o /dev/null -w '%{http_code}' --max-time 120 --unix-socket "/run/beebox/$A.sock" http://box/api/build-info || true)
if [[ "$code" == 200 ]]; then ok "the next connection starts it again"; else fail "restart on connection: HTTP $code"; fi

echo "failures: $failures"
exit $(( failures > 0 ))
