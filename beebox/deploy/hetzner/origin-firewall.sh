#!/usr/bin/env bash
# Limit the origin's web ports to Cloudflare with a Hetzner Cloud Firewall.
#
#   origin-firewall.sh <server> [--allow-http]
#
# SSH and ICMP stay open to everyone. 443 opens to Cloudflare's published ranges;
# --allow-http also opens 80 to them. Every run replaces the firewall's rules, so
# re-run it when Cloudflare changes its ranges, and edit this file rather than
# the Hetzner console. Rules changes apply to new connections only.
# See docs/server/provisioning.md, "Origin TLS".
set -euo pipefail

FIREWALL_NAME="beebox-origin"

usage="usage: origin-firewall.sh <server> [--allow-http]"
[[ $# -ge 1 && "$1" != -* ]] || { echo "$usage" >&2; exit 2; }
SERVER_NAME="$1"
allow_http=0
case "${2:-}" in
  "") ;;
  --allow-http) allow_http=1 ;;
  *) echo "$usage" >&2; exit 2 ;;
esac

ipv4=$(curl -fsS --max-time 20 https://www.cloudflare.com/ips-v4)
ipv6=$(curl -fsS --max-time 20 https://www.cloudflare.com/ips-v6)

# Fails on anything but CIDRs, so an error page never reaches the firewall.
rules=$(IPV4="$ipv4" IPV6="$ipv6" ALLOW_HTTP="$allow_http" python3 -I - <<'PY'
import ipaddress, json, os, sys

def ranges(name, version):
    found = [str(ipaddress.ip_network(line)) for line in os.environ[name].split()]
    if not found or any(ipaddress.ip_network(r).version != version for r in found):
        sys.exit(f"origin-firewall: bad Cloudflare range list in {name}")
    return found

cloudflare = ranges("IPV4", 4) + ranges("IPV6", 6)
everyone = ["0.0.0.0/0", "::/0"]
rules = [
    {"direction": "in", "protocol": "tcp", "port": "22", "source_ips": everyone},
    {"direction": "in", "protocol": "icmp", "source_ips": everyone},
    {"direction": "in", "protocol": "tcp", "port": "443", "source_ips": cloudflare},
]
if os.environ["ALLOW_HTTP"] == "1":
    rules.append({"direction": "in", "protocol": "tcp", "port": "80", "source_ips": cloudflare})
print(json.dumps(rules, separators=(",", ":")))
PY
)

# Prints "absent", "detached", or "attached".
state=$(
  server_id=$(hcloud server describe "$SERVER_NAME" -o format='{{.ID}}')
  hcloud firewall list -o json | FIREWALL_NAME="$FIREWALL_NAME" SERVER_ID="$server_id" python3 -I -c '
import json, os, sys
matches = [f for f in json.load(sys.stdin) or [] if f["name"] == os.environ["FIREWALL_NAME"]]
if not matches:
    print("absent")
else:
    ids = [str(a["server"]["id"]) for a in matches[0].get("applied_to") or [] if a["type"] == "server"]
    print("attached" if os.environ["SERVER_ID"] in ids else "detached")
'
)

if [[ "$state" == absent ]]; then
  printf '%s' "$rules" | hcloud firewall create --name "$FIREWALL_NAME" --rules-file -
else
  printf '%s' "$rules" | hcloud firewall replace-rules --rules-file - "$FIREWALL_NAME"
fi
if [[ "$state" != attached ]]; then
  hcloud firewall apply-to-resource --type server --server "$SERVER_NAME" "$FIREWALL_NAME"
fi
