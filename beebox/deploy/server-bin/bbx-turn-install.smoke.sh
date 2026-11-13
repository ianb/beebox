#!/usr/bin/env bash
#
# Smoke test for bbx-turn-install against the real coturn on Ubuntu 24.04.
# coturn runs under systemd, so this uses a throwaway Lima VM, not Docker. A
# dummy interface stands in for the server's public addresses (203.0.113.5 and
# 2001:db8::5, documentation ranges coturn does not deny).
#
#   deploy/server-bin/bbx-turn-install.smoke.sh [--keep]
#
# Needs limactl and network access; not part of the per-commit suite. Run it
# when bbx-turn-install or deploy/coturn/turnserver.conf changes. --keep leaves
# the VM (bbx-turn-smoke) running for a rerun.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
engine="$(cd "$here/../.." && pwd)"
vm=bbx-turn-smoke
keep=0
[[ "${1:-}" == --keep ]] && keep=1
command -v limactl > /dev/null || { echo "limactl is required" >&2; exit 1; }

if ! limactl list -q 2> /dev/null | grep -qx "$vm"; then
  limactl start --name="$vm" --tty=false --cpus=2 --memory=2 template://ubuntu-24.04 > /dev/null
elif [[ "$(limactl list "$vm" --format '{{.Status}}')" != Running ]]; then
  limactl start "$vm" > /dev/null
fi
[[ $keep -eq 1 ]] || trap 'limactl delete -f "$vm" > /dev/null' EXIT

# Lima mounts the home directory read-only at the same path.
limactl shell "$vm" -- sudo ENGINE="$engine" bash -s <<'VM'
# No pipefail: `grep -q` stops reading early and uclient's SIGPIPE would read as a failure.
set -u
S=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
fails=0
pass() { echo "ok   - $1"; }
fail() { echo "FAIL - $1"; fails=$((fails + 1)); }

ip link add dummy0 type dummy 2> /dev/null || true
ip link set dummy0 up
ip addr replace 203.0.113.5/32 dev dummy0
ip addr replace 2001:db8::5/128 dev dummy0 nodad
mkdir -p /home/beebox/.config/beebox
store=/home/beebox/.config/beebox/secrets.json
set_secret() {
  python3 -I -c 'import json,sys; print(json.dumps({"secrets": {"turn-server": {"value": json.dumps({"secret": sys.argv[1], "urls": json.loads(sys.argv[2])})}}, "grants": {}}))' "$S" "$1" > "$store"
}
helper() { bash "$ENGINE/deploy/server-bin/bbx-turn-install" "$ENGINE" > /tmp/helper.log 2>&1; }

rm -f "$store"
if helper && ! systemctl is-active --quiet coturn; then pass "no secret: exits 0, no relay"; else fail "no secret"; cat /tmp/helper.log; fi

set_secret '["turn:198.51.100.9:3478?transport=udp"]'
if ! helper && grep -q "is not an address of this host" /tmp/helper.log; then pass "refuses an address the host does not hold"; else fail "foreign address"; cat /tmp/helper.log; fi

set_secret '["turn:203.0.113.5:3478?transport=udp","turn:203.0.113.5:3478?transport=tcp","turn:[2001:db8::5]:3478?transport=udp"]'
if helper; then pass "installs, configures, and relays between two clients"; else fail "install"; cat /tmp/helper.log; fi
[[ "$(stat -c '%U:%G %a' /etc/turnserver.conf)" == "root:turnserver 640" ]] && pass "config is root:turnserver 0640" || fail "config mode"

systemctl restart coturn
sleep 1
relays() { timeout 30 turnutils_uclient -y -n 2 -m 1 -W $S -u "$1" "${@:2}" 2>&1 | grep -Eq 'start_mclient: tot_send_msgs=([1-9][0-9]*), tot_recv_msgs=\1$'; }
relays tcp -t 203.0.113.5 && pass "relays over TCP 3478" || fail "TCP"
relays v6 -x 2001:db8::5 && pass "relays over IPv6" || fail "IPv6"

n=0
denied() {
  n=$((n + 1))
  timeout 15 turnutils_uclient -n 1 -m 1 -W $S -u "deny$n" "$@" 2>&1 | grep -q "403 (Forbidden IP)"
}
for peer in 127.0.0.1 0.0.0.0 10.0.0.1 169.254.169.254 192.168.1.1; do
  denied -e "$peer" 203.0.113.5 && pass "denies peer $peer" || fail "peer $peer allowed"
done
for peer in ::1 :: ::ffff:127.0.0.1 ::ffff:10.0.0.1 fd00::1; do
  denied -x -e "$peer" 2001:db8::5 && pass "denies peer $peer" || fail "peer $peer allowed"
done

cred() { printf %s "$1" | openssl dgst -sha1 -hmac "$2" -binary | base64; }
u="$(($(date +%s) - 60)):expired"
if timeout 15 turnutils_uclient -y -n 1 -m 1 -u "$u" -w "$(cred "$u" $S)" 203.0.113.5 2>&1 | grep -q "Cannot complete Allocation"; then pass "refuses an expired credential"; else fail "expired credential accepted"; fi
u="$(($(date +%s) + 600)):wrongkey"
if timeout 15 turnutils_uclient -y -n 1 -m 1 -u "$u" -w "$(cred "$u" "ff$S")" 203.0.113.5 2>&1 | grep -q "Cannot complete Allocation"; then pass "refuses a credential signed with another secret"; else fail "foreign credential accepted"; fi

rm -f "$store"
if helper && ! systemctl is-active --quiet coturn && ! systemctl is-enabled --quiet coturn; then pass "secret removed: coturn stopped and disabled"; else fail "removal"; cat /tmp/helper.log; fi

echo "$fails failed"
exit $((fails > 0))
VM
