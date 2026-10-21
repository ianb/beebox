---
title: "Card reading: print, contents menu, image-link lightbox, include lines"
status: implemented
workstream: card-reading
issues:
  - ../../../issues/closed/features/2026-10-01-printable-cards.md
  - ../../../issues/closed/features/2026-10-05-markdown-toc-navigation.md
  - ../../../issues/closed/features/2026-10-07-image-card-link-opens-lightbox.md
  - ../../../issues/closed/features/2026-10-20-at-include-lines-render-as-a-file-widget.md
---
# Card reading: print, contents menu, image-link lightbox, include lines

Four small reading features for the card page, requested by the boxholder:
a Print control with a printed way back to the card, a contents menu for long
Markdown, links to image cards that open the lightbox, and `@path` include
lines in agent instruction files shown as an include widget. They share the
Markdown renderer and the themed card surface, so they ship as one plan.

**Issues addressed:** the four in frontmatter. Grepped `issues/` for
"table of contents", "window.print", "printable", "lightbox", "include line",
"browse/_content": no duplicates. Related, not addressed:
`issues/bugs/2026-07-31-lightbox-swipe-cannot-page-rapidly.md` (lightbox
paging speed; this plan adds items to the lightbox list but does not change
paging).

## Design

### Situations

- When Priya has a recipe card open and wants it on the counter while she
  cooks, I want to print it from the card, so I can cook from paper and later
  find the same card again from the page.
- When Tomas reads a long trip-planning note on his phone, I want to see its
  sections and jump to one, so I can get to "Lodging" without scrolling past
  everything else.
- When the box's chat reply says "here is the receipt photo" with a link to an
  image card, I want to see the photo where I am, so I can check it without
  losing the conversation.
- When Priya opens `_content/AGENTS.md` to see what the agent is told, I want
  the include line at its top to read as an include of the folder map, so I can follow it instead
  of reading a stray line of text.
- Quiet case: a short note with two headings needs no contents menu; a link
  to an image card that Priya wants to edit opens the card with a modified
  click or the lightbox's "Open card" control.

### Right place, right time

| Situation | Act, show, or quiet | Surface and card | Attention |
|---|---|---|---|
| Print | Show a control | Card Properties (back face), beside "Copy original text" | Waits to be found |
| Contents | Show a collapsed button when the document is long | Card front, top right, sticky while scrolling | Waits to be found |
| Image link | Act on click: open lightbox | Any surface that renders Markdown links, and `CardLink` in custom views | Responds to the person's click |
| Include line | Show a label and link | The Markdown body of an `AGENTS.md` / `CLAUDE.md` file | Background, inline |

The boxholder chose Properties for Print. Printing is rare per card, so a
control on the back face costs nothing on the front.

### Spirit

- **Serves:** "It should feel like a place" — a printed card says where it
  lives in the box, and the contents menu shows a document's shape.
- **Serves:** "You should be able to see the gears" — include lines show which
  files an agent's instructions pull in.
- **Risks:** "feel like a place" — a link that opens a lightbox instead of the
  card hides the card's address. Guard: the lightbox shows "Open card", and a
  modified click keeps normal link behavior.

### Trust

Shows only, takes no action. Print opens the browser's print dialog; nothing
is written to the box.

### When it goes wrong or does nothing

- The box is reached as `localhost`: the printed footer shows the path and no
  QR code, because a QR code to `localhost` opens nothing on a phone.
- An image card whose image file is missing: the lightbox shows its existing
  broken-image state; "Open card" still works.
- An include line names a file that does not exist: the widget says
  "includes notes.md (missing)". A path outside the box's files (for example
  `.beebox/agent-guide.md`) reads "includes .beebox/agent-guide.md (not
  viewable here)" without a link.

### Walkthrough

Priya opens `recipes/Soup.recipe.card` on her laptop at
`http://192.168.1.20:3000/kitchen/browse/_content/recipes/Soup.recipe.card`.
She turns the card over with the Properties corner, sees "Print" beside "Copy
original text", and clicks it. The browser print dialog opens. The preview
shows the card front only: title, fields, body; no navigation, chat, or
Properties. At the end of the card a footer reads "kitchen ·
recipes/Soup.recipe.card" with a small QR code. Later, she scans the QR code
with her phone on the same Wi-Fi and the same card opens. Nothing changed in
the box.

