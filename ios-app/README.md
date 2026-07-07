# Callback Box iOS App

Native iOS companion app for Callback Box. This project is intentionally thin
at first: the conversation view stays in the box's web chat via `WKWebView`,
loaded with `?embed=1`, while native code owns the paired-box shell.

## Current Setup

- SwiftUI app target: `CallbackBox`
- Minimum iOS: 17.0
- No external dependencies
- Manual pairing for now: enter a box URL and optional session id
- Dev pairing shortcut: `callbackbox://pair?baseURL=...`

Once Xcode is installed, open:

```sh
open ios-app/CallbackBox.xcodeproj
```

The first real pairing/auth implementation belongs to the Track A subplan in
`callback-box/docs/plans/ios-companion-app.md`; this scaffold does not invent a
token format ahead of that design.

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
