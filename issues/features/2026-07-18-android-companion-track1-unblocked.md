---
title: Start the Android companion app (Track 1+) — prerequisites are done
workstream: unknown
priority: backlog
---

`callback-box/docs/plans/android-companion-app.md` is build-ready and its
prerequisites all landed 2026-07-17:

- **Track 0 shipped** — web→native posting is platform-neutral
  (`callbackboxNativePost`, `native-post.ts`, iOS dual-form decode), so the
  Android inbound bridge has a contract to implement.
- **Contract infrastructure live** — `docs/mobile-contract.md` (with the
  tripwire anchor manifest), `docs/mobile-parity.md`, shared golden fixtures
  under `callback-box/test/mobile-contract/fixtures/`, and the
  pre-commit/commit-msg tripwire.
- **Toolchain installed** on the dev machine — OpenJDK 21 (`JAVA_HOME` in the
  shell profiles), Android cmdline-tools, platform-tools, `platforms;android-36`,
  `build-tools;36.0.0`. `./gradlew test` can run headless.

Next session: a worktree on the plan's Track 1 (scaffold `android-app/`,
WebView bridge with `allowedOriginRules`, navigation pinning, fail-closed
feature gate), then Tracks 2+ in plan order. Remember the plan's open
question: the lean is to fix S1/S2/S3 + mobile-send attribution
(`issues/bugs/2026-07-17-*`) server-side before broad Android rollout —
internal/sideload testing can proceed in parallel.

No emulator system image is installed (not needed for unit tests; add one or
use a real device over adb when the device pass matters).
