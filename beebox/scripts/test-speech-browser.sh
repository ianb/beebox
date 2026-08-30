#!/usr/bin/env bash
#
# Browser verification for the speech replay menu + playback pipeline.
#
# Drives the dev-only /dev/speech harness through bin/browse (real Chrome) and
# asserts behavior against window.__speechTestLog. Requires the monorepo dev
# router to be running (pnpm dev) so the worktree's app is served.
#
# What it checks:
#   1. Streaming playback starts BEFORE the download completes (the perf win).
#   2. Replaying cached audio is a cache hit (no re-download).
#   3. Fast-forward advances to the next segment.
#   4. Stop ends playback.
#   5. Replay-from jumps to the chosen segment.
#   6. Menu disabled states when idle (Stop / Fast-forward greyed).
#   7. Generation failures remain visible while later segments play.
#   8. Browser media rejections are reported as failures, not success.
#
# Menu items are activated via element.click() rather than synthetic pixel
# clicks: agent-browser's coordinate click races the dropdown's
# outside-mousedown close on absolutely-positioned menus. element.click()
# exercises the same real React onClick handlers a mouse would.

set -uo pipefail
cd "$(dirname "$0")/.."
BROWSE="../bin/browse"

pass=0
fail=0
ok()   { echo "  PASS: $1"; pass=$((pass+1)); }
bad()  { echo "  FAIL: $1"; fail=$((fail+1)); }

# Run a JS expression in the page; strip backslash-escaping so the JSON the
# browser returns can be grepped with plain "key":value patterns.
bjs() { "$BROWSE" eval --stdin 2>/dev/null | tr -d '\\'; }

open_page() { # $1 = query string
  "$BROWSE" open "/dev/speech?$1" >/dev/null 2>&1
  sleep 1
}

reset_log() { "$BROWSE" eval "window.__speechTestLog.length=0; 'reset'" >/dev/null 2>&1; }

# Open the speaker menu (programmatically) and click a menu item whose trimmed
# text starts with the given prefix. Two steps because opening is a React state
# update that renders the items on the next tick.
menu_click() { # $1 = item text prefix (quoted JS string)
  "$BROWSE" eval "document.querySelector('[aria-label=\"Speech options\"]').click(); 'open'" >/dev/null 2>&1
  sleep 0.3
  cat <<EOF | bjs >/dev/null
(() => {
  const items = Array.from(document.querySelectorAll('[role=menuitem]'));
  // Match by aria-label (icon buttons: Stop / Fast-forward) or by text prefix
  // (worded items: Replay, chunk labels).
  const el = items.find(b => {
    const al = b.getAttribute('aria-label') || '';
    return al === $1 || b.textContent.trim().startsWith($1);
  });
  if (!el) return 'NOTFOUND';
  el.click();
  return 'clicked';
})()
EOF
}

echo "=== Phase 1: streaming starts before download completes ==="
open_page "delayMs=300&chunkMs=300"
"$BROWSE" find text "Play all" click >/dev/null 2>&1   # real gesture (grants autoplay)
"$BROWSE" wait --fn "(window.__speechTestLog||[]).some(e=>e.event==='audio.start')" >/dev/null 2>&1
RES=$(cat <<'EOF' | bjs
(() => {
  const L = window.__speechTestLog||[];
  const head = "This is the firs";
  const ds = L.find(e=>e.event==='download.start' && e.detail && e.detail.label===head);
  const as = L.find(e=>e.event==='audio.start' && e.detail && e.detail.label===head);
  const dc = L.find(e=>e.event==='download.complete' && e.detail && e.detail.label===head);
  return JSON.stringify({ hasStream: !!(ds&&ds.detail.streaming), startedBeforeComplete: !!(as && (!dc || as.t < dc.t)) });
})()
EOF
)
echo "  $RES"
echo "$RES" | grep -q '"hasStream":true' && ok "head segment used streaming path" || bad "head segment did not stream"
echo "$RES" | grep -q '"startedBeforeComplete":true' && ok "audio started before download completed" || bad "audio did NOT start before download completed"

