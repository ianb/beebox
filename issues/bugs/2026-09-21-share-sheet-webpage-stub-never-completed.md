---
title: "Share-sheet webpage/doc saves land as inert stubs with no path to fill them in"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: main — production box feedback triage (bbx feedback)
priority: normal
---

A card saved through the `share.saveTextual` tRPC route (used by the iOS
share-sheet extension) never gets its real content. For a shared URL, the
route writes the card body as a literal Markdown link and nothing else:

`beebox/src/webapp/trpc/routers/share.ts:50-58`:

```ts
const cardText = input.kind === "url"
  ? createWebpageTemplate({
      title,
      source: input.url,
      capturedAt: input.capturedAt,
      content: `[${title}](${input.url})`,
      shareId: input.shareId,
    })
  : createDocTemplate({ title, body: input.text, shareId: input.shareId });
```

The resulting `.webpage.card` has `title`, `source`, `captured`, and
`share-id` frontmatter, and a body that is only that one Markdown link. There
is no frozen HTML snapshot and no readable rendering, unlike a webpage card
produced by the Clerk browser extension (`beebox/src/schemas/webpage.tsx`),
which fetches, extracts, and freezes the page before writing the card.

No job, connector, or scheduled sweep reads `share-id` frontmatter to finish
the job. A search of `beebox/src` for `share-id` / `shareId` shows only the
write path (`share.ts`) and the schema fields (`webpage.tsx`, `doc.tsx`); there
is no reader anywhere that later fetches the URL and fills the card in. A card
saved this way stays a bare link indefinitely unless a human or an agent
notices and hand-fills it (one observed case sat for 2+ weeks before a
session doing unrelated work in the box noticed and fetched it by hand).

This is not fully covered by
[server-side webpage capture](../features/2026-09-11-server-side-webpage-capture.md),
which frames the gap as "nothing writes a webpage card outside Clerk" — that
premise is already out of date, since `share.ts` does write one, just an
inert one. The fix likely lives in the same place: once a real server-side
capture pipeline exists (fetch → extract → freeze, matching Clerk's
Defuddle + `single-file-core` pipeline), `share.saveTextual` should call it
for `kind: "url"` instead of writing the bare link. Until then, the stub is a
dead end with no visible signal that it is incomplete, so it is not obvious
without reading `share.ts` that anything is missing.
