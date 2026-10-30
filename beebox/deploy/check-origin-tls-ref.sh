#!/usr/bin/env bash
# Refuse to deploy a ref whose nginx site has no 443 listener.
#
#   check-origin-tls-ref.sh <repo> <sha>
#
# Cloudflare connects to the origin on 443, so installing an older port-80-only
# site takes production offline, and deploy.sh's health check cannot see it: it
# uses localhost:3210. To go back that far, first return Cloudflare to plain HTTP
# (docs/server/provisioning.md, "Origin TLS"), then set
# BBX_DEPLOY_ALLOW_NO_ORIGIN_TLS=1.
set -euo pipefail

[[ $# -eq 2 ]] || { echo "usage: check-origin-tls-ref.sh <repo> <sha>" >&2; exit 2; }
repo="$1"
sha="$2"

[[ "${BBX_DEPLOY_ALLOW_NO_ORIGIN_TLS:-}" == 1 ]] && exit 0
# A directive at the start of a line: a commented-out listener does not count.
if ! site=$(git -C "$repo" show "$sha:beebox/deploy/nginx/beebox.conf" 2>/dev/null) || ! grep -Eq '^[[:space:]]*listen 443 ssl' <<<"$site"; then
  echo "deploy: refusing $sha: its nginx site has no 443 listener, and Cloudflare connects to the origin on 443." >&2
  echo "deploy: this would take the site offline. See docs/server/provisioning.md, Origin TLS, before setting BBX_DEPLOY_ALLOW_NO_ORIGIN_TLS=1." >&2
  exit 1
fi