echo "=== Phase 2: cache, skip, stop, replay-from (fast mock) ==="
open_page "delayMs=100&chunkMs=8"
"$BROWSE" find text "Play all" click >/dev/null 2>&1   # real gesture + populate cache
"$BROWSE" wait --fn "(window.__speechTestLog||[]).filter(e=>e.event==='download.complete').length>=3" >/dev/null 2>&1
ok "all three segments downloaded + cached"

# --- idle disabled states ---
"$BROWSE" eval "window.__speechHarness.stop(); 'stop'" >/dev/null 2>&1
"$BROWSE" wait --fn "window.__speechState && window.__speechState.isPlaying===false" >/dev/null 2>&1
"$BROWSE" eval "document.querySelector('[aria-label=\"Speech options\"]').click(); 'open'" >/dev/null 2>&1
sleep 0.3
DIS=$(cat <<'EOF' | bjs
(() => {
  const items = Array.from(document.querySelectorAll('[role=menuitem]'));
  const stop = items.find(b => b.getAttribute('aria-label')==='Stop');
  const ff = items.find(b => b.getAttribute('aria-label')==='Fast-forward');
  return JSON.stringify({ stopDisabled: !!(stop && stop.disabled), ffDisabled: !!(ff && ff.disabled) });
})()
EOF
)
echo "  $DIS"
echo "$DIS" | grep -q '"stopDisabled":true' && ok "Stop disabled when idle" || bad "Stop not disabled when idle"
echo "$DIS" | grep -q '"ffDisabled":true' && ok "Fast-forward disabled when idle" || bad "Fast-forward not disabled when idle"
"$BROWSE" eval "document.querySelector('[aria-label=\"Speech options\"]').click(); 'close'" >/dev/null 2>&1

# --- replay from cache (no re-download) ---
reset_log
menu_click '"Replay"'
"$BROWSE" wait --fn "(window.__speechTestLog||[]).some(e=>e.event==='audio.start')" >/dev/null 2>&1
sleep 0.5
CACHE=$(cat <<'EOF' | bjs
(() => {
  const L = window.__speechTestLog||[];
  return JSON.stringify({
    menuReplay: L.some(e=>e.event==='menu.replay'),
    cacheHits: L.filter(e=>e.event==='cacheHit').length,
    downloads: L.filter(e=>e.event==='download.start').length,
  });
})()
EOF
)
echo "  $CACHE"
echo "$CACHE" | grep -q '"menuReplay":true' && ok "Replay menu item invoked the hook" || bad "Replay menu item did nothing"
echo "$CACHE" | grep -q '"downloads":0' && ok "replay re-downloaded nothing (cache hit)" || bad "replay re-downloaded audio"
echo "$CACHE" | grep -qE '"cacheHits":[1-9]' && ok "replay served from cache" || bad "no cache hits on replay"

# --- fast-forward advances ---
reset_log
menu_click '"Fast-forward"'
"$BROWSE" wait --fn "(window.__speechTestLog||[]).some(e=>e.event==='skip')" >/dev/null 2>&1
sleep 0.5
SKIP=$(cat <<'EOF' | bjs
(() => {
  const L = window.__speechTestLog||[];
  const starts = L.filter(e=>e.event==='audio.start').map(e=>e.detail && e.detail.label);
  return JSON.stringify({ sawSkip: L.some(e=>e.event==='skip'), startsAfterSkip: starts });
})()
EOF
)
echo "  $SKIP"
echo "$SKIP" | grep -q '"sawSkip":true' && ok "Fast-forward emitted a skip" || bad "Fast-forward did not skip"
echo "$SKIP" | grep -q 'And now here is' && ok "fast-forward advanced to the next segment" || bad "fast-forward did not advance to next segment"

