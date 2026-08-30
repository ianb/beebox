---
title: "mobile-contract.md lacks capture rows and marks shipped bulk-upload native side deferred"
workstream: skill-review
area: beebox
filed-by: agent
discovered-in: worktree-skill-review — codex review of the new bbx-ios-overlap skill
---

`docs/mobile-contract.md` presents itself as the canonical Contract Surface
Index (§7) with a same-commit sync rule, but it lags shipped code:

- No capture rows at all, while `src/webapp/routes/capture.ts` ↔
  `ios-app/BeeBox/Services/CaptureAPI.swift` is a live contract surface.
- Bulk-upload endpoints' native side is marked "deferred", while
  `ios-app/BeeBox/Services/BulkUploadAPI.swift` and
  `BulkUploadCoordinator.swift` ship against `src/webapp/routes/bulk-upload.ts`.
- The hook anchor block (~line 785) omits `capture.ts`, `CaptureAPI.swift`,
  `BulkUploadAPI.swift`, and `BulkUploadCoordinator.swift`, so the commit
  tripwire never fires for changes to those files.

The `bbx-ios-overlap` skill currently carries a caveat about this gap; once the
doc's index and anchor block cover capture + bulk, drop that caveat from the
skill.
