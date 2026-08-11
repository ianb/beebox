---
title: "callback-clerk's main action should be \"import\", dispatching by URL to the right handler"
workstream: unknown
area: callback-clerk
needs: [design]
filed-by: agent
discovered-in: main session — boxholder proposed reframing the clerk's primary action
---

The clerk's main action today is essentially **"capture this web page"**: freeze
the DOM, render readable markdown, write a `webpage` card
(`callback-box/src/webapp/trpc/routers/clerk.ts`, extension side in
`callback-clerk/src/entrypoints/`).

Proposal: reframe the primary action as **"import"** — one button whose meaning
adapts to what the URL actually *is*.

- **A normal web page** → exactly today's behavior (freeze + readable render).
- **A Google Doc** → import the *document* into the box via the Drive
  integration, filed somewhere sensible with triage — not a frozen HTML snapshot
  of the Docs editor chrome, which is what the current path would produce and is
  close to useless.
- **Other connectors** → each may declare URL shapes it can accept (likely by
  pattern), so importing a URL a connector understands routes to that connector
  instead of the generic page capture.

## Why this is more than a rename

The current behavior isn't just suboptimal for a Doc — it's actively wrong. A
`docs.google.com/document/d/…` page frozen as HTML captures the editor UI, not
the document; the readable-render heuristics have nothing to work with. The user
asked to save the doc and got a snapshot of an app. So dispatching by URL is
fixing a real failure, not adding polish.

## There is already a foundation

`extractDriveFileId` (`callback-box/src/connectors/drive-types.ts:108`) already
parses exactly the URL shapes this needs, and documents them:

```
https://docs.google.com/{spreadsheets,document,presentation}/d/FILE_ID/…
https://drive.google.com/file/d/FILE_ID/view
https://drive.google.com/open?id=FILE_ID
bare FILE_ID
```

So the Drive case is mostly *routing* to machinery that exists
(`drive-handler-docs.ts` / `drive-handler-sheets.ts`), not building an importer.
Start by reading how the Drive connector already turns a file into a card and
what it needs beyond the ID.

## Design questions

- **Where does the pattern registry live?** A connector declaring "I accept
  URLs matching X" is a new capability. Options: a field on the connector
  interface (`src/connectors/`, see its CLAUDE.md), or a separate resolver the
  clerk endpoint consults. The former keeps the knowledge next to the code that
  handles it; the latter avoids widening the connector interface for something
  only one caller uses. Note connectors are per-box configured — so *which*
  patterns are live may depend on which connectors that box has enabled, which
  argues for asking the box rather than hardcoding in the extension.
- **Who decides — extension or server?** The extension could match patterns
  locally (instant UI feedback, "Import doc" vs "Import page" on the button) but
  then it needs the registry client-side and can drift from the box's actual
  config. Server-side dispatch is authoritative but the button can't
  self-describe before the request. A middle path: the server advertises
  patterns, the extension caches them for labeling only, and the server still
  decides.
- **What if nothing matches — or several do?** Fallback to page capture is the
  obvious default. Multiple matches need a deterministic rule (specificity? a
  declared priority?) rather than whichever connector happens to be first.
- **Auth failure is now a first-class case.** Importing a Doc requires the
  Drive connector to be configured and authorized for that box. Deciding to
  import a Doc and *then* discovering there's no Google auth needs a real error
  path — and per the fail-closed posture, "silently fell back to a useless HTML
  snapshot" is the wrong answer.
- **Where does it file, and does triage run?** Boxholder said "somewhere, with
  triage." Confirm whether that means the normal inbox → intake-job path
  (`docs/triage.md`) or a Drive-specific destination — the Drive connector may
  already have opinions about where synced files live, and two paths writing the
  same doc to different places would be worse than either.
- **Does "import" imply ongoing sync?** A Drive-imported doc could be a
  one-shot copy or a subscribed file the connector keeps updated. Those are very
  different features and the word "import" doesn't settle it. Probably one-shot
  for v1, but say so explicitly.

## Naming

"Import" is a better verb than "capture" for the general case, but it's worth
checking against the glossary (`callback-box/docs/glossary.md`) — the codebase
already uses *capture* (capture-session cards, the iOS capture mode) and
*intake* for related-but-distinct concepts, and adding a third overlapping verb
without deciding how it relates would be its own mess.
