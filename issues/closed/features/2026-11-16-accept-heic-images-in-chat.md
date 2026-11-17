---
title: "Accept HEIC images from an iPhone in the chat composer"
workstream: heic-upload
area: beebox
labels: [chat, images, upload]
filed-by: agent
discovered-by: Ian
discovered-in: main session — developer asked for HEIC upload, 2026-11-16
resolution: implemented
---

**Closed (implemented, 2026-11-17):** Landed in cdac94bf2, fecc45414: libheif decode in the composer when the browser cannot; capture gallery still stores HEIC as JPG (separate issue).

An iPhone saves photos as HEIC. The chat composer refuses them in a browser that cannot decode HEIC, for example Chrome on a desktop. It shows "HEIC files can't be added: this browser can't read that format" (`unsupportedImageMessage` in `beebox/src/frontend/src/lib/image-paste.ts`). Safari can decode HEIC, so the same photo can work on one device and fail on another.

The composer must decode the image in the browser: it makes a reduced copy for the model and uploads the original as the agent's file (`InteractiveChat-attachments/attachments.ts`). The Anthropic API also accepts only JPEG, PNG, GIF, and WebP (`SUPPORTED_IMAGE_MEDIA_TYPES` in `beebox/src/services/claude-chat-content.ts`). So a HEIC must become one of those formats somewhere before the model sees it.

## Where to convert

- **In the browser**, with a WebAssembly HEIC decoder (libheif builds such as `heic2any` or `libheif-js`). The rest of the path stays the same. The cost is a large download, which can be loaded only when a HEIC arrives, and slow decoding of large photos on a phone.
- **On the server.** Upload the original as it is, and convert it there to make the reduced copy. The composer then needs a path for an image it cannot preview: a placeholder chip until the server returns a thumbnail. A comment in `beebox/src/core/describe-images/gemini.ts` says that sharp may lack an HEVC decoder, so the server needs libheif or ImageMagick with HEIC support. That is a new deploy dependency.
- **In the iOS app**, convert at the point of share or pick. This fixes only the app. AirDrop to a Mac and upload from desktop Chrome would still fail.

Keep the HEIC original as the agent's file in every option. The model sees the converted copy only.

## Research

- Which browsers decode HEIC today: Safari on iOS and macOS, Chrome, Firefox.
- Whether the production server's sharp build or its ImageMagick reads HEIC.
- Other upload paths that accept images: capture, quick capture (`beebox/src/shared/quick-capture.ts` already allows `image/heic`), and card attachments. Check each one's behavior with a HEIC.
