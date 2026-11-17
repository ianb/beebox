---
title: "Accept HEIC photos in the chat composer"
status: draft
workstream: heic-upload
issues:
  - ../../../issues/features/2026-11-16-accept-heic-images-in-chat.md
---
# Accept HEIC photos in the chat composer

An iPhone saves photos as HEIC. Chrome and Firefox cannot decode HEIC, so the chat composer refuses such a photo there. This plan decodes HEIC in the browser with libheif (WebAssembly) when the browser's own decoder fails. The rest of the composer's image path stays the same.

**Issues addressed:** `issues/features/2026-11-16-accept-heic-images-in-chat.md`. A search of the queue for "HEIC" found one related item, now filed from this work: `issues/bugs/2026-11-16-capture-gallery-stores-heic-as-jpg.md` (out of scope, see below). The closed `issues/closed/bugs/2026-08-04-annex-largefiles-case-sensitive.md` concerns storage of `.HEIC` files in the box, not decoding.

## Design

No design section: the composer's behavior does not change. A HEIC photo goes through the same photo path as a JPEG (a placeholder tile, then a thumbnail and an `[image#N]` token). The visible changes are that the refusal toast no longer appears for HEIC, and the toast's list of formats that work now includes HEIC.

## Smallest fix and budget

Smallest fix: in `processImageBlob`, when the native decode fails and the file's header is HEIF, decode with libheif on the page and draw the pixels. About 40 lines.

Chosen design, measured after implementation and review fixes: about 330 changed source lines (`lib/heif/` with `sniff.ts`, `decode.ts`, `protocol.ts`, and `decoder/` holding `worker.ts` and `libheif.ts`; `image-paste.ts`, `attachments.ts`, `file-routing.ts`, a 30-line Vite plugin, `vite.config.ts`) and about 200 test lines, plus two 510-byte fixtures. What the worker adds over the smallest fix: the decode does not freeze the page, and its memory is freed (see *Could this be simpler?*).

## Stated preferences this plan trades against

- `beebox/docs/engineering-principles.md` §4, "Resilient AND never silent": a decoder that cannot load must say so. The toast distinguishes "the HEIC reader didn't load" from "the file may be damaged".
- §3, "Validate at boundaries": the libheif module is untyped where we use it (its `.d.ts` covers only the raw embind API). `asLibheifModule` narrows it once, by a type predicate.
- Root `AGENTS.md`: "Treat unsolicited tool output … as a bug." The choice of libheif build was decided by build output: the CommonJS build made Vite print three "externalized for browser compatibility" warnings; the ES-module build added a chunk over the 500 kB warning limit. The chosen build plus a scoped stub plugin adds no build output.
- Root `AGENTS.md` dependency rule: add with `pnpm install --lockfile-only`. Here that command also re-resolved unrelated peers (`@types/node` 25→24 in several importers). The lockfile change was made by hand instead: three entries for `libheif-js@1.23.5`, then `pnpm install --frozen-lockfile` passed.
- Memory "operational simplicity": browser-side needs no server package. Production's ImageMagick reads HEIC (checked read-only: `magick -list format` shows `HEIC r-- (1.17.6)`), so a server path was possible without a new deploy dependency. Browser-side still wins: the composer must have pixels for its thumbnail before upload.

## What already exists

- `beebox/src/frontend/src/lib/image-paste.ts` `processImageBlob`: decode, downscale to 1920 px, re-encode WebP/JPEG. Reused; the HEIF decode is a fallback inside its `decodeOriented`.
- `unsupportedImageMessage` in the same file: the refusal toast. Reused; it now takes each failure's error, so it can tell a decoder that did not load from a damaged file.
- `InteractiveChat-attachments/attachments.ts` `addInlinePhotos`: uploads the original bytes (`uploadImageOriginal(item.id, source)`) beside the reduced copy. Unchanged; the HEIC original stays the agent's file.
- The agent prompt already says a phone photo may be HEIC and how to convert it (`beebox/src/core/chat/session/prompts.ts:98`: "a phone photo may be HEIC — convert it with `sips` or ImageMagick").
- Precedent for a lazy Vite asset: `lib/audio/mic-capture/core.ts` imports a worklet with `?url` inside a function, so Node tests can import the module.
- No Web Worker existed in the frontend (`grep -rn "new Worker" src/frontend/src` found none). CSP already allows `worker-src 'self'` (`beebox/src/lib/csp.ts`).

## Prior art (external)

