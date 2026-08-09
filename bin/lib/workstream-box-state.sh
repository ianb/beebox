#!/usr/bin/env bash
# Read-only test1 clone state for workstream listing and cull eligibility.

workstream_box_state() {
  local clone="$1" source="$2" test_setup=false keep_unmerged=false pristine=null
  local main_sha="" setup_sha="" keep_sha=""
  if [ -d "$clone/.git" ] || git -C "$clone" rev-parse --git-dir >/dev/null 2>&1; then
    if git -C "$clone" show-ref --verify --quiet refs/heads/test-setup; then
      test_setup=true
      main_sha=$(git -C "$clone" rev-parse refs/heads/main 2>/dev/null || true)
      setup_sha=$(git -C "$clone" rev-parse refs/heads/test-setup 2>/dev/null || true)
      pristine=false
      [ -n "$main_sha" ] && [ "$main_sha" = "$setup_sha" ] && pristine=true
    fi
    if git -C "$clone" show-ref --verify --quiet refs/heads/keep; then
      keep_sha=$(git -C "$clone" rev-parse refs/heads/keep 2>/dev/null || true)
      if [ -z "$keep_sha" ] || ! git -C "$source" merge-base --is-ancestor "$keep_sha" main 2>/dev/null; then
        keep_unmerged=true
      fi
    fi
  fi
  jq -n --argjson testSetup "$test_setup" --argjson keepUnmerged "$keep_unmerged" \
    --argjson pristine "$pristine" \
    '{testSetup:$testSetup, keepUnmerged:$keepUnmerged, pristine:$pristine}'
}
