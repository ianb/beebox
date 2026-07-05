# Enable knip's `exports` check and burn down the backlog

2026-07-04 · backlog.

`knip.json` excludes the `exports` check. Removing the exclusion surfaces
~277 unused exports (measured 2026-07). The goal is "only export what's
needed" as a machine-enforced rule, matching the project's general
strict-by-default lean.

Path: burn down the existing backlog (delete or un-export the dead exports,
in batches — mechanical but wants a full-suite run per batch since removing
an export can ripple into re-export chains), then re-enable the `exports`
check in `knip.json` so new unused exports fail CI going forward.
