#!/usr/bin/env bash
# Shared server-ip lookup for production diagnostic tools. This is deliberately
# not used by deploy.sh: deploys require server-ip in the invoking checkout.

deploy_file_has_value() {
  local config_file="$1"
  [[ -f "$config_file" ]] && LC_ALL=C grep -q '[^[:space:]]' "$config_file"
}

resolve_deploy_file() {
  local deploy_dir="$1"
  local filename="$2"
  local config_file="$deploy_dir/$filename"
  local git_common_dir
  local main_checkout

  if ! deploy_file_has_value "$config_file"; then
    git_common_dir=$(git -C "$deploy_dir" rev-parse \
      --path-format=absolute --git-common-dir 2>/dev/null || true)
    if [[ -n "$git_common_dir" ]]; then
      main_checkout=$(dirname "$git_common_dir")
      config_file="$main_checkout/beebox/deploy/$filename"
    fi
  fi

  deploy_file_has_value "$config_file" || return 1
  printf '%s\n' "$config_file"
}

resolve_server_ip() {
  local deploy_dir="$1"
  local server_ip_file
  local server_ip

  if ! server_ip_file=$(resolve_deploy_file "$deploy_dir" server-ip); then
    echo "Error: No server IP found. Run create-server.sh first." >&2
    return 1
  fi

  server_ip=$(LC_ALL=C tr -d '[:space:]' < "$server_ip_file")
  printf '%s\n' "$server_ip"
}
