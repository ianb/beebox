---
title: "Device-store write not fully crash-safe; active-check reads outside the lock"
area: callback-box
filed-by: agent
discovered-in: worktree-open-source-readiness — Codex review of the overnight security fixes
labels: [soft-launch]
resolution: implemented
---

**RESOLVED (implemented).** Fixed in `src/core/mobile/pairing.ts`.
`writeDeviceStore` now loops `writeSync` until the whole buffer lands (opening
the temp `wx`), fsyncs the temp, atomically renames, then fsyncs the containing
directory (`fsyncDir`), and cleans up the temp sibling on any failure.
`readDeviceStore` now distinguishes genuinely-empty (ENOENT → `{ devices: [] }`)
from unreadable (other IO error or unparseable JSON → throws the new
`DeviceStoreUnreadableError`), so a mutation can no longer clobber a store it
failed to load — the RMW aborts instead. `isMobileDeviceActive` catches that
error and fails closed (returns `false`). The renewal read stays lock-free by
design; the one-TTL revocation window it leaves is now stated precisely in
`docs/mobile-contract.md` § Cookie lifetime and revocation (decision: documented
rather than moving the read inside the lock, to keep the per-request renewal path
free of a cross-process lock — matches the module's deliberate "read-only
accessors don't take the lock" design). Tests added in
`test/core/mobile/pairing-store-concurrency.doctest.md`: unreadable store →
redemption throws and the file is left intact; `isMobileDeviceActive` → `false`
on corrupt store; 200-device store round-trips with no temp litter.

---

**MED correctness. Residuals on the device-store fix
([mobile-device-store-unlocked-rmw](2026-07-17-mobile-device-store-unlocked-rmw.md)).**
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
