---
title: "Capture a web page into a webpage card without a browser — the server-side equivalent of what Clerk does"
workstream: unattached
area: beebox
priority: normal
labels: [capture, webpage-card, agent-tools, clerk]
filed-by: agent
discovered-by: Ian
discovered-in: main session — noticing a box had grown its own `capture-page` trick, and asking whether there was a better way
---

`webpage` is a first-class card type (`beebox/src/schemas/webpage.tsx`): a
readable markdown body, plus a **frozen, self-contained HTML snapshot** in the
card's attach scope, plus capture provenance (`source`, `captured`, `siteName`,
`byline`, `excerpt`, `frozen: {ref}`). Its own header states the producer:
"Produced by the clerk browser extension ('Comment on this page' and 'Save
page')."

That is the only producer. Nothing under `webapp/routes` or `core/commands`
writes a webpage card. So an agent, a procedure, or a schedule that wants to
capture a page has no sanctioned path — the capability requires a human at a
browser with the extension installed.

## The evidence that this gap is real

A box's agent wrote its own `capture-page` trick
(`<boxRoot>/src/tricks/scripts/capture-page/index.ts`, 2026-08-31) because its
seeding work needed a raw-source capture for every `authority: self` source. It
reimplemented the pipeline server-side: `fetch` with a spoofed Chrome UA →
JSDOM → Mozilla Readability → Turndown → write the card, saving `res.text()` as
`attach/page.frozen` and an `og:image` as `attach/header.<ext>`. It matched the
card schema's fields faithfully. Nobody asked for it; the agent built it
because the built-in route was unreachable from where it was standing.

Two ways that stand-in is worse than the real thing, and they are the
requirements for doing this properly:

- **The frozen snapshot is not self-contained.** The schema promises
  "self-contained"; raw `res.text()` keeps external CSS/JS/image URLs, so those
  snapshots rot. Clerk uses `single-file-core` (`beebox-clerk/src/platform/freeze-page.ts`)
  and inlines everything.
- **A second extractor.** Clerk uses **Defuddle** → DOMPurify → Turndown
  (`beebox-clerk/src/platform/extract-readable.ts`); the trick uses Readability
  → Turndown. Two extractors producing one card type means bodies differ in
  style by which path made them.

## What a server-side capture has to get right

- **Same extractor, same freeze.** Defuddle and `single-file-core` both run
  outside a browser extension, over a JSDOM/headless document. Reuse rather
  than re-decide — a third rendering of the same card type is the failure mode
  to avoid.
- **Absolutize links and images** before conversion, as clerk does; stored
  markdown leaves the origin site, so relative hrefs would resolve against the
  box.
- **Sanitize.** Clerk runs DOMPurify before anything reaches the box. Server
  side the content is equally untrusted and the same step applies.
- **Know what a serverless fetch cannot do.** Clerk freezes the *live* DOM
  after a bounded lazy-image pass; a plain `fetch` gets pre-JavaScript HTML.
  For script-rendered pages the results differ materially. Decide whether this
  path drives a real headless browser (the box already ships `agent-browser`)
  or accepts static HTML and says so in the output.
- **Best-effort freeze, like clerk's.** A freeze failure or hang returns null
  there rather than blocking the capture; the frozen attachment is optional in
  the payload. Match that, with a bounded timeout.
- **Decide the surface.** A `bbx` command is the obvious shape for agents and
  procedures. Whether it also becomes a trpc route (so a scheduled job or the
  agent-in-chat can call it) is a real question.

Shipping this retires the per-box trick and gives every box one answer instead
of each agent inventing its own.

## Related

- [webpage card and commentary](../../beebox/docs/implemented-plans/webpage-card-and-commentary.md)
  — the design the clerk path implements.
