# The package file stops describing the code
## Supporting: beebox/CLAUDE.md, 184 → 67 lines (d7b47dfde)
```text
BEFORE (from a 45-line annotated source tree)
src/lib/          THE single home for generic cross-cutting helpers (no core/
                  deps) — check here before writing your own. atomic-write
                  (writeFileAtomic — the crash-safe whole-file replace every
                  small state/credential store uses), content-hash,
                  mimetype, filename, file-exists, public-url, awake-timeout,
                  sleep, git*/paths/box-shape/box-layout* (promoted from
                  cli/lib), time (getBoxTime), format (chalk), box-config.

AFTER
Open the owner for the area being changed:
- Backend domain and orchestration: `src/core/`; reactor details: the reactor
  design doc.
- Generic dependency-light helpers: `src/lib/`; browser/server shared code:
  `src/shared/`; CLI-domain helpers: `src/cli/lib/`; ambient declarations
  only: `src/types/`. The dependency rules and exact distinctions are in the
  module map.
```
- Also removed: the cross-model rule's parenthetical changelog ("This used to be written as a Fable-only default; that was wrong, corrected 2026-07-30…")

Notes:
The pilot ran 12 routing cases and 5 authority scenarios on four models; all predeclared boundaries held. It also found models copying invented details from a worked briefing example, which was replaced with fill-in fields.
