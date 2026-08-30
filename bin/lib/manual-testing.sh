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
  matches=$(find "$WT_MONO/issues" -type f -name "$basename" ! -path '*/closed/*')
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
  local result_file original_file
  result_file=$(mktemp -t confirm-tested.XXXXXX)
  original_file=$(mktemp -t confirm-tested-original.XXXXXX)
  cp "$issue" "$original_file"
  if ! (cd "$REPO_DIR" && node --import tsx -e 'import fs from "node:fs"; import {confirmTestedContent} from "./bin/confirm-tested.ts"; const [input, output] = process.argv.slice(1); const result=confirmTestedContent(fs.readFileSync(input,"utf8"),new Date().toISOString().slice(0,10)); fs.writeFileSync(output,JSON.stringify(result));' "$issue" "$result_file"); then
    rm -f "$result_file" "$original_file"
    rmdir "$confirm_lock"
    return 1
  fi
  local close new_rel target workstream
  close=$(jq -r '.close' "$result_file")
  workstream=$(jq -r '.workstream' "$result_file")
  wt_paths_valid_name "$workstream" || {
    rm -f "$result_file" "$original_file"
    rmdir "$confirm_lock"
    echo "confirm-tested: issue has invalid workstream" >&2
    return 1
  }
  new_rel="$rel"
  if [ "$close" = true ]; then
    new_rel="issues/closed/${rel#issues/}"
    target="$WT_MONO/$new_rel"
  fi
  if ! (
    jq -r '.content' "$result_file" > "$issue.tmp" || exit
    mv "$issue.tmp" "$issue" || exit
    if [ "$close" = true ]; then
      mkdir -p "$(dirname "$target")" || exit
      mv "$issue" "$target" || exit
    fi
    git -C "$WT_MONO" add -- "$rel" "$new_rel" || exit
    pnpm --dir "$WT_MONO/beebox" doc-check --fix >/dev/null || exit
    git -C "$WT_MONO" commit --only -m "Confirm manual testing for ${basename%.md}" -- "$rel" "$new_rel" >/dev/null || exit
  ); then
    # Main was clean at preflight, so every tracked worktree/index change here
    # belongs to this attempted transaction. Restore it without a hard reset;
    # the closed target can be untracked when the failure preceded `git add`.
    git -C "$WT_MONO" reset -q
    git -C "$WT_MONO" restore --worktree -- .
    [ -z "${target:-}" ] || rm -f "$target"
    cp "$original_file" "$issue"
    rm -f "$issue.tmp" "$result_file" "$original_file"
    rmdir "$confirm_lock"
    echo "confirm-tested: transition failed; restored $rel" >&2
    return 1
  fi
  rm -f "$result_file" "$original_file"
  rmdir "$confirm_lock"
  local clone="$WT_BOX_ROOT/$workstream/test1"
  if git -C "$clone" show-ref --verify --quiet refs/heads/test-setup 2>/dev/null; then
    git -C "$clone" branch -D test-setup >/dev/null
  fi
}
