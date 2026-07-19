# Callback Box iOS App

Native iOS companion app for Callback Box. This project is intentionally thin
at first: the conversation view stays in the box's web chat via `WKWebView`,
loaded with `?nativeComposer=1`, while native code owns pairing, native input
controls, and the paired-box shell.

Agent and contributor build/test guidance lives in [`CLAUDE.md`](CLAUDE.md).

## Current Setup

- SwiftUI app target: `CallbackBox`
- Minimum iOS: 17.0
- No external dependencies
- Pairing: scan/open a `callbackbox://pair?...&pairingToken=...` URL from a
  box Settings QR code. The app redeems that token for a per-device mobile
  auth token.
- Manual/dev pairing is still available from the app and URL scheme. In release
  builds, raw `authToken=` URL imports are ignored; use a pairing token instead.
- Native text, photo, and speech input is delivered into the embedded web chat
  via a small same-origin `WKWebView` bridge. Keep that bridge in sync with the
  frontend native-emission handler.
- Speech input uses Apple's on-device `SpeechAnalyzer` and `SpeechTranscriber`
  on iOS 26. `DictationTranscriber` covers unsupported iOS 26 hardware/locales,
  and `SFSpeechRecognizer` remains the iOS 17–25 fallback. The first use of a
  locale may download its system-managed model. A recorded WAV is still kept in
  parallel for the box's HQ transcription and diarization pass at send time.

Once Xcode is installed, open:

```sh
open ios-app/CallbackBox.xcodeproj
```

## Simulator Pairing Shortcut

After building and installing the app on a simulator, pair the local test box
without typing in iOS by writing the dev store directly:

```sh
ios-app/scripts/pair-simulator-box
```

Optional arguments are `device base-url label session-id`.

The app also supports a URL-scheme import, but iOS shows a first-time
confirmation dialog when it is opened from outside the app:

```sh
xcrun simctl openurl booted 'callbackbox://pair?label=Local%20test%20box&baseURL=http%3A%2F%2F127.0.0.1%3A3210%2Fmain%2Ftest1'
```

In DEBUG builds, the empty state also shows a "Use Local Test Box" button.

## Composer Layout Fixtures

A DEBUG build can render the production native composer without a live box:

```sh
xcrun simctl launch --terminate-running-process booted app.callbackbox.ios \
  --composer-fixture=many-attachments
```

Capture every deterministic composer state after installing the app with:

```sh
ios-app/scripts/capture-composer-fixtures booted /tmp/composer-fixtures
```

The full state list and simulator/device verification boundary are documented
in [`CLAUDE.md`](CLAUDE.md#native-testing-boundary).
