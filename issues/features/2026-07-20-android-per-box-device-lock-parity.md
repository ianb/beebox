---
title: Add Android parity for the device-local per-box lock
workstream: unknown
area: callback-box
needs: [design, manual-testing]
filed-by: agent
discovered-in: iOS per-box device lock implementation
---

The iOS companion now supports an optional device-local navigation lock for
each paired box. When the
[Android companion](2026-07-18-android-companion-track1-unblocked.md) reaches
its box-management surface, add the same capability without changing the box
or mobile wire contract.

Expected parity:

- store the opt-in preference locally per paired-box record, defaulting off;
- use Android's platform device-owner authentication (`BiometricPrompt` with
  device credential fallback), not an app-defined PIN;
- require a fresh authentication to open a protected box and a separate fresh
  authentication to disable its lock;
- invalidate the grant on app background and every box switch, including stale
  asynchronous authentication completions;
- keep protected content mounted but opaque, non-interactive, and hidden from
  accessibility while locked;
- permit an explicit degraded path only when the platform reports that no
  device credential is configured.

The threat model and vocabulary are fixed by the
[iOS design](../../callback-box/docs/implemented-plans/ios-per-box-device-lock.md): this is
a phone-share navigation gate, not encryption or server policy. Write an
Android-specific subplan once the companion's Track 1/2 architecture exists,
then add unit tests plus emulator and physical-device lifecycle/authentication
acceptance. Close only when the Android cell in `docs/mobile-parity.md` can be
changed from planned to done or to a documented deliberate divergence.