## Smallest fix and budget

Smallest fixes: a `window.print()` button; a heading list in a `<details>`;
an `if image card` branch in `makeLink`; a regex that wraps `@path` lines in
code spans. Chosen design, by track:

| Track | Source | Tests |
|---|---|---|
| A. Print + footer + `_content` copy | ~140 | ~50 |
| B. Contents menu | ~200 | ~60 |
| C. Image-link lightbox | ~110 | ~50 |
| D. Include lines | ~130 | ~60 |

About 580 source and 220 test lines, about 800 in all. Not a BIG CHANGE. Docs:
a few lines in the frontend Markdown reference if one names render tags.

What the fuller design buys over the smallest: the footer gives paper a way
back (the issue's request); the sticky menu stays reachable mid-document,
which a `<details>` at the top does not; the "Open card" control keeps the
card reachable (the Spirit guard); the existence check marks missing includes,
which the issue asks for.

## Stated preferences this plan trades against

- Boxholder decisions (handoff, 2026-10-20): Print belongs in Properties; the
  printed page leads back to the live card; print the friendly path; QR only
  when the box has a URL reachable off this machine; contents menu is a
  floating drop-down at the card's top right, collapsed until opened, not over
  Properties, working at phone width.
- `beebox/AGENTS.md` "no features beyond the task": the published-site
  renderer gets no contents menu (see NOT in scope).
- Memory "minimize invented concepts; prefer primitives": the image-link
  marker reuses the lightbox's `data-image-src` protocol
  (`LightboxProvider.tsx:52` `collectImages`); the contents menu reuses
  `ui/Dropdown.tsx` and `MenuItem`; the include widget reuses a Markdoc tag
  like `{% see-also %}`.

## What already exists

- Print CSS: `index.css:105` (`@media print` for html/body, overflow, prose);
  `themes/card-themes.css:335` hides `.bbx-card-properties, .bbx-card-back`
  and shows `.bbx-card-front[hidden]`; `card-themes.css:424` hides
  `[data-card-page-actions]`; `chrome.css:199` hides the composer;
  `AppNav/nav.tsx:160`, `Sidebar.tsx:59`, `FileView/view.tsx:199,338` use
  `print:hidden`. Reuse; verify as one printed page.
- Properties face: `ThemedFileCard/view/PropertiesFace.tsx` `CopyContents`
  renders `<CopyButton label="Copy original text" …>`. Print joins that row.
- `CardFacts` "Filed at" shows `{data.path}` raw (`CardProperties.tsx:55`).
  `toDisplayPath` (`shared/display-path.ts:73`) gives the friendly form.
- QR: `qrcode-generator` is a dependency (`frontend/package.json:28`);
  `CompanionPairingSection.tsx` has `qrSvg(value)` (`qrcode(0, "M")`,
  `createSvgTag`). Move `qrSvg` to `lib/qr-svg.ts` and reuse.
- Box URL: no frontend API gives a public URL; `boxBaseUrl()` is copied in
  `CompanionPairingSection.tsx:24` and `ScanUploaderSection.tsx:21`, built
  from `window.location.origin`. The card URL form exists at
  `ThemedFileCard.tsx:74`: `withBase(\`/${boxSlug}/browse/${path}\`)`.
- Headings: `makeHeadingNode` (`shared/markdoc-config/tags/core.ts:108`) emits
  `h${level}` with unique `id` and `data-line`. Reuse as the anchor source.
- Scroll container: `WorkspaceCanvas/view.tsx:49` `.bbx-interface-card-desk
  … overflow-auto`, not the window. Sticky positioning works against it.
- Menu: `components/ui/Dropdown.tsx` (portal, viewport clamp incl. iOS
  `visualViewport`, Escape/outside close, focus restore) and
  `ui/dropdown-menu-item.tsx` `MenuItem` with `active`. Reuse.
- Lightbox: `LightboxProvider.tsx` `openFromElement(element)` collects
  `[data-image-src]` in document order and opens at the clicked `src`;
  `ImageLightbox.tsx:35` `LightboxImage { src; alt; caption? }`. The image
  card view uses `apiRawImageUrl(apiBase, data.path)` (`renderers/image.tsx:92`)
  and the browse sidebar uses the same `/image/<path>` form
  (`BrowseSidebarList.tsx:108`), so marks dedupe by `src`.
- Card type from path: `cardTypeFromName` (`shared/card-name.ts:41`); raw
  image files: `isImagePath` (`chat/message-parsing.ts:314`).
- Link rendering: `markdown-link/link.tsx` `makeLink`, `relative` case, used
  by chat (`chat/markdown-rendering.tsx:238`), Markdown cards, plain `.md`
  files, and `ViewMarkdown`. Custom views: `view-widgets/CardLink.tsx`.
- Include syntax: only the generator knows it
  (`core/docs-gen/generate/agents-md.ts:31`). Box `AGENTS.md` files inside
  `_content/` and `_config/` start with an include line for the folder map (`@` then `MAP` dot `md`) (checked in the test box).
  Root `AGENTS.md` and `.beebox/` are outside the box namespace
  (`shared/box-root-vocabulary.ts:34,47`), so the browse UI cannot show them.
- Existence: `trpc.files.kind` returns `directory | file | missing`
  (`webapp/trpc/routers/files/kind.ts:7`), used at `renderers/browse.tsx:47`.

## Prior art (external)

- Markdoc: a line holding only `{% tag /%}` parses as a block tag, and
  consecutive such lines each become their own block node. Verified locally
  with `Markdoc.parse` (two lines gave two `tag` nodes, lines `[0,1]` and
  `[1,2]`). Adopted as a parsing premise; no code copied.
- Claude Code memory imports: `@path` lines, relative to the including file.
  https://docs.claude.com/en/docs/claude-code/memory — evaluated-only.
- No other decision depends on an external premise.

## Ontology

- **Print control** — a button labelled "Print" on the Properties face. Calls
  `window.print()`. New.
- **Print footer** (`CardPrintFooter`) — a print-only block at the end of the
  card front: box slug, the friendly path, and the QR code when the origin is
  reachable off this machine. New. Not shown on screen.
- **Off-machine origin** — `isOffMachineOrigin(url: URL): boolean`; false for
  `localhost`, `*.localhost`, `127.0.0.0/8`, `::1`, `0.0.0.0`. New pure
  function.
- **Contents menu** (`CardContentsMenu`) — the collapsed button and drop-down
  on the card front. New. Not a sidebar, not on the published site.
- **Outline entry** — `{ id, level, text }` for one heading of the card's
  rendered Markdown. New type. Built from `makeHeadingNode` output.
- **Image link** — a Markdown link or `CardLink` whose resolved target is an
  `*.image.card`. It carries `data-image-src`,
  `data-image-alt`, `data-image-card`. Not an inline embed (`![]()`).
- **`LightboxImage.cardPath`** — optional box path of the card or file an
  image came from. New field; filled from `data-image-card`.
- **Include line** — a line in an instruction file that holds only
  `@<path>`. Instruction file: basename `AGENTS.md` or `CLAUDE.md`.
- **`include-file` tag** — frontend-only Markdoc tag `{% include-file
  path="…" /%}` that the renderer substitutes for an include line. Renders
  `IncludeFile`. Not in the shared tag table, so agents never write it and
  lint never sees it.

## Tracks / scope

### A. Print and the way back

- **What:** A Print button on the Properties face; a print-only footer on the
  card front; fix the named `_content/` copy.
- **Why:** No print action exists, and a printed card has no way back.
- **Direction:**
  - `PropertiesFace.tsx` `CopyContents` row gains
    `<Button size="sm" intent="ghost" onClick={printCard}>Print</Button>`.
    The print CSS already prints the front while the back is open
    (`card-themes.css:335`).
  - Print scope (review finding: a chat workspace renders the transcript and
    several cards together, `WorkspaceCanvas/view.tsx:97`, and
    `chrome.css:199` hides only the composer). `lib/print-card.ts`
    `printCard(article)`: marks the card's `<article>` `data-print-target`,
    marks each ancestor `data-print-path`, sets
    `document.documentElement.dataset.printScope = "card"`, calls
    `window.print()`, and removes every mark on `afterprint` (not in a
    `finally`: Firefox's `print()` returns before the page is printed). Print CSS:
    `html[data-print-scope="card"] body :not([data-print-path], [data-print-target], [data-print-target] *) { display: none !important; }`.
    Cmd-P without the button keeps today's behavior.
  - `components/themes/ThemedFileCard/view/CardPrintFooter.tsx`:
    `hidden print:block`, rendered by `ThemedFileCard` after `children`
    inside the surface. Shows `{boxSlug} · {toDisplayPath(data.path)}`; when
    `isOffMachineOrigin(new URL(window.location.href))`, also an SVG QR code
    of `new URL(withBase(\`/${boxSlug}/browse/${encodePathForUrl(path)}\`), location.origin)`
    (`view-url.ts:396`; a `?`, `#`, or `%` in a filename stays part of the path).
  - Reachability rule. The frontend has no configured public URL
    (`publicUrl` reaches only the admin router, `admin/router.ts:85`). The
    origin the person is using is the best evidence available: a loopback
    origin is never reachable from a phone; any other origin was reached over
    a network by this browser. A LAN or tailnet origin that the scanning
    phone cannot reach is possible; the printed path still leads back. Using
    `box.json` `publicUrl` when set is NOT in scope (new API).
  - `lib/qr-svg.ts` exports `qrSvg(value)`, moved from
    `CompanionPairingSection.tsx`.
  - `lib/off-machine-origin.ts` exports `isOffMachineOrigin`.
  - `CardFacts` "Filed at" shows `toDisplayPath(data.path)`.
  - `DriveMountForms.tsx`: helpers become `e.g. drive/recipes` and
    `e.g. tax/Receipt_2026`; submit passes `fromDisplayPath(value.trim())`,
    which accepts both forms (`display-path.ts:93`: "`x/y` and `/x/y` →
    `/_content/x/y`", "`_config/x` … → `/_config/x`"). The server resolves a
    leading `/` as box-root-absolute (`connectors/google-drive/mount-path.ts:14`).
  - `ArchiveChatSection.tsx:48`: "Moves this chat's card to the chat archive
    (chat/archive); nothing is deleted."
- **Vocabulary lock-ins:** `isOffMachineOrigin`, `qrSvg`.
- **First chunk:** `isOffMachineOrigin` + test, `qrSvg` move, footer, button,
  copy fixes.

### B. Contents menu

- **What:** A "Contents" button at the top right of the card front, sticky in
  the card scroller, opening a `Dropdown` of headings.
- **Why:** Long Markdown has no structure view or jump.
- **Direction:**
  - Rule: show when the document body has at least 4 outline entries at
    levels 1–3. No height measurement (review finding: images loading change
    height without a DOM mutation). Pure `buildOutline(entries)` returns
    `null` below the threshold; in `components/CardContents/outline.ts`.
  - Source of headings: the DOM, scoped to the card's document body.
    `Markdown` gains `outline?: boolean`; with `prose="block"` it adds
    `data-card-outline` to its prose wrapper. Only the two document renderers
    pass it: `MarkdownCardView/CardBody.tsx` and `renderers/markdown.tsx`
    (plain `.md`). `CardContentsMenu` queries
    `[data-card-outline] :is(h1,h2,h3)[id]` in the card front and keeps a
    heading only when `heading.closest(".bbx-theme-prose")` is the outline
    root, so an embedded card's headings are left out. A `MutationObserver` on
    the front recomputes (edits, late renders).
  - Placement: rendered by `CardThemeSurface` as the first child of
    `.bbx-card-front`: a zero-height `position: sticky; top: .5rem` row with
    the button at its right. It starts below the card header, so it does not
    overlap the Properties corner (`card-themes.css:155`, absolute in the
    header area). Verify against the default and `phosphor` themes, whose
    corner differs (`phosphor.css:70`).
  - Current section: computed when the menu opens (the last heading whose top
    is at or above the scroller's top + 1rem), shown with `MenuItem active`.
    No scroll listener.
  - Jump: `heading.scrollIntoView({ block: "start" })`, then focus the heading
    (`tabIndex = -1`). The URL is not changed. Headings in the card front get
    `scroll-margin-top` so the sticky button does not cover them.
  - Phone: the same button; `Dropdown` clamps to the viewport. Entries indent
    by level, text truncates with `title`.
- **Vocabulary lock-ins:** `OutlineEntry`, `buildOutline`.
- **First chunk:** `outline.ts` + test, then the component.

### C. Image links open the lightbox

- **What:** A plain link to an image card opens the lightbox; the lightbox
  offers "Open card". Raw image files (`photo.jpg`) are left as they are: the
  issue names image cards.
- **Why:** The person wants the image, not the card page.
- **Direction:**
  - `lib/image-link.ts`: `imageLinkSrc(boxSlug, path): string | null` —
    `apiImageUrl(boxSlug, path)` when `cardTypeFromName(path) === "image"`;
    else `null`. The `src` form must equal
    `apiRawImageUrl(getApiBase(), path)`, so the same image dedupes with an
    embed; the test checks both helpers agree.
  - `makeLink` `relative` case: when `imageLinkSrc` is non-null and the target
    has no explicit `viewer`, the `<a>` gets `data-image-src`,
    `data-image-alt={label}`, `data-image-card={target.path}`. A plain click
    calls `lightbox.openFromElement(e.currentTarget, { openCard })` where
    `openCard = () => ctx.onNavigate(target, { label })`. Modified clicks fall
    through as today. `makeLink` is a factory, so the lightbox comes in through
    `LinkContext` (`openImage?`), set in `Markdown` from `useLightbox()`.
  - `CardLink.tsx`: same check on the resolved target; `openCard` calls
    `host.openCard(...)`. `CardRef` keeps its explicit "Open" button
    (it already says what it does).
  - Dedup merge (review finding): `collectImages` keeps the first entry per
    `src`; an earlier embed or chat `data-image-list` entry has no
    `cardPath`. When a later marker with the same `src` has `cardPath`, the
    merge copies it onto the kept entry. Tested: embed before link, bulk list
    before link.
  - `LightboxProvider.openFromElement(element, opts?: { openCard?: (path: string) => void })`
    stores `openCard` in state. `collectImages` reads `data-image-card` into
    `LightboxImage.cardPath`. `ImageLightbox` shows an "Open card" button when
    the current image has `cardPath` and an `openCard` is set; clicking closes
    the lightbox and calls it. The handler navigates with the clicked link's
    surface; for another image in the list it navigates to that image's
    `cardPath` with `resolveContentTarget("/", cardPath)`.
- **Vocabulary lock-ins:** `data-image-card`, `LightboxImage.cardPath`.
- **First chunk:** `image-link.ts` + test, provider/lightbox field, `makeLink`.

### D. Include lines

- **What:** In `AGENTS.md`/`CLAUDE.md`, a line that is only `@<path>` renders
  as "includes `<path>`" with a link, marked missing or not viewable.
- **Why:** The lines join into a paragraph and underscores read as emphasis.
- **Direction:**
  - `lib/include-lines.ts`: `rewriteIncludeLines(source): string`. Outside
    fenced code, a line matching `/^@([^\s"'{}%]+)\s*$/` becomes
    `{% include-file path="<path>" /%}`. Line count is preserved, so
    `data-line` and todo locators do not shift. Pure; tested.
  - `Markdown` applies it before `parseMarkdown` when
    `isInstructionFile(basePath)` (basename `AGENTS.md` or `CLAUDE.md`).
  - `buildRenderConfig` adds tag `include-file` (`attributes: { path:
    String }`, `render: "IncludeFile"`) only for that render.
  - `components/Markdown/IncludeFile.tsx`: resolves `path` with
    `resolveRelativePath(basePath, path)` (kind `card`, which returns `null`
    for paths outside the box namespace, `shared/ref-path/core.ts` `fenced()`).
    `null` → "includes `<path>` (not viewable here)". Otherwise
    `trpc.files.kind.useQuery({ path })`; `missing` → "(missing)" in the
    existing danger style; a query error → "(could not check)" with the
    error in `title`, still linked; else a link that calls
    `onNavigate(resolveContentTarget(...))`.
  - Scope note (review finding): the issue's example is the box's root
    `AGENTS.md`. The browse UI cannot open root files or `.beebox/`
    (`shared/box-root-vocabulary.ts:34,47`; no frontend or webapp route
    serves them). The files a person can open are the area ones
    (`_content/AGENTS.md`, `_config/AGENTS.md`, `_content/inbox/AGENTS.md`),
    which start with the same folder-map include. This track fixes those; the root file's
    `.beebox/agent-guide.md` include renders as "not viewable here" if the
    root file ever becomes viewable. Reported to the boxholder.
- **Vocabulary lock-ins:** `include-file` (frontend render tag only).
- **First chunk:** `include-lines.ts` + test, tag, component.

## Could this be simpler?

- Print: the simplest version is the button alone. It fails the issue's
  second ask (a way back from paper). The footer is one component.
- Contents: a `<details>` list at the top of the body is simpler. It fails the
  boxholder's decision (floating top-right, collapsed) and is out of reach
  mid-document. Reading headings from the DOM, with a one-attribute marker
  from the two document renderers, is simpler than threading a heading list
  out of `Markdown` through its callers.
- Current-section highlight on open only, with no scroll listener, is the
  simple form of scroll-spy.
- Image links: a version with no "Open card" control is simpler. It removes
  the only plain-click path to the card (the Spirit risk).
- Include lines: wrapping paths in code spans is simpler. It fixes the
  rendering but gives no link and no missing state, which the issue asks for.
  Restricting to instruction files avoids a parser change in the shared
  Markdoc config.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Print preview includes chrome (nav, sidebar, composer, contents button) | Manual PDF check | `print:hidden` on new controls | Clear in preview |
| QR printed for a `localhost` origin | `isOffMachineOrigin` test | Footer omits QR | Clear (no QR) |
| QR printed for a LAN IP the phone cannot reach | — | Accepted: path text still printed | Clear (scan fails) |
| Print from a chat workspace prints transcript and other cards | Manual PDF with two open cards | `printCard` scope | Visible in preview |
| Print marks left behind after print | `print-card.test.ts` | `afterprint` cleanup; the next Print clears stale marks first | Silent if broken → test |
| Embed/bulk list wins dedup, link loses "Open card" | Provider collect test | Merge `cardPath` | Silent if broken → test |
| `files.kind` query error | — | "(could not check)" state | Clear |
| Contents button overlaps the Properties corner on a theme | Screenshot check, 2 themes | Sticky row starts below header | Visible |
| Heading under the sticky button after jump | Manual | `scroll-margin-top` | Visible |
| Image-link `src` differs from embed `src` → duplicate or no-open | `image-link` test compares helpers | — | Silent if broken → test |
| `openFromElement` finds no match → no-op click | Test on provider collect | Link keeps `href`; fallback navigates if no match | Clear: fallback |
| Include path with `"` or `{` breaks the tag | `include-lines` test | Regex excludes those chars; line stays text | Clear (plain text) |
| `@` line inside a fenced block rewritten | `include-lines` test | Fence tracking | — |
| `files.kind` throws for an out-of-namespace path | — | `resolveRelativePath` null check before query | Clear |

`openFromElement` returns without opening when the clicked `src` is not in
the list. For image links, `openFromElement` returns a boolean, and the link
navigates as before when it is `false`. So a click never does nothing.

## Agent-flow / user-flow edge cases

- Wrong tag: agents cannot write `include-file`; it is not in the shared tag
  table. ADDRESSED (Track D).
- Stale ref: an image link to a deleted image card opens the lightbox on a
  broken image; "Open card" shows the missing card page. ADDRESSED.
- Two agents on one card: read-only features. Not applicable: nothing writes.
- Hand-edit drift: `@ path` (with a space) or `@path trailing words` is not an
  include line and stays text. ADDRESSED (regex).
- Fabricated value: not applicable; no agent-written field.
- Validation UX: no validation added.
- Partial migration: none; no data shape changes.
- iOS web view: link clicks are handled in JS (`preventDefault`), so the
  native navigation delegate never sees them (`ChatWebView.swift:536`).
  Lightbox gestures are unchanged. ADDRESSED; verify by phone-width browser
  check, not on a device.

## NOT in scope

- Contents menu on the published site: the publish renderer emits no
  JavaScript (`markdown-page.ts`), and no published-page reader asked. File an
  issue for a static contents list there.
- Removing `_content/` from browse URLs: not wanted. The boxholder
  (2026-10-20) is fine with it in URLs; only displayed text matters.
- A configured public URL for the box in the frontend (`box.json`
  `publicUrl`): the origin rule meets the decision without a new API.
- Links to raw image files (`photo.jpg`): the issue names image cards; the
  same helper can take them later.
- `CardRef`, `SeeAlso`, `Source` chips: they are explicit card references with
  their own open controls.
- Showing root `AGENTS.md` and `.beebox/` in browse: outside the box namespace
  by design (`box-root-vocabulary.ts`).
- Including the included file's content in the widget: the issue says it need
  not.

## Boxholder follow-up (2026-10-20)

The QR code is opt-in, never the default. Properties shows an "Add QR code"
checkbox beside Print, unticked, and only when `isOffMachineOrigin` holds;
`printCard(card, { qr })` marks the card `data-print-qr`, and the print CSS
hides the QR code and its hint without that mark. Richer print choices belong
to `issues/features/2026-10-20-print-options-and-printable-forms.md`.

## Contents button follow-up (2026-10-20)

The button names the section at the top of the card ("Contents" above the
first heading), tracked on the card's scroll. Scrolling is when the reader
wants their position, so the button is full while the card scrolls; 1.2 s
after scrolling stops it rests as a faint icon, and hover, focus, or opening
the menu brings it back.

## Review record

Cross-model plan review, codex `gpt-6-sol`, 2026-10-20. Accepted: print scope
in a multi-card workspace; QR URL path encoding; dedup losing `cardPath`;
include query-error state; contents rule simplified to a heading count and
scoped to document renderers; raw image files dropped. Partly accepted: QR
reachability. The reviewer asked for a QR only from a known off-device URL;
the frontend has none, and the boxholder's lean ties the QR to reachability,
which a non-loopback origin shows as well as the box can tell. Kept, with the
residual risk in Failure modes. The root-`AGENTS.md` gap is a scope note in
Track D, reported to the boxholder.

## Open design questions

None inside the first chunks. Lean, to confirm by screenshot: the contents
button label is an icon plus "Contents" on wide screens and the icon alone
under 520px.

## Knowledge audits

Skip: no new agent-facing concept. `include-file` is a frontend render tag
that agents never write.

## What will hold this after it ships

- `.test.ts` with `t.check` for the pure decisions: `isOffMachineOrigin`,
  `buildOutline`/`shouldShowContents`, `imageLinkSrc` (including agreement
  with `apiRawImageUrl`), `rewriteIncludeLines`, and `collectImages` reading
  `data-image-card` (DOM test if the frontend test tier has a DOM; else the
  pure parse of a marker record).
- Behavior on screen (print preview, phone width, lightbox) is checked by
  hand in this plan and recorded in the exhibit. No new test tier.

## Implementation order

1. Track D pure function + tests; tag + component. Commit.
2. Track C helper + tests; provider field; `makeLink`; `CardLink`. Commit.
3. Track B outline + tests; component; surface placement + CSS. Commit.
4. Track A origin + QR move + tests; footer; button; copy fixes. Commit.
5. Browser verification: PDF of a printed card, phone-width contents menu,
   lightbox in chat, Markdown card, and a custom view. Exhibit.
6. Cross-model review of the diff; fixes; file the two NOT-in-scope issues.

## Rollout shape

Done when the four test files pass, `pnpm` typecheck and lint pass for the
frontend, and the exhibit shows: the printed PDF with footer (with and without
QR), the contents menu open at 375px and at desktop next to Properties, an
image link opening the lightbox from chat, a Markdown card, and a custom view,
and an `AGENTS.md` with include lines. No migration; no knowledge audits.
