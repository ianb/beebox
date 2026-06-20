# Web-page commentary capture

Make the callback-clerk browser extension's primary action turn the current
web page into a **commentary document** inside a box: extract a readable
markdown rendering, freeze a faithful full copy of the page as an attachment,
file the result at a chosen destination, and open a chat with the commentary
document on the side so the boxholder can read and comment immediately.

This plan spans the extension (callback-clerk), the box server (clerk API +
schemas), and the box frontend (commentary rendering + a chat companion
deep-link). It generalizes the landmark `<triage-destination>` role into a
single `<destination for="…">` role so "where commentary goes" reuses the
existing destination concept rather than adding a parallel one.

## Implementation status (2026-06-13)

Implemented on branch `worktree-callback-clerk` (not yet merged to main):

- **Track 1.1 — done.** `<destination for="…">` role + `<triage-destination>`
  back-compat alias; shared `core/landmark/destination.ts`
  (`findDestination`/`roleDestinationKinds`); triage consumer updated;
  doctests green.
- **Track 1.2 — deferred.** No migrator written. The back-compat alias makes
  existing `<triage-destination>` cards keep working, so this is non-urgent;
  a migrator can rewrite cards at leisure. (Existing real card:
  test1 `Box.landmark.card`.)
- **Track 2.1 / 2.2 — done.** `GET /api/clerk/commentary-destinations` and
  `POST /api/clerk/commentary` (bundle: commentary card + `attach/readable.md`
  + `attach/page.frozen`, returns `{created, open}`). Route doctests green.
- **Track 3.1 — done, verified live.** In-box `defaultRef` rendering in
  `CommentaryView` (was "not wired yet"). Browsed a real commentary card on
  the dev router: the readable `attach/readable.md` renders in the left pane,
  the body + "Original page" link in the right.
- **Track 3.2 — done, verified live.** Chat `?companion=` deep-link via
  `useCompanionDeepLink`. Browsed the endpoint's `open` URL: lands in a fresh
  chat with the commentary card in a companion tab, scoped to the dest dir.
- **Track 4 — done.** Defuddle extraction (+DOMPurify+Turndown), SingleFile
  freeze (`single-file-core`, **bundles** — confirmed by `pnpm build` — but
  **runtime freeze fidelity not verified in a loaded extension**), "Comment on
  this page" primary popup action + destination selector, background
  orchestration. Extension domain logic has tap tests.

**Verification done:** full box suite 2077/2077; full extension suite 67/67;
typecheck + lint clean both projects; extension `pnpm build` succeeds.
**Live e2e (dev router, real box clone):** seeded a `<destination
for="commentary">` landmark → `GET /api/clerk/commentary-destinations`
returns it → `POST /api/clerk/commentary` writes the card + `attach/readable.md`
+ `attach/page.frozen` and returns the `open` URL → browsing the card shows the
in-box render, browsing `open` shows the companion-pane chat. Screenshot
confirms the side-by-side layout.
**In-extension capture — VERIFIED (2026-06-14):** the boxholder ran "Comment
on this page" against a hosted box (`box.example.com/hearth`) and it
captured a real page end-to-end — popup → Defuddle → SingleFile freeze → POST
→ commentary card + companion-pane chat. The full flow works in a loaded
extension.

**Follow-ups:**
- ~~Always-on content script ~1.15 MB.~~ **DONE** — capture moved to a
  `registration:"runtime"` content script (`commentary-capture.content.ts`)
  injected on demand via `chrome.scripting` (activeTab from the "Comment"
  click); the messaged-back result reaches the background. Always-on
  `extract.js` is now 49 kB (just the Readability save-page path).
