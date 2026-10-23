---
title: "Smaller frontend near-duplicates whose merge would change behavior"
workstream: unattached
area: beebox
labels: [code-quality]
filed-by: agent
discovered-by: agent
discovered-in: worktree-dup-sweep-frontend — frontend pass of the functional-duplication sweep
---

Part of the [functional-duplication sweep](2026-10-22-functional-duplication-sweep.md).
Each group is two or more implementations of one job that differ in a way a
person could notice.

- **Capture count summaries.** `chat/capture-bubble.tsx:134` captureMediaSummary,
  `capture/CaptureOverlay/CaptureResumeDialog.tsx:17` summarizeContents and
  `chat/capture-message.ts:50` captureChipLabel describe one capture as "clips" in
  one place and "recordings" in another, in a different order, with different
  empty fallbacks.
- **Image extensions.** `chat/message-parsing.ts:313` IMAGE_EXTS, the copy in
  `BrowseSidebarBody/BrowseSidebarList.tsx:35` and `renderers/image.tsx:25` list nine
  extensions; `HistoryViewCard/CommitDetail-tabs.tsx:15` lists seven (no bmp, ico), so
  those do not preview there. Its `getFileExt` (:18) also reads an extension
  off a dotted directory (`a.attach/README` gives ".attach/readme").
  `isImagePath` strips `?` and `#`, which the browse list must not do for real
  filenames, so a shared extension predicate needs both forms.
- **Multipart upload with progress.** `lib/file-upload.ts` uploadChatFile and
  `browser-task/SubmissionForm.tsx:202` postSubmission both post multipart XHR with
  progress and mobile-auth headers, with different error contracts and header
  extraction.
- **Browse links without encoding.** `chat/CaptureChip.tsx:23` and
  `chat/user-message/UploadChip.tsx:18` build `withBase(`/${boxSlug}/browse/${doc}`)`
  with no segment encoding; `shared/card-browse-url.ts` cardBrowseUrl encodes and has
  no frontend callers. A path with `#` or `?` breaks these links.
- **Media-query hooks.** `chat/everywhere/use-mobile-card-navigation.ts`
  (useSyncExternalStore, 767px) and `AppNav/PlacePill-landmarks.tsx:67`
  useSearchViewport (useState and a listener, 639px or 499px tall). The
  breakpoints differ on purpose; only the mechanism repeats, and the second
  form renders false for one frame.
- **Visible-tab intervals.** `hooks/usePresenceHeartbeat.ts`,
  `hooks/useDevWorktreeKeepalive.ts` and `lib/admin-hang-probe.ts` share a "beat now,
  every N seconds, and on return to visible" skeleton with different gates.
- **Retry backoff.** `pages/capture/api.ts:261` doubles its delay with no jitter
  and its own sleep, beside `shared/backoff.ts` jitteredBackoff and
  `lib/trpc/transient.ts` retryDelayMs.
- **External links.** About ten raw `<a target="_blank" rel="noreferrer">` links
  skip `ui/ExternalLink`, which adds `noopener` and an icon. Some skip it to avoid
  the icon.
