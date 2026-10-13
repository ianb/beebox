---
title: iOS quick capture implementation review
workstream: siri-app-intents
---
# iOS quick capture implementation review

Driver: Codex gpt-6-sol. Independent implementation reviewer: Claude
claude-opus-5-5, via cross-model review. Scope: approved Siri, retained voice,
composite share and later context behavior; no landing or deployment.

## First review and adjudication

| Finding | Adjudication and implementation |
|---|---|
| Context stalls after non-coining engine opens a new chat | Confirmed. Retain the actual assigned conversation identity rather than re-route a follow-up. The review's generic new-route remedy would violate the original-item/chat requirement. |
| Empty transcript retries paid calls for seven days | Confirmed. Retain audio, mark the empty transcript terminal, stop automatic paid retry, and keep explicit Retry. |
| Interrupted Start says another box is recording | Confirmed. Name the waiting interrupted note and require Save or Discard; the control opens recovery rather than replacing it. |
| Offline pending words cannot be discarded | Confirmed. Persist discard-pending before cancellation and require an owner-scoped server tombstone, including before acceptance. A detail 404 alone cannot exclude a buffered upload arriving later. |
| Multipart copy remains after confirmed acceptance | Confirmed. Remove the temporary body on receipt; retain original media for playback until explicit deletion. |
| Foreground receipt leaves child context waiting | Confirmed. Installed receipt handler advances waiting children after durable parent acceptance. |
| Protected foreground recording cannot use its Stop link | Confirmed. Existing-draft links use its original in-app unlock; Siri/App Intents remain refused. |
| Source lookup repeatedly scans every memo | Confirmed. Verify stored/expected source first; scan only on miss. Image acquisition uses generic import, not photo-library gallery. |
| Partial audio looks complete to the agent | Fixed within the approved recovery behavior. Audio-only recordingInterrupted provenance reaches source, framing and detail. It does not become invented human words. |
| App-name synonyms missing | Added spoken name. Apple documents synonym recognition as requiring an Intents extension, absent here; the research records that limitation. Phone matching remains a gate. |

Additional source inspection found that removing/changing the original pairing
could allow the automatic recording limit to save through stale credentials.
Pairing updates now stop recording and retain the draft; Save revalidates the
original pairing and protection before acceptance.

## Evidence and remaining gates

Integrated signing-free simulator build passed without diagnostics. The selected
six-target XCTest batch passed 70 cases with no failures/skips. Native rendering
fixtures show separate capture default, offline state, screenshot with words,
and explicit Add context. Fixtures perform no shared-store or network writes.

A synthetic image was accepted and saved through the actual HTTP route and
opened in the real browser. Synthetic AAC speech was transcribed by the existing
configured service with the expected marker. Neither proves iPhone microphone,
Siri invocation, locking or extension continuation. The physical exercise list
in the plan and originating issue remains required on matched client/server builds.

Six of six real Codex knowledge audits passed against the final prompt, including
material versus instructions, retained audio, partial recording, destination
selection and offline context. Claude's separate audit collector failed before
assessment; its focused issue records that harness failure.

## Second review

Claude claude-opus-5-5 confirmed the previous fixes. Its additional findings:

- Incomplete local capture recovery could be mistaken for accepted voice audio.
  Confirmed: repair a never-uploaded interrupted copy from the original finalized
  recording, verify replay bytes, and preserve the good draft on failure.
- Source move lookup still rescanned because the found path was not retained.
  Confirmed: reconcile the new path or Gone under the source owner's capture lock.
- An unchanged transcription error produced repeated Git commits.
  Confirmed: source error changes are committed; identical retries keep attempt
  metadata in the receipt rather than repeatedly editing the source.
- Local-only discard allegedly had no production caller. Rejected against the
  final source: the removed-pairing recovery view uses it only for proven
  never-uploaded copies. Deleting an uncertain/accepted source requires the
  server tombstone path.

A source inspection also found that removed pairings hid retained local content.
The recovery footer now exposes those copies for inspection and explicit export,
with the original protection gate. It never retries/rebinds to another box.
Unpaired interrupted recording export retains the original draft and makes no
capture/delivery claim. Failed-copy rows explicitly say the save was interrupted.

## Final verification

Eight selected backend doctests passed 152 assertions. Backend/frontend
TypeScript, changed-file ESLint, layout, documentation, mobile-contract and
whitespace checks passed. The final frozen-source XCTest batch passed 70 cases;
its integrated simulator build had no diagnostics.

Three verification-only follow-ups with Claude claude-opus-5-5 resolved the named
remaining problems. They additionally caught protected words in recovery rows
before unlock (now masked), and Stop treating unreadable retained audio as absent
(now explicitly refused). Protection upgrades persist before later file-attribute
changes and survive removing a pairing; interrupted copies retain that policy.
Simulator tests verify requested protection settings, not device encryption.

A narrow residual failure remains: a server process can die after accepting a
non-coining chat delivery but before persisting its delayed assigned conversation
ID. Follow-up words remain visible and blocked for explicit original-chat
reconciliation; the system never silently chooses another chat. Immediate,
delayed and lost-response identity-binding cases pass targeted tests.

Hardware gates remain: Siri matching, microphone handoff (including Siri Stop
possibly marking an interruption), cold/locked starts and continuation, controls,
share dictation/file representation, Files export, background transfer relaunch,
and effective Data Protection. These require the physical phone batch; none is
claimed from simulator tests or the synthetic AAC transcription probe. The security report amendment remains a draft for
human review under the security-report skill; it is not silently auto-committed.
