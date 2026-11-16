#!/usr/bin/env bash

workstream_reset_test() {
  local name="$1" clone="$WT_BOX_ROOT/$1/test1"
  wt_paths_valid_name "$name" || { echo "reset-test: invalid workstream name" >&2; return 1; }
  [ -d "$clone/.git" ] || { echo "reset-test: no test1 clone for $name" >&2; return 1; }
  git -C "$clone" show-ref --verify --quiet refs/heads/test-setup \
    || { echo "reset-test: $name has no test-setup branch" >&2; return 1; }
  git -C "$clone" checkout -q main \
    || { echo "reset-test: could not check out main for $name" >&2; return 1; }
  git -C "$clone" reset --hard test-setup >/dev/null
}

workstream_confirm_tested() {
  local basename="$1" agent_confirmed="$2"
  [[ "$basename" =~ ^[a-zA-Z0-9_-]+\.md$ ]] \
    || { echo "confirm-tested: invalid issue basename" >&2; return 1; }
  if [ "$agent_confirmed" != true ] && { [ -n "${CLAUDECODE:-}${CLAUDE_CODE_ENTRYPOINT:-}${OPENAI_CODEX:-}" ] || [ ! -t 0 ]; }; then
    echo "confirm-tested: refusing in an agent session without --agent-confirmed" >&2
    return 1
  fi
  [ "$(git -C "$WT_MONO" branch --show-current)" = main ] \
    || { echo "confirm-tested: main checkout is not on main" >&2; return 1; }
  [ ! -f "$WT_MONO/.git/MERGE_HEAD" ] && [ ! -d "$WT_MONO/.git/rebase-merge" ] && [ ! -d "$WT_MONO/.git/rebase-apply" ] \
    || { echo "confirm-tested: main checkout has a merge or rebase in progress" >&2; return 1; }
  [ -z "$(git -C "$WT_MONO" status --porcelain)" ] \
    || { echo "confirm-tested: main checkout must be clean" >&2; return 1; }
  local matches issue rel match_count
  matches=$(find "$WT_MONO/issues" -type f -name "$basename" ! -path '*/closed/*' ! -path '*/deferred/*')
  match_count=$(printf '%s\n' "$matches" | grep -c . || true)
  [ "$match_count" -eq 1 ] || { echo "confirm-tested: expected one open issue named $basename" >&2; return 1; }
  issue="$matches"
  rel="${issue#"$WT_MONO/"}"
  [ -z "$(git -C "$WT_MONO" status --porcelain -- "$rel")" ] \
    || { echo "confirm-tested: issue has uncommitted changes" >&2; return 1; }
  local confirm_lock="$WT_STATE_DIR/confirm-tested.lock" lock_attempt=0
  mkdir -p "$WT_STATE_DIR"
  while ! mkdir "$confirm_lock" 2>/dev/null; do
    lock_attempt=$((lock_attempt + 1))
    [ "$lock_attempt" -lt 20 ] || { echo "confirm-tested: timed out waiting for transition lock" >&2; return 1; }
    sleep 0.1
  done
  # The file step (bin/confirm-tested-apply.ts) refuses before any write: the
  # content checks, a reference it cannot rewrite, a dirty file in either
  # repository. It moves a closing issue through the shared move, which
  # rewrites inbound references and stages nothing, and prints the paths.
  local result_file
  result_file=$(mktemp -t confirm-tested.XXXXXX)
  if ! (cd "$REPO_DIR" && node --import tsx bin/confirm-tested-apply.ts "$WT_MONO" "$rel" >"$result_file"); then
    rm -f "$result_file"
    rmdir "$confirm_lock"
    return 1
  fi
  local close workstream new_rel path
  local -a pub=() priv=() restorable=()
  close=$(jq -r '.close' "$result_file")
  workstream=$(jq -r '.workstream' "$result_file")
  new_rel="$rel"
  [ "$close" != true ] || new_rel="issues/closed/${rel#issues/}"
  while IFS= read -r -d '' path; do pub+=("$path"); done < <(jq -j '.stage.public[] | . + "\u0000"' "$result_file")
  while IFS= read -r -d '' path; do priv+=("$path"); done < <(jq -j '.stage.private[] | . + "\u0000"' "$result_file")
  rm -f "$result_file"
  for path in "${pub[@]}"; do [ "$path" = "$new_rel" ] && [ "$close" = true ] || restorable+=("$path"); done
  if ! wt_paths_valid_name "$workstream" \
    || ! git -C "$WT_MONO" add -A -- "${pub[@]}" \
    || ! git -C "$WT_MONO" commit --only -m "Confirm manual testing for ${basename%.md}" -- "${pub[@]}" >/dev/null; then
    # Every path here was clean at preflight; restore only these, so an edit
    # another process made in main meanwhile is never discarded.
    git -C "$WT_MONO" restore --staged --worktree --source=HEAD -- "${restorable[@]}"
    if [ "$close" = true ]; then
      git -C "$WT_MONO" rm -q --cached --ignore-unmatch -- "$new_rel"
      rm -f "${WT_MONO:?}/$new_rel"
    fi
    [ "${#priv[@]}" -eq 0 ] || git -C "$WT_MONO/private-issues" restore --worktree -- "${priv[@]}"
    rmdir "$confirm_lock"
    echo "confirm-tested: transition failed; restored $rel" >&2
    return 1
  fi
  local status=0
  if [ "${#priv[@]}" -gt 0 ]; then
    if ! git -C "$WT_MONO/private-issues" add -A -- "${priv[@]}" \
      || ! git -C "$WT_MONO/private-issues" commit --only -m "Rewrite links to ${basename%.md} after confirming manual testing" -- "${priv[@]}" >/dev/null; then
      echo "confirm-tested: committed the confirmation; private-issues/ link rewrites left uncommitted: ${priv[*]}" >&2
      status=1
    fi
  fi
  rmdir "$confirm_lock"
  local clone="$WT_BOX_ROOT/$workstream/test1"
  if git -C "$clone" show-ref --verify --quiet refs/heads/test-setup 2>/dev/null; then
    git -C "$clone" branch -D test-setup >/dev/null
  fi
  return "$status"
}
