#!/usr/bin/env bash
# Retired. This file stays so old links resolve.
#
# Host provisioning moved to hetzner/cloud-init.yaml (packages, toolchain,
# users; passed as user data) and hetzner/provision.sh (the root steps after
# cloud-init). deploy/deploy.sh installs units, sudoers and the nginx site.
# create-server.sh runs the new flow.
echo "setup-server.sh is retired: use create-server.sh, which passes cloud-init.yaml as user data and runs provision.sh." >&2
exit 1
