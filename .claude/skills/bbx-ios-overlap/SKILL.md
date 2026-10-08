---
name: bbx-ios-overlap
description: Trace contracts mirrored between beebox web/backend and `ios-app/`. Use for chat upload or transcription endpoints, capture or bulk-upload routes, pairing or auth, the native bridge, session or webview parameters, and iOS work with a web counterpart; not for frontend-only UI without an HTTP or bridge surface.
---

# iOS ↔ web overlap

`ios-app/` is a SwiftUI shell around the same web chat: a `WKWebView` loads a
paired box's chat URL, and native code adds pairing, composer, speech, and
capture. It calls the same HTTP API and bridge as the frontend, with the shapes
duplicated in Swift, so a web/backend change can break iOS with no iOS commit.

The reference is `beebox/docs/mobile-contract.md`: §7 Contract Surface Index,
§8 mirrored constants, §9 open risks, §11 anchor manifest. The pre-commit and
commit-msg hooks (`pnpm mobile-contract-check`) block a commit that stages an
anchored file without that doc, unless it carries a `Contract-Unchanged:
<reason>` trailer. The index lags (no capture rows; bulk-upload's native side
still marked deferred); where a row is missing, the route and Swift files are
the contract, so add the row.

Shared surfaces (backend under `beebox/src/webapp/routes/`, Swift under
`ios-app/BeeBox/`, frontend under `beebox/src/frontend/src/`):

- Chat upload/transcribe: `chat/uploads.ts`, `chat/audio-routes.ts`,
  `chat/register.ts` ↔ `Services/ChatAPI.swift`.
- Capture: `capture/register.ts` ↔ `Services/CaptureAPI.swift`.
- Bulk upload: `bulk-upload/register.ts` ↔ `Services/BulkUploadAPI.swift`.
- Pairing: `pairing.ts`. Swift redeems (`Storage/PairedBoxStore.swift`,
  `Services/PairingURLInbox.swift`); the webview refreshes its session
  (`lib/mobile-auth.ts`); `components/settings/CompanionPairingSection.tsx`
  builds the `beebox://pair?...` link.
- Native bridge: `components/chat/native-post.ts` (web→native) and
  `components/chat/everywhere/InteractiveChat/native-emission.ts`
  (native→web) ↔ `Views/ChatWebView.swift`; golden fixtures in
  `beebox/test/mobile-contract/fixtures/`.
- Auth: native Bearer tokens and the web session are separate (§2.3).

A change to an endpoint path, JSON shape, `WKScriptMessageHandler` channel,
URL-scheme or query parameter, or token handling in these files needs the Swift
side updated (or an issue filed) and the matching §7 row. Internal UI or logic
with no wire change does not. Before trusting a surface, search open issues:
`bin/issues search ios`. In `ios-app/` itself, read `ios-app/CLAUDE.md` first.