- **Browse integration (added this session).** `bin/browse` loads the built
  extension when `BROWSE_CLERK=1` (unpacked dir via `AGENT_BROWSER_EXTENSIONS`).
  Opt-in, not default, because agent-browser forces Chrome **headed** whenever
  an extension is present (intentional upstream, v0.17.0 #652 — `.crx` can't be
  CLI-loaded either; unpacked is the only path). General/headless browse stays
  window-free. If headless-with-extension is ever needed: launch Chrome with
  `--headless=new --load-extension=<dist> --remote-debugging-port` and
  `agent-browser connect <port>` (verified Chrome loads the extension headless
  that way; agent-browser just won't do it via its own launcher).
- **Captured-page rendering (2026-06-14, from dogfooding).** The card renders
  single-column (the side-by-side compare layout is reserved for external
  multi-target commentary); page metadata (`source`/`captured`/`frozen`) lives
  in frontmatter and renders as a header line, leaving the body for commentary.
  The frozen snapshot is linked from the header and served by `/api/files` as
  `text/html` with `Content-Security-Policy: sandbox` + `nosniff` (scripts
  disabled, null origin) so the untrusted captured HTML can't reach the box.
- **Anchoring + links (2026-06-15, from dogfooding).** Clicking a `{% source %}`
  chip now jumps to its verbatim span using Chrome's text-fragment matching
  algorithm (`text-fragments-polyfill`): it matches the quote in the in-pane
  readable markdown (scoped to the saved-page pane) and highlights it via the
  CSS Custom Highlight API; if the quote isn't in the markdown it opens the
  frozen original at the quote with a native `#:~:text=` fragment. So the
  agent's `pos` quality no longer matters for navigation — the match is on the
  quoted text. Two fixes alongside: the chip's `attach/readable.md` ref now
  resolves through
  `resolveRelativePath` (was navigating to a dead literal path), and captured
  article links are absolutized against the source URL at extraction (site-/
  doc-relative links were resolving into the box). The `pos`-precision idea
  (heading/line anchors in the conversion) is moot for navigation now, though
  it could still help a human reading the raw markdown.
- ~~Knowledge-audit entries written-as-proposed but not run.~~ **DONE
  (2026-06-14)** — three entries added to `knowledge-audits.yaml`
  (`commentary-destination`, `commentary-capture-files`,
  `commentary-anchors-author`), all pass `knows_directly`. The capture-files
  one drove a guide addition (the bundle layout in "How Items Enter the Box").
- Real boxes need `*.frozen filter=lfs` in `.gitattributes` (test1 already has
  it) before they receive frozen attachments — wire into `cb init` /
  adding-a-box.
- **Still owed:** the landmark migrator (Track 1.2, deferred behind the alias);
  freeze fidelity on heavy/complex pages (works, but slow — 20s cap drops the
  snapshot rather than blocking).

## Stated preferences this plan trades against

- **`callback-box/CLAUDE.md:101`** — *"Read before writing. Don't guess file
  formats, XML structures, or API shapes."* Every shape below is cited to a
  file already read; the one unread surface (`CommentaryView` in-box render)
  is flagged as must-verify, not assumed.
- **`callback-box/CLAUDE.md`** (Behavioral Notes) — *"HTTP endpoints go in
  tRPC by default … Raw Fastify routes in `src/webapp/routes/` are only for
  things that don't fit … file upload/download, OAuth redirects, webhooks."*
  The clerk routes are an existing raw-Fastify exception (extension CORS +
  cookie auth); this plan extends that exception rather than starting a new
  pattern.
- **`callback-box/CLAUDE.md`** — *"Keep source and docs generic — never
  hardcode personal names."* Destination rules, schema instructions, and the
  extension UI copy stay generic ("the boxholder").
- **`callback-box/CODE-STYLE.md`** — no `any`; no default parameters; max 2
  positional params (named-params object beyond that); `as` is `unsafe`-grade.
  The new payload builders and the destinations endpoint follow this.
- **callback-clerk `CLAUDE.md`** — *"domain code never imports React, WXT, or
  chrome.\*"* The new extraction/freeze/destination logic splits into pure
  `domain/` (payload shapes, URL building) vs `platform/` (DOM, chrome.\*).
- **Most recent precedent:** the commentary card itself
  (`src/schemas/commentary.tsx`) and its `{% source %}`/`{% quote %}` body
  vocabulary — this plan must produce cards that validate against it
  unchanged, not invent a second commentary shape.

## What already exists

- **Commentary card schema** — `src/schemas/commentary.tsx:19-31`: a
  body-bearing `cardSchema("commentary", …)` with `defaultHref` xor
  `defaultRef` (`:26-27`), optional `targets` (`:30`), markdown body with
  `{% source %}` anchors. *Reuse as-is.* The card we create is a normal
  commentary card.
- **Commentary validation** — `src/core/card-lint.ts:168-192`
  (`commentaryErrors`): enforces *"commentary card requires exactly one of
  defaultHref or defaultRef"* (`:177`) and that the body parses as Markdoc
  (`:192`). *Reuse.* Our generated card must satisfy both.
- **Commentary rendering** — `src/frontend/src/components/CommentaryView.tsx`
  (NOT directly read; flagged). Research reports it fetches external targets
  through the **dev-only** `/api/external` route and renders side-by-side.
  **Whether it renders an in-box `defaultRef` target in production is
  unverified** — see Open Questions Q1 and the Track-3 first chunk. *Possibly
  rebuild/extend.*
- **Clerk API (raw Fastify)** — `src/webapp/routes/clerk.ts`: `save-page`
  (`:87-128`) already does the page→card path and even writes a frozen sibling
  when `frozenHtml` is supplied (`savePageSchema.frozenHtml` `:38`; write
  `:119-123`). `applyExtensionCors` (`:185-192`) sets the
  `chrome-extension://` CORS headers every route calls; `gitCommit` (`:175`)
  stages + commits with a `Created-By: clerk-api` trailer. *Reuse the
  helpers; add a new `commentary` route rather than overloading `save-page`*
  (different artifact: a bundle + destination + open-URL response).
- **Extension extraction** — `callback-clerk/src/platform/extract-page.ts:10-55`:
  Readability + Turndown → `PageExtract`. *Rebuild for this flow* (Defuddle),
  but keep `extract-page.ts` for the secondary save-page action.
- **Extension API client** — `callback-clerk/src/platform/clerk-api.ts:26-48`
  (`postJson`, `credentials:"include"`), `postSavePage` (`:62-64`). *Reuse the
  `postJson` core; add `postCommentary` + `getCommentaryDestinations`.* Note
  `postJson` currently returns `void` (`:26`) — the commentary call needs the
  JSON body (the open-URL), so add a `postJsonResult<T>` sibling rather than
  changing the void contract its callers rely on.
- **Extension messages** — `callback-clerk/src/domain/messages.ts:8-25`:
  `ClerkMessage` union + `isClerkMessage` guard (`:36-42`). *Extend* with a
  `CommentOnPageMessage`.
- **Landmark schema** — `src/schemas/landmark.ts`:
  `LandmarkTriageDestination` (`:157-159`) holding `TriageRules` (`:133-135`) +
  `TriageProcedure` (`:145-150`); `LandmarkSchema` union (`:181-209`);
  `createLandmarkTemplate` (`:247-262`); `landmarkLoader` (`:217-238`).
  *Rebuild the role* into `<destination for="…">` (Track 1).
- **Attach convention** — `src/shared/attach-path.ts`: `attachDirFor` (`:44-49`),
  `attachmentPath` (`:60-63`), `attach/` ref prefix (`:17`). *Reuse* to place
  the frozen capture and (optionally) the readable doc under the card's
  `.attach/`.
- **Frozen-capture LFS convention** — test1 `.gitattributes` already has
  `*.frozen filter=lfs diff=lfs merge=lfs -text` under "# Frozen page
  captures". *Reuse the `.frozen` suffix* so SingleFile output is LFS-tracked
  automatically; real boxes need the same line (Rollout / migration note).
- **Card open URL** — `src/frontend/src/router.tsx:140-143`: `/card/$` →
  `CardViewPage`. **Chat route** — `:73-81`: `/chat` with
  `validateSearch: z.object({ session, contextDir })`. *Reuse `/card`; extend
  the chat route's search schema* with a companion param (Track 3).
- **Companion side-panel** — `InteractiveChat-hooks.ts:21-53` (`useChatTabs`,
  `onZoomView` keyed by `target.path`); view URLs parsed by
  `src/frontend/src/lib/view-url.ts:34-59` (`parseViewUrl`), shape
  `view:path?view=markdown` (`ViewTarget` `:10-18`). *Reuse* — the deep-link
  calls `onZoomView(parseViewUrl(...))` on load. The panel state is
  client-only today; nothing reads it from the URL — that wiring is the gap.

## Prior art (external)

- **SingleFile core** — [`single-file-core` on npm](https://www.npmjs.com/package/single-file-core)
  (v1.5.84) is the engine behind the
  [SingleFile web extension](https://github.com/gildas-lormeau/SingleFile);
  the [CLI repo](https://github.com/gildas-lormeau/single-file-cli) is the
  closest thing to API reference. **Finding:** the programmatic embedding API
  (how you initialize the core, run it against the live document, and get back
  one self-contained HTML string) is **not well documented** — the published
  reference is the extension/CLI source, not prose docs. This is an
  integration risk: the exact init/hooks surface should be settled by a small
  spike before Track 4's freeze chunk, not discovered mid-build. The SingleFile
  extension itself runs the core in the page context, which matches our
  content-script plan.
- **Defuddle** — [`defuddle` on npm](https://github.com/kepano/defuddle),
  [docs](https://defuddle.md/docs). Three bundles: `defuddle` (browser,
  zero-deps, extraction only), `defuddle/full` (adds math + **Markdown
  conversion**), `defuddle/node` (Node DOM). **Finding:** browser usage is
  `new Defuddle(document)` then parse; Markdown output requires the `/full`
  bundle (larger content-script payload — acceptable, note it). This directly
  covers "page → readable markdown" in a content script.
- **DOMPurify** — readntalk's precedent (`~/src/readntalk`,
  `src/platform/extract-document.ts`) sanitizes extracted HTML *separately*
  from extraction. We adopt the same split: Defuddle decides content, DOMPurify
  makes it safe before storage. No external bug findings; well-trodden.
- **Anchoring model** — readntalk uses a multi-selector bundle (quote
  exact/prefix/suffix + position start/end). The box's `{% source %}` `pos`/
  `version` model (`commentary.tsx:56-81`) is the box-native equivalent; we do
  **not** import readntalk's selector format — anchoring is authored by the
  chat agent from the boxholder's selection, as commentary already specifies.
  No new anchoring code in this plan (see NOT in scope).

## Tracks / scope

Ordered by implementation dependency, then surface size.

### Track 1 — Generalize the landmark destination role

**What.** Replace `<triage-destination>` with a single `<destination
for="…">` role on landmark cards, where `for` is a space-separated set of
kinds (`triage`, `commentary`). Migrate existing landmark cards; keep a
back-compat alias so old cards validate during the transition.

**Why this needs to change.** Commentary needs a way to ask a box "where do
commentary documents go?" The boxholder explicitly wants this to *be a type of
destination*, not a parallel concept. A second sibling role (e.g.
`<commentary-destination>`) would duplicate the destination idea;
`triage-destination` carries `<rules>`/`<procedure>` meant for the inbox-triage
agent (`landmark.ts:204-206`), which don't fit a hand-filed commentary target.
One role with a `for` facet unifies both.

**Direction.**
- New element `LandmarkDestination` = `element("destination", { attrs: { for:
  z.string() }, children: z.array(z.union([TriageRules, TriageProcedure])) })`.
  `for` is validated as a space-separated list against the known kinds
  (`triage`, `commentary`); unknown kinds are a lint warning, not a hard error
  (forward-compat for kinds added later).
- `<rules>`/`<procedure>` remain meaningful only for `for` including `triage`.
  A `for="commentary"`-only destination needs neither.
- **Back-compat alias:** the loader/validator accepts `<triage-destination>`
  as equivalent to `<destination for="triage">` for one release window
  (`landmark.ts` schema union admits both; a migrator rewrites cards).
- `landmarkLoader` (`:217-238`) is unaffected (title comes from
  `<navigation><label>`); confirm it ignores the role element.

**Vocabulary lock-ins.**
- Element name: **`destination`** (not `dest`, not `route-to`).
- Attribute: **`for`**, space-separated kinds.
- Kind tokens: **`triage`**, **`commentary`** (lowercase, singular).
- These propagate to: landmark schema + instructions, the migrator, the
  destinations API, extension UI labels, docs/landmarks.md, knowledge audits.

**First implementation chunk.** Add `LandmarkDestination` to
`landmark.ts`, add it to the `LandmarkSchema` children union alongside the
retained `LandmarkTriageDestination` alias, update the schema `instructions`
prose, and add a `for`-token lint check. No card rewrites yet (that's the
migrator chunk). No open questions inside this chunk.

### Track 2 — Clerk commentary endpoint + destinations listing

**What.** Two new raw-Fastify clerk routes:
1. `GET /api/clerk/commentary-destinations` → `{ destinations: [{ dir, label,
   symbol? }] }` — every landmark whose `<destination for>` includes
   `commentary`.
2. `POST /api/clerk/commentary` → creates the commentary bundle and returns
   `{ created: string[], open: string }` where `open` is the chat-with-
   companion URL.

**Why this needs to change.** `save-page` produces a `record` card in a fixed
`inbox/pages-*` dir (`clerk.ts:95-98`) with no destination choice, no
commentary card, and no open-URL response. The commentary flow needs all
three. Overloading `save-page` would conflate two artifacts.

**Direction.**
- Request schema (Zod, mirroring `savePageSchema` `:30-41`):
  ```
  commentarySchema = z.object({
    url: z.string().url(),
    title: z.string().min(1),
    siteName / byline / excerpt: z.string().optional(),
    readableMarkdown: z.string().min(1),   // Defuddle output
    frozenHtml: z.string().optional(),     // SingleFile output
    destinationDir: z.string().optional(), // chosen landmark dir; default inbox
    timestamp: z.string().optional(),
  })
  ```
- Bundle layout (one commit, via the existing `gitCommit` helper `:175`):
  ```
  <destDir>/<Name>.commentary.card          # frontmatter + seeded body
  <destDir>/<Name>.attach/readable.md        # the readable rendering
  <destDir>/<Name>.attach/page.frozen        # SingleFile self-contained HTML (LFS)
  ```
  - The commentary card's `defaultRef: "attach/readable.md"` (in-box, prod-
    safe — *the* reason we store readable markdown rather than pointing
    `defaultHref` at the live URL).
  - The "link to original" is recorded in the card body (a prose line + the
    `url`) and as the readable doc's provenance; the live URL is also kept in
    frontmatter via a `source`/`sources`-style field if commentary grows one
    (see Open Questions Q2 — minimal: a body line, no schema change).
  - Frozen attachment uses the **`.frozen`** suffix to inherit LFS tracking.
- `open` URL construction: `"/" + boxSlug + "/chat?session=new&contextDir=" +
  destDir + "&companion=" + encodeURIComponent("view:" + cardPath +
  "?view=commentary")`. Server returns it relative; the extension resolves it
  against `box.boxUrl`'s origin. (Track 3 makes `companion` do something.)
- Destinations listing reuses the landmark glob the triage system already
  uses to discover destinations (locate it during implementation; do **not**
  write a second landmark walker).

**Vocabulary lock-ins.** Route paths `/api/clerk/commentary` and
`/api/clerk/commentary-destinations`; response keys `destinations`, `created`,
`open`.

**First implementation chunk.** `GET /api/clerk/commentary-destinations`:
walk landmarks, filter by `for` including `commentary`, return
`{ destinations }`. It's read-only, independently testable with a route
doctest, and unblocks the extension's selector. No open questions inside it.

### Track 3 — Frontend: in-box commentary render + chat companion deep-link

**What.** (a) Ensure a commentary card with an in-box `defaultRef` renders in
production (not just the dev-only external viewer). (b) Add a `companion`
search param to the chat route that pre-loads the companion panel on chat
open.

**Why this needs to change.** The whole point is the boxholder lands in a chat
with the commentary doc beside it. Today nothing reads panel state from the
URL (`useChatTabs` is client-only, `InteractiveChat-hooks.ts:21-53`), and
commentary's in-box render path is unverified.

**Direction.**
- Chat route: extend `validateSearch` (`router.tsx:77-80`) with `companion:
  z.string().optional()`. In `ChatPage`/`InteractiveChat`, on mount, if
  `companion` is set, `onZoomView(parseViewUrl(companion))`
  (`view-url.ts:34-59`). Idempotent — `onZoomView` already de-dupes by path
  (`InteractiveChat-hooks.ts:29-31`).
- Commentary in-box render: verify `CommentaryView` resolves a `defaultRef`
  via `/api/files/<path>` (the prod file route, cf. `apiFileUrl`
  `view-url.ts:183-186`) and not only `/api/external`. If it's external-only,
  add an in-box branch. This is the first chunk because the feature is dead
  without it.

**Vocabulary lock-ins.** Chat search param name **`companion`**, value is a
`view:` URL string (reuses `parseViewUrl`).

**First implementation chunk.** Read `CommentaryView.tsx` + `CardViewPage`;
confirm or implement in-box `defaultRef` rendering with a `view=commentary`
renderer entry. Settle Q1 here. (The deep-link chunk follows.)

### Track 4 — Extension: Defuddle + SingleFile + selector + primary action

**What.** Make "Comment on this page" the popup's primary action: extract
readable markdown (Defuddle+DOMPurify), freeze the page (SingleFile), fetch
destinations and show a selector when >1, POST to `/api/clerk/commentary`,
open the returned `open` URL in a new tab. Demote save-page/memo/tabs to
secondary.

**Why this needs to change.** The extension's current primary surface is
save-page/memo/tabs (`messages.ts:8-25`); the boxholder wants commentary as
the central action.

**Direction.**
- `domain/` (pure): `CommentOnPageMessage` in the `ClerkMessage` union +
  `isClerkMessage` (`messages.ts:36-42`); a `CommentaryPayload` type and an
  `open`-URL resolver (origin + server-relative path). No chrome/DOM imports.
- `platform/extract-readable.ts` (new): `new Defuddle(document)` →
  `{ markdown, title, byline, excerpt }`, DOMPurify on the HTML before
  conversion. Pure DOM, mirrors `extract-page.ts:10-55` layering.
- `platform/freeze-page.ts` (new): run `single-file-core` against the live
  document in the content script → one self-contained HTML string. **Gated on
  the spike** (see Prior art / Open Questions Q3).
- `platform/clerk-api.ts`: add `postCommentary` (returns `{ created, open }`)
  and `getCommentaryDestinations`; add `postJsonResult<T>` (the existing
  `postJson` `:26` stays void for its callers).
- `ui/`: popup refocus — primary "Comment on this page" button; a destination
  selector shown only when the box returns >1 commentary destination
  (0 or 1 → no prompt, default/sole target).
- `background.ts`: handle `CommentOnPageMessage` — orchestrate extract →
  freeze → POST → `chrome.tabs.create({ url: open })`.

**Vocabulary lock-ins.** Message `type: "commentOnPage"`; UI label "Comment on
this page".

**First implementation chunk.** `domain/` message + payload types + the
`open`-URL resolver, with tap tests (pure, no deps, unblocks the rest). No
open questions inside it.

## Subplans

**None required.** The two genuine research questions are scoped tightly
enough to live as Open Questions resolved inside their tracks' first chunks
(SingleFile embedding spike in Track 4; in-box commentary render in Track 3),
not as separate design efforts. If the SingleFile spike reveals the
programmatic API can't run cleanly in an MV3 content script, *that* becomes a
subplan (alternative freeze mechanism) — flagged here so it isn't a surprise.

## Failure modes

**Critical gap:** **Track 3 — in-box commentary render.** If `CommentaryView`
only renders external `href` targets via the dev-only `/api/external` route,
then in production the created commentary card shows nothing for its
`defaultRef` readable doc — the boxholder opens the chat and the companion
pane is blank, with no error. No test, no handling, silent. *Resolution:* this
is Track 3's first chunk; the plan does not complete until in-box render is
confirmed or implemented.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| `single-file-core` API doesn't run in MV3 content script (CSP, missing globals) | No | No | Loud at build/spike — caught before ship (Q3 gate) |
| Frozen HTML is very large (data-URI images) → slow commit / repo bloat | No | Partial — `.frozen` is LFS in test1 | Silent on a box missing the `.frozen` LFS line (commits a huge blob) |
| Defuddle returns empty markdown (app pages, paywalls) | No | Must add | Silent → empty readable doc unless we fall back to link-only |
| `destinationDir` points at a dir with no `<destination for="commentary">` (stale/hand-typed) | No | Must add | Server should 400, not silently file it elsewhere |
| Two commentary captures of the same page collide on `<Name>` basename | No | `buildFilename` adds a timestamp (`clerk.ts:164-167`) | Handled — reuse `buildFilename` |
| `companion` param references a card that failed to commit | No | Panel `onZoomView` shows an empty tab | Should surface a render error, not a blank tab |
| Migrator misses a `<triage-destination>` card → triage stops seeing it | Needs test | Back-compat alias keeps it valid | Silent routing loss without the alias — alias is the handling |

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field** — the chat agent authoring commentary must use
  `{% source %}`/`{% quote %}` (`commentary.tsx:50-85`). **ADDRESSED** by
  reusing the unchanged commentary schema + its instructions; no new body
  vocabulary.
- **Stale ref** — `defaultRef: "attach/readable.md"` lives in the same card's
  attach scope, created in the same commit. **ADDRESSED** (can't be stale at
  creation; `resolveAttachRef` `attach-path.ts:98-103` resolves it).
- **Two agents touching the same card** — the capture is a single atomic
  commit (`gitCommit` `clerk.ts:175`); the chat agent edits the card
  afterward. No concurrent writer at creation. **ADDRESSED** for creation;
  later concurrent edits are the existing card-edit story, unchanged.
- **Hand-edit drift** — a boxholder hand-writes `<destination for=triage>`
  (no quotes) or `for="Triage"`. **DEFERRED** to Q4 — lint normalizes/ warns;
  the `for`-token check is lenient (warn on unknown, not block).
- **Fabricated free-form value** — the readable doc is a faithful Defuddle
  rendering (not agent prose) and the frozen HTML is the ground truth; the
  "link to original" is the real `url`. **ADDRESSED** — the design stores
  captured reality, leaving opinion to the commentary body.
- **Validation error UX** — a bad `destinationDir` returns a clerk 400 the
  extension surfaces via `ClerkApiError` (`clerk-api.ts:12-20`). **ADDRESSED**
  for the API; the message text is an implementation detail to write well.
- **Partial migration / transition state** — during rollout, boxes have a mix
  of `<triage-destination>` and `<destination>` cards. **ADDRESSED** by the
  back-compat alias (Track 1) reading both; the migrator converts at leisure.

## NOT in scope

- **Selection→anchor authoring in the extension.** The extension creates the
  commentary card and readable doc; turning highlighted spans into
  `{% source %}` anchors stays the chat agent's job (commentary.tsx already
  specifies it). Rationale: anchoring is a box-side concern with its own
  vocabulary; duplicating readntalk's selector bundle in the extension would
  fork the model.
- **Re-anchoring when the readable doc changes.** The readable doc is frozen at
  capture; we don't re-resolve anchors against a changing source. Rationale:
  the frozen attachment *is* the stability guarantee.
- **Replacing save-page/memo/tabs.** They become secondary, not removed.
  Rationale: still useful; out of this feature's blast radius.
- **A production `/api/external` viewer for live `http(s)` targets.** We avoid
  it entirely by storing readable markdown in-box. Rationale: dev-only route,
  and live pages aren't stable targets.
- **Screenshot/visual archiving.** SingleFile HTML is the fidelity copy; no
  pixel snapshot. Rationale: HTML is searchable/portable; matches readntalk's
  reasoning.
- **Multi-kind `for` UI in the extension.** The selector lists commentary
  destinations only; it doesn't expose `triage` kinds. Rationale: keep the
  capture flow focused.

## Open design questions

- **Q1 — In-box commentary rendering (lean: must implement if absent).** Does
  `CommentaryView` render a `defaultRef` in-box target in prod, or only
  external `href` via `/api/external`? Resolved in Track 3's first chunk by
  reading the component. If absent, add an in-box branch + a `view=commentary`
  renderer entry. This is the critical gap above.
- **Q2 — Where the "link to original" lives (lean: body line, no schema
  change).** Commentary frontmatter has no `source` field. Options: (a) a prose
  line in the body with the URL (zero schema change); (b) add an optional
  `source`/`origin` field to `commentary.tsx`. Lean (a) for v1; revisit if the
  renderer wants a structured "view original" affordance.
- **Q3 — SingleFile embedding (lean: spike before the freeze chunk).** The
  programmatic `single-file-core` API is under-documented (Prior art). A small
  spike must establish the init/run/get-HTML surface in an MV3 content script
  before Track 4's freeze chunk. If it can't run cleanly, escalate to a freeze
  subplan (alternatives: `chrome.pageCapture` MHTML, or a hosted freeze).
- **Q4 — `for` token strictness (lean: lenient/warn).** Hard-fail unknown
  kinds, or warn? Lean warn (forward-compat for future kinds), matching the
  "fix the code, don't fight hand-edits" posture.

## Knowledge audits

New agent-facing concepts: the **`<destination for="…">` role**, the
**`commentary` destination kind**, and the **web-page→commentary capture
flow** (what the extension produces vs what the chat agent then does).

Proposed `knowledge-audits.yaml` entries (land **run** during implementation,
per the skill — `pnpm knowledge-audit run --box test1 --filter <id>`):
- `knows_directly`: "How does a landmark mark a directory as a place commentary
  documents are filed?" → `<destination for="commentary">`.
- `knows_directly`: "A boxholder captures a web page via the extension — what
  files appear in the box?" → commentary card + `attach/readable.md` +
  `attach/page.frozen`.
- `knows_directly`: "Who turns the boxholder's selections into `{% source %}`
  anchors — the extension or the chat agent?" → the chat agent.

These guard the conventions against post-compaction drift, the `{% quote %}`
precedent the skill cites. Not skipped — each new concept gets at least one.

## Implementation order

1. **T1.1** Add `<destination for>` element + lint, keep `<triage-destination>`
   alias, update instructions. *(no dependency)*
2. **T1.2** Migrator: rewrite existing landmark cards (incl. test1
   `Box.landmark.card`) `<triage-destination>` → `<destination for="triage">`.
   *(dep: T1.1)*
3. **T2.1** `GET /api/clerk/commentary-destinations`. *(dep: T1.1 — needs the
   `for` semantics)*
4. **T3.1** Verify/implement in-box commentary render (resolves Q1). *(no
   dependency; gates the feature)*
5. **T2.2** `POST /api/clerk/commentary` — bundle + `open` URL. *(dep: T1.1,
   T3.1 for a meaningful `open`)*
6. **T3.2** Chat `companion` search param → `onZoomView` on load. *(dep:
   none; pairs with T2.2's `open`)*
7. **T4.1** Extension `domain/` message + payload + open-URL resolver (+ tests).
   *(no dependency)*
8. **T4.2** Defuddle readable extraction. *(dep: T4.1)*
9. **T4.3** SingleFile freeze — **spike first (Q3)**. *(dep: T4.1)*
10. **T4.4** Destinations fetch + selector + primary-action popup + open tab.
    *(dep: T2.1, T2.2, T4.2, T4.3)*

The plan completes when all chunks land; it ships as one unit on the
boxholder's signal (no partial merge to main).

## Rollout shape

- **Test posture.** Dogfood first; one doctest per substantial new codepath
  once shapes settle: a route doctest for each clerk endpoint
  (`makeTestServer()`), a filesystem doctest for the bundle layout
  (`makeTmpBox()`), the landmark `for`-lint, and tap tests for the extension's
  pure `domain/` payload/URL logic. Regression-risk piece that needs a test
  *at* ship: the **migrator** (silent triage-routing loss if it mangles a
  card) — test before running it on real boxes.
- **Knowledge audits.** The three entries above land run with the plan.
- **Migration.** (a) Schema alias ships first so old cards stay valid. (b)
  Agent-run migrator rewrites landmark cards in each box (test1 first). (c)
  Each box's `.gitattributes` needs `*.frozen filter=lfs` — test1 has it;
  add to the `cb init` / adding-a-box path so new boxes get it, and note it in
  the migration runbook for existing boxes. The alias is removed in a later
  release once all known boxes are migrated (tracked, not in this plan's
  completion).
