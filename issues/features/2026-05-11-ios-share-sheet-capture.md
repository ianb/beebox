---
title: "iOS share-sheet capture (PWA + Shortcuts)"
area: callback-box
---

Both routes avoid needing a native iOS app, which avoids Apple's developer fee, App Store review, and the IAP question entirely.

**Primary**: register the box web UI as a PWA with `share_target` in the manifest. When a user adds the PWA to their home screen, callback shows up as a share destination from any iOS app — Photos, Safari, Voice Memos, etc. Worth verifying current iOS Safari support before committing; share-target support has historically been partial and behind Chrome's. Test on a real device with iOS 17+ before promising the workflow.

**Fallback**: an iOS Shortcut that POSTs to the box's capture endpoint. Five-step setup, no app required, supports any input type the Shortcut can produce. Worth shipping a pre-built Shortcut file users can install in one tap, plus a `docs/ios-shortcut.md` walkthrough.

Either route gives the boxholder one-tap capture from anywhere on iOS — the input-surface gap with native apps largely closes without callback ever entering the App Store.
