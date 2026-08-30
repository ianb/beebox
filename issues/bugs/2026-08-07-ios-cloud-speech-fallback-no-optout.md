---
title: "iOS legacy speech fallback streams audio to Apple with no app-level opt-out"
workstream: security-report
area: beebox
filed-by: agent
discovered-in: worktree-security-report — egress inventory for the security report
priority: backlog
---

The iOS app's dictation prefers the on-device `SpeechAnalyzer` /
`SpeechTranscriber` path (iOS 26+, verified local-only). When that path
is unavailable it falls back to the legacy `SFSpeechRecognizer`, which
streams live microphone audio to Apple's cloud servers —
`requiresOnDeviceRecognition` is never set
(`ios-app/BeeBox/Services/SpeechDictation.swift:102,339-350`), and
the app offers no setting to refuse the cloud fallback.

Fix direction: set `requiresOnDeviceRecognition = true` when the device
supports it, or surface a setting (and note the trade-off: on older
devices, refusing cloud recognition means no dictation). The security
report lists this as the iOS app's one non-box egress point.