# --- stop ends playback ---
menu_click '"Stop"'
"$BROWSE" wait --fn "window.__speechState && window.__speechState.isPlaying===false" >/dev/null 2>&1
STOPPED=$("$BROWSE" eval "JSON.stringify(window.__speechState.isPlaying)" 2>/dev/null | tr -d '\\')
echo "  isPlaying=$STOPPED"
echo "$STOPPED" | grep -q 'false' && ok "Stop ended playback" || bad "Stop did not end playback"

# --- replay-from a later chunk ---
reset_log
menu_click '"Finally"'
"$BROWSE" wait --fn "(window.__speechTestLog||[]).some(e=>e.event==='audio.start')" >/dev/null 2>&1
sleep 0.3
FROM=$(cat <<'EOF' | bjs
(() => {
  const L = window.__speechTestLog||[];
  const first = L.find(e=>e.event==='audio.start');
  return JSON.stringify({ firstLabel: first && first.detail && first.detail.label });
})()
EOF
)
echo "  $FROM"
echo "$FROM" | grep -q '"firstLabel":"Finally' && ok "replay-from jumped to the chosen segment" || bad "replay-from did not start at chosen segment"

echo "=== Phase 3: generation failures remain visible while the queue advances ==="
open_page "delayMs=2000&chunkMs=8&failText=second"
"$BROWSE" find text "Play all" click >/dev/null 2>&1
"$BROWSE" wait --fn "document.querySelector('[data-chunk=\"0\"]')?.dataset.speechState==='waiting'" >/dev/null 2>&1
ok "head segment shows waiting before audio starts"
"$BROWSE" wait --fn "document.querySelector('[data-chunk=\"1\"]')?.dataset.speechState==='failed'" >/dev/null 2>&1
FAILED=$(cat <<'EOF' | bjs
(() => {
  const chunks = Array.from(document.querySelectorAll("[data-chunk]"));
  return JSON.stringify({
    failed: chunks.filter((el) => el.dataset.speechState === "failed").map((el) => el.dataset.chunk),
    state: window.__speechState,
  });
})()
EOF
)
echo "  $FAILED"
echo "$FAILED" | grep -q '"failed":\["1"\]' && ok "failed segment remains visibly failed" || bad "failed segment state was lost"
"$BROWSE" wait --fn "window.__speechState && window.__speechState.isPlaying===false" >/dev/null 2>&1
FINAL_FAILED=$(cat <<'EOF' | bjs
JSON.stringify(Array.from(document.querySelectorAll("[data-chunk]")).filter((el) => el.dataset.speechState === "failed").map((el) => el.dataset.chunk))
EOF
)
echo "$FINAL_FAILED" | grep -q '\["1"\]' && ok "failure remains after later speech finishes" || bad "failure did not stick through queue completion"

echo "=== Phase 4: media play rejection is not reported as success ==="
open_page "delayMs=10&chunkMs=8&rejectPlayback=1"
"$BROWSE" find text "Play all" click >/dev/null 2>&1
"$BROWSE" wait --fn "window.__speechState && window.__speechState.isPlaying===false && Object.keys(window.__speechState.segmentStates).length===3" >/dev/null 2>&1
MEDIA_FAILED=$("$BROWSE" eval "JSON.stringify(window.__speechState.segmentStates)" 2>/dev/null | tr -d '\\')
echo "  $MEDIA_FAILED"
echo "$MEDIA_FAILED" | grep -q '"0":"failed"' \
  && echo "$MEDIA_FAILED" | grep -q '"1":"failed"' \
  && echo "$MEDIA_FAILED" | grep -q '"2":"failed"' \
  && ok "media rejections mark every affected segment failed" \
  || bad "media rejection was mistaken for successful playback"

echo ""
echo "=== RESULT: $pass passed, $fail failed ==="
[ "$fail" -eq 0 ]
