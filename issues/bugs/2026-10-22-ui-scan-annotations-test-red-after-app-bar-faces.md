---
title: "`ui-scan.annotations.test.ts` is red on main since the app-bar faces moved the synthetic-click buttons"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-sdk-update — full suite after the Agent SDK 0.3.304 bump
labels: [test-failure]
---

`beebox/src/frontend/test/lib/ui-scan.annotations.test.ts` fails on current
main with "check failed: 4 mismatches" in the test "reveal is the one action
that dispatches a synthetic click, and the attribute…". The expected button
locations no longer match the source:

| expected | actual |
| --- | --- |
| `components/AppNav/nav.tsx:button` | `components/app-bar-faces/ProfileButtonFace.tsx:button` |
| `components/chat/InteractiveChat-composer/view.tsx:button` | `components/app-bar-faces/SessionChipFace.tsx:button` |
| `components/chat/VoiceChip/view.tsx:button` | `components/app-bar-faces/VoiceChipButtonFace.tsx:button` |
| `components/chat/everywhere/InteractiveChat/SessionChip.tsx:button` | `components/chat/InteractiveChat-composer/view.tsx:button` |

The test reads frontend source only (no SDK import). The app-bar faces came in
with `ca433f7d8` ("App bar: AppNavFace, VoiceChipButtonFace and
ProfileButtonFace") and `2d0332476` on 2026-10-21. Either the expected table
needs the new locations, or the faces should keep the annotation where the test
expects it; the owner of that change decides which.

Reproduce: `pnpm -C beebox test` (full run: 12,413 pass, 1 fail, 2 skip on
2026-10-22).