- Browser support: Safari 17 and later decode HEIC (https://webkit.org/blog/14445/webkit-features-in-safari-17-0/); Chrome and Firefox do not (https://caniuse.com/heif). Verified locally: headless Chrome 150 on macOS rejects `createImageBitmap` on a HEIC with "The source image could not be decoded." Firefox and Safari were not run. Adopted as the premise.
- libheif-js 1.23.5 (LGPL-3.0, https://github.com/catdad-experiments/libheif-js): Emscripten build of libheif with an HEVC decoder. Adopted as a dependency, not copied. Its `libheif-wasm/libheif.js` + `libheif.wasm` is the build used.
- heic2any (last release 2023, bundles an older libheif), heic-to (3.2 MB single JS per build): evaluated only.
- libheif-js's factory returns the module before its WebAssembly is running; readiness is signalled only by the `onRuntimeInitialized` option, and failure by `onAbort`. Its `HeifImage.display()` runs the decode in a detached `setTimeout(async …)`, so a trap there never reaches the caller. Both found in review; the decode calls `heif_js_decode_image2` directly and `loadLibheif` waits on `onRuntimeInitialized`.
- libheif applies `irot`/`imir` transforms by default when decoding. Verified with a fixture whose `irot` byte was set to 90°: the output is 48×96 from a 96×48 coded image.
- sharp 0.35's prebuilt libvips: `sharp.format.heif.input.fileSuffix` is `['.avif']` only; no HEVC. Verified locally.

No ACKNOWLEDGEMENTS entry: nothing was copied or adapted; libheif-js is a declared dependency.

## Ontology

No new domain nouns. Code-level names:

- **HEIF header** — the ISO-BMFF `ftyp` box with a HEIF major brand (`isHeifHeader`, `lib/heif/sniff.ts`). It is not the MIME type: a pasted image often has an empty `type`.
- **HEIF decoder worker** — `lib/heif/decoder/worker.ts`, one per file, terminated after the reply.
- **`HeifDecoderUnavailableError`** — the worker or its `.wasm` did not load. **`HeifUnreadableError`** — libheif ran and could not read the file. Both in `lib/heif/decode.ts`.
- **`ImageFailure`** — `{ file, error }`, a picked file that did not become an attachment (`image-paste.ts`).

## Tracks / scope

One track.

- **What:** HEIF fallback decode in the composer's image path.
- **Why:** Desktop Chrome and Firefox refuse an iPhone photo, the most common photo a person has.
- **Direction:** `decodeOriented(blob)` tries the native decode; on failure, if `isHeifBlob(blob)`, calls `decodeHeifToBitmap(blob)`, which posts the bytes to a new module worker, receives `{ width, height, pixels }` (transferred), and returns `createImageBitmap(new ImageData(...))`. The worker loads `libheif-js/libheif-wasm/libheif.js` through `loadLibheif`, with `locateFile` returning the `?url` of `libheif.wasm`. The pure load and decode (`loadLibheif`, `decodeHeifPrimary`) live in `lib/heif/decoder/libheif.ts` for Node tests. A Vite worker plugin resolves the glue's Node-only `fs`/`path`/`crypto` imports to an empty module; `optimizeDeps.include` lists the glue so dev does not reload on the first HEIC.
- **Vocabulary lock-ins:** none outside `lib/heif/`.
- **First implementation chunk:** as above; no open questions.

## Could this be simpler?

Simplest version: decode with libheif on the page (no worker). It works. It fails on two specific cases: a 36 MP HEIC takes about 2.3 s to decode (measured in Node on an M-series Mac), during which the page freezes; and WebAssembly memory never shrinks, so after one large photo the page keeps a heap of hundreds of megabytes until reload. On a phone browser that is the difference between a slow paste and a killed tab. The worker costs about 50 lines (two small files and a message type). It is terminated after each file, which frees the heap.

The Vite plugin (25 lines) exists only to keep the build quiet, per the unsolicited-output rule. The alternative, the ES-module build, needs no plugin but inlines the `.wasm` as base64: a 2 MB chunk (515 kB brotli vs. the separate `.wasm`) and a new chunk-size warning.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| The worker chunk or `.wasm` 404s after a deploy, or the device is offline | Message: yes (`image-paste.test.ts`, "reader that did not load"); `onAbort`: yes (`heif.test.ts`, "a failed start is an error") | `error` event / `onAbort` → `stage: "load"` → `HeifDecoderUnavailableError` | Clear: "HEIC files can't be added right now: the HEIC reader didn't load. Reload the page and try again." |
| The `Worker` constructor throws (no Worker API, a `SecurityError`) | No | `startWorker` → `HeifDecoderUnavailableError` | Clear (the reader toast) |
| A WebAssembly trap inside the decode | Yes (`heif.test.ts`, "trap inside libheif's decode") | Direct call throws → `stage: "decode"`; a stray unhandled rejection in the worker is forwarded as a failure; `messageerror` rejects | Clear (damaged toast) |
| A truncated or corrupt HEIC | Yes (`heif.test.ts`, "refused, not decoded as blank") | `decodeHeifPrimary` throws `HeifDecodeError` → `HeifUnreadableError` | Clear: "That image file can't be read; it may be damaged." |
| A HEIC pasted with an empty MIME type | Sniff: yes; message: yes | The header decides, not the type | Clear |
| An AVIF that the browser fails to decode reaches libheif (`mif1` brand) | No | libheif's error → damaged toast | Clear. Chrome, Firefox and Safari 16+ decode AVIF natively, so this is a broken file. |
| A very large HEIC exhausts memory in the worker | No | The worker's allocation fails → `stage: "decode"` or `error` event | Clear (one of the two toasts). Accepted risk: a phone that cannot hold a 48 MP RGBA buffer is rare, and the native path has the same limit. |
| The rotation stored in the file is ignored | Yes (`heif.test.ts`, rotated fixture) | libheif default | — |
| libheif-js renames `HeifDecoder` in an update | Yes (the Node test exercises the real module) | `asLibheifModule` throws by name | Clear in tests |

No critical gap.

## Agent-flow / user-flow edge cases

- Wrong tag / wrong field: not applicable; no agent-facing vocabulary changes.
- Stale ref: not applicable.
- Two agents on one card: not applicable.
- Hand-edit drift: not applicable.
- Fabricated value: not applicable.
- Validation error UX: ADDRESSED. The toast text is tested.
- Transition state: ADDRESSED. A tab loaded before deploy has no HEIF code and keeps the old refusal; a reload picks it up. A tab whose worker chunk was removed by a later deploy gets the "reader didn't load" toast, which says to reload.
- More than three photos: ADDRESSED by existing routing (`file-routing.ts`, `INLINE_PHOTO_LIMIT`): they upload as files, no decode. The agent converts per its prompt.
- Safari 17+ / iOS 17+ app: ADDRESSED. Native decode succeeds; the worker never loads. Older Safari and WKWebView reach the libheif path like Chrome; module workers exist there from Safari 15. Not run on those engines.
- A HEIC whose MIME type is empty (a browser with no HEIC entry in its MIME table): ADDRESSED. `file-routing.ts` treats an empty-type `.heic`/`.heif` name as a photo, so it reaches the decoder, which checks the bytes (`file-routing.test.ts`, "An untyped HEIC is a photo"). A HEIC with neither a type nor a HEIC name still uploads as a plain file: routing is synchronous by design (it guards the inline-count race), so it cannot read bytes, and browsers give clipboard images a type (`image/png` in Chrome). Accepted. An untyped `.HEIC` whose bytes are broken is reported as damaged, not as an unsupported format (`image-paste.test.ts`).

## NOT in scope

- Capture page gallery picker: it uploads raw bytes and names a HEIC `photo-NNN.jpg`; the failure is server-side (thumbnails, triage) and a browser conversion there would drop EXIF date and location. Filed: `issues/bugs/2026-11-16-capture-gallery-stores-heic-as-jpg.md`. The handoff asked to cover other paths that fail the same way; this one fails differently, and its fix needs a decision on keeping the original versus its metadata. The cross-model review called the deferral a human decision; it is put to the developer.
- Quick capture, bulk upload, and chat uploads over the inline limit: they store the HEIC as a file for the agent, which converts per its prompt. They do not refuse anything.
- Server-side HEIC conversion for thumbnails (`/api/images`) and scan vision (`readScanVisionImage`): a separate change, through ImageMagick, if the capture issue chooses it.
- Card attachments: no frontend control attaches an image to a card directly; the agent does it from a file already in the box.
- A shared, long-lived worker for several HEICs: the inline limit is three photos; one worker each is simpler and frees memory at once.
- A deadline on the worker reply: every failure path found now settles (direct decode, `onAbort`, `error`, `messageerror`, forwarded unhandled rejections). A fixed deadline would misfire on a slow phone decoding a large photo.

## Open design questions

none

## Knowledge audits

Skip: no agent-facing concept changes. The agent prompt's HEIC sentence already describes the original as possibly HEIC, and that remains true.

## What will hold this after it ships

- `src/frontend/test/lib/heif.test.ts` runs the real libheif-js in Node against two committed fixtures: header sniffing, pixel colors, rotation, and the parse-failure path.
- `src/frontend/test/lib/image-paste.test.ts` covers the toast for each failure kind.
- The worker wiring (message passing, `?url`, Vite worker build) has no automated test; the frontend tests run in Node with happy-dom, which has no Worker or WebAssembly-in-worker. It was verified once in headless Chrome against test1 (below). A browser-tier test would be a new norm for one feature; not added.

## Implementation order

1. Dependency (`libheif-js` in `src/frontend/package.json`, lockfile by hand), `lib/heif/`, the fallback in `image-paste.ts`, the failure classification in `attachments.ts`, Vite plugin and `optimizeDeps`, tests and fixtures. One commit.
2. Verify in headless Chrome against the worktree's test1: pick a HEIC with a rotation, see an upright thumbnail, send, and confirm the agent gets the `.HEIC` original.

## Rollout shape

Done when `heif.test.ts` and `image-paste.test.ts` pass, `pnpm typecheck` and lint pass, `vite build` prints nothing new, and the browser walk above succeeds. No migration; no knowledge audits.

Verified 2026-11-16 in headless Chrome 150 against test1: a 3024×4032 HEIC stored sideways with `irot` attached as a 1440×1920 upright thumbnail. The agent read "HEIC" at the top and "this side up" at the bottom, and reported the original at `_tmp/chat/<batch>/IMG_4521.HEIC`.
