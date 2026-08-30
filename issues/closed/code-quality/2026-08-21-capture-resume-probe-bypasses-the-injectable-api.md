---
title: "The capture resume probe bypasses the injectable CaptureApi, so the dev harness cannot fake it"
workstream: small-bugs-batch
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-user-stories-refresh — exercising capture states on /dev/capture-mode
resolution: implemented
---

Closed 2026-08-29 by this commit (`fix(capture): inject the resumable-session probe`): the resume hook now gets the list operation from `CaptureApi`, and the dev harness supplies a fake.

Capture's network calls go through an injectable seam so the dev harness can
mount capture mode against an in-memory fake: `CaptureApi` +
`useCaptureApi()` (`beebox/src/frontend/src/pages/capture/capture-api-context.tsx:19-48`),
faked by `makeFakeApi` in
`beebox/src/frontend/src/pages/dev/components/CaptureModeHarness.tsx:122-153`.

The resumable-session probe is not part of that seam. `useCaptureResume` imports
`listResumableCaptureSessions` straight from the module
(`beebox/src/frontend/src/components/capture/useCaptureResume.ts:18`, called
at `:45`), so it always makes a real network call.

Two consequences on `/dev/capture-mode`: every open of the overlay logs
`[capture] Failed to load resumable sessions: ResumableCaptureListError` and
lights the nav's error badge, and the resume dialog can never appear there — the
harness cannot present the state it exists to present.
