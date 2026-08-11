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

# Prints the first cull pin reason and succeeds when the workstream must stay.
workstream_cull_pin_reason() {
  local name="$1" clone="$WT_BOX_ROOT/$1/test1" issue
  if git -C "$clone" show-ref --verify --quiet refs/heads/keep 2>/dev/null; then
    local keep_sha
    keep_sha=$(git -C "$clone" rev-parse refs/heads/keep 2>/dev/null || true)
    if [ -z "$keep_sha" ] || ! git -C "$WT_BOX_SRC" merge-base --is-ancestor "$keep_sha" main 2>/dev/null; then
      echo keep-unmerged
      return 0
    fi
  fi
  if git -C "$clone" show-ref --verify --quiet refs/heads/test-setup 2>/dev/null; then
    echo test-setup
    return 0
  fi
  while IFS= read -r issue; do
    [ -f "$issue" ] || continue
    if grep -q "^workstream: $name$" "$issue" && awk '
      /^---$/ { boundaries++; next }
      boundaries != 1 { next }
      /^needs:.*manual-testing/ { found=1 }
      in_needs && /^[[:space:]]*-[[:space:]]*manual-testing[[:space:]]*$/ { found=1 }
      /^needs:[[:space:]]*$/ { in_needs=1; next }
      in_needs && !/^[[:space:]]*-/ { in_needs=0 }
      END { exit(found ? 0 : 1) }
    ' "$issue"; then
      echo manual-testing
      return 0
    fi
  done < <(find "$WT_MONO/issues" -mindepth 2 -maxdepth 2 -type f -name '*.md' 2>/dev/null)
  return 1
}

# Preserve an unmerged keep branch before its clone is removed. The caller reads
# WORKSTREAM_PRESERVED_BOX_REF; an empty value means keep was absent or already
# reachable from source main. A push failure is fatal so teardown stays intact.
workstream_preserve_keep() {
  local name="$1" clone="$WT_BOX_ROOT/$1/test1" keep_sha
  WORKSTREAM_PRESERVED_BOX_REF=""
  git -C "$clone" show-ref --verify --quiet refs/heads/keep 2>/dev/null || return 0
  keep_sha=$(git -C "$clone" rev-parse refs/heads/keep 2>/dev/null || true)
  if [ -n "$keep_sha" ] && git -C "$WT_BOX_SRC" merge-base --is-ancestor "$keep_sha" main 2>/dev/null; then
    return 0
  fi
  WORKSTREAM_PRESERVED_BOX_REF="keep/$name-$(date -u +%Y-%m-%d)"
  git -C "$clone" push "$WT_BOX_SRC" \
    "refs/heads/keep:refs/heads/$WORKSTREAM_PRESERVED_BOX_REF" >/dev/null
}
