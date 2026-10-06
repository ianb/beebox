---
title: "The speech browser test fails 14 of 16 checks on main"
workstream: unattached
area: beebox
labels: [tests]
filed-by: agent
discovered-by: agent
discovered-in: worktree-gemini-tts-38 — verifying streamed speech playback
---

`beebox/src/scripts/test-speech-browser.sh` drives the dev-only `/dev/speech`
harness through `bin/browse` and asserts on `window.__speechTestLog`. On
2026-10-05 it reports `2 passed, 14 failed` from the main checkout and from the
`gemini-tts-38` worktree alike, so the failures are not from that branch.

Failing phases: streaming starts before download completes, the menu's
stop/fast-forward/replay items, sticky failure states, and media-rejection
reporting. The two passes are "all three segments downloaded + cached" and
"head segment shows waiting before audio starts" — the steps that do not need
audio to play.

Cause (found while fixing): two path bugs from the layout moves, both silent.

1. The script lives in `beebox/src/scripts/` but still did
   `cd "$(dirname "$0")/.."`, which lands in `beebox/src`, so
   `BROWSE="../bin/browse"` named a file that does not exist. Every browse call
   discards stderr, so each check saw an empty result and failed.
2. The dev TTS mock resolved its fixture MP3s from `import.meta.dirname`. The
   box server runs the bundled `dist/cli.mjs`, where that is `dist/`, so every
   mock request answered "mock TTS fixture missing". A user-story run on
   2026-08-21 recorded this cause (`beebox/docs/user-stories/catalog/2026-08-21.md`)
   but it was not filed. The `pnpm build` script also still copied fixtures
   from their pre-move path.

The autoplay explanation first written here was wrong: the script already
starts playback with a real `bin/browse` click.
