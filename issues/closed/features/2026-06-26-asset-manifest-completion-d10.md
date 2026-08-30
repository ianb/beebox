---
title: "asset manifest completion d10"
workstream: unknown
area: beebox
resolution: implemented
---

**Closed:** Done (descoped): the pre-commit verify hook had already landed. Content dedup and an attach-a-file UI were deliberately not built (no real need); `docs/asset-manifests.md` was corrected to match the shipped CLI.

The pre-commit verify hook had already landed (bucket C). The remaining
"completion" scope was re-examined and mostly **dropped as over-claim**:

- **Content deduplication — dropped.** Never built, and not wanted. Assets
  are already gitignored / out of the object database; the per-asset sha256
  is in the manifest if dedup is ever genuinely needed later. Building it
  now would solve a problem nobody has.
- **Attach-a-file-to-a-card API + UI — deliberately not built.** Files
  reach attach scopes through the paths that matter (scan-import, chat
  uploads, email connectors, agents dropping files), and the pre-commit
  hook auto-claims all of it. A web affordance to hand-staple a file to a
  card is *manual attachment management*, which the boxholder explicitly
  doesn't want; the rare one-off is covered by `bbx attachments add`.
- **Docs corrected.** `docs/asset-manifests.md` had a stale
  "Not yet implemented" status and a Commands section describing
  manifest-aware `bbx overwrite`/`bbx mv`/`bbx rm` that don't exist as
  written (the real command is `bbx attachments overwrite`; moves/renames
  are auto-reconciled by the scan; there is no manifest-aware delete). All
  corrected to match what shipped. (There was no actual "versioning"
  language to remove — the doc's history framing is correctly about git.)
