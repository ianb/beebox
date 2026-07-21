---
title: "Device-store write not fully crash-safe; active-check reads outside the lock"
area: callback-box
filed-by: agent
discovered-in: worktree-open-source-readiness — Codex review of the overnight security fixes
---

**MED correctness. Residuals on the device-store fix
([mobile-device-store-unlocked-rmw](../closed/bugs/2026-07-17-mobile-device-store-unlocked-rmw.md)).**
Found by Codex (2026-07-21). The lock+atomic-write landed and closed the
gross RMW hole; these are the harder-edge robustness gaps. (The lock's own
mutual-exclusion defect is separate and higher —
[file-lock-empty-window-race](2026-07-21-file-lock-empty-window-race.md).)

`writeDeviceStore()` (`src/core/mobile/pairing.ts:96`):

- Calls `fs.writeSync()` once and ignores the returned byte count — a
  permitted short write is then fsynced and renamed, installing truncated or
  zero-byte JSON.
- fsyncs the temp file but not the containing directory after `renameSync()`
  — the rename isn't portably durable; a crash can lose the new dir entry.
- Leaves temp siblings behind on write/rename failure.

`readDeviceStore()` (`:76`) converts every parse/IO failure into an empty
store, so a subsequent pairing redemption can overwrite a transiently
unreadable store with only the new device (silent data loss of other paired
devices).

Also (`isMobileDeviceActive()`, `:271`): reads **outside** the lock, so a
cookie renewal racing a revoke can mint a fresh one-hour cookie from the
pre-revoke view. This stays within the documented one-TTL revocation window,
but contradicts any "stops renewing immediately" claim — worth stating the
guarantee precisely in `docs/mobile-contract.md`.

Fixes: loop `writeSync` until the byte count is fully written (or use
`writeFileSync` with fsync-via-handle), fsync the directory after rename,
clean up temp on failure, and distinguish "store genuinely empty" from "store
unreadable" before letting a write clobber it (fail closed on unreadable).
Bring the active-check inside the lock or document the window.
