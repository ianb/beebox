# Frontend Conventions

UI palette, primitives, data wiring, addressable ids, and the `className` rule. Backend code never needs to load this; code-style.md covers conventions that apply to both halves.

Bee Box is an internal app, not a public site chasing Lighthouse scores. Do not optimize before a measurement shows something is slow.

## Browser support

Bee Box targets current Chrome, Safari and Firefox, and the iOS app's
WKWebView at iOS 18 (Safari 18.0). Use any feature Baseline-available in
Safari 18.0 without a fallback. A newer feature is progressive enhancement: use
it only where the page still works without it, with no fallback code over
about 20 lines and no polyfill (Temporal is the one exception). workstreams-app
and beebox-clerk run in Chrome only.

## Card themes

Card presentation is theme-driven and independent of view selection. Theme
surfaces live under `src/frontend/src/themes/`; keep theme IDs and stocks in
the shared catalog and use literal class maps so Tailwind includes them in the
build. The user-facing selection and read-only origin details belong in card
Properties; see [`docs/box/card-themes.md`](docs/box/card-themes.md) for the
authoring contract.

## Data Source Tagging

UI elements that display data from a known source (card, commit, session, etc.) must be tagged with `data-cb-source` attributes for traceability. Use the `cbSource()` and `cbSourceItem()` helpers from `src/frontend/src/lib/source-tag.ts`. Tag the outermost meaningful data boundary — not every inner element. See `docs/data-source-tagging.md` for the full convention.

## Browser Tab Titles

Every route declares its tab title in `staticData`, and the augmented
`StaticDataRouteOption` in `router.tsx` makes that mandatory: a new route does
not typecheck until it says what it is called (`title: null` for a layout or a
redirect). A page whose real name is data it loads — a chat's label, a card's
title — publishes it with `usePageTitle` from `components/DocumentTitle.tsx`,
and the route's static title stands in until it arrives.

The composed title is `<mark> <page> — <box>`, most-distinguishing first
because browsers truncate tabs hard; the app name appears only where there is
no box. Nothing else writes `document.title`.

The **box half comes from the box itself** — the landmark card at the box root,
whose `navigation.label` is the box's display name and whose `symbol` is its
mark (`core/landmark/box-identity.ts`). There is no separate box-name or
box-icon store: an agent renames a box by editing that card, the same way it
writes any other box fact.

**The icon says which box; the title says which place.** `components/
DocumentIcon.tsx` shows the box's own mark, always, and `DocumentPlace.tsx`
publishes the current directory's landmark emoji to lead the title
(`🍳 Recipes — Kitchen`). The icon was landmark-first at one point and the cost
was the thing a tab icon exists to prevent: two boxes' tabs wearing the same
mark. A landmarked directory is titled by its landmark rather than its folder
name, so the tab's two halves name the same place.

**A working indicator rides in the same slot.** `useWorking(true)` from
anywhere puts a spinning glyph at the front of the title; the chat calls it
while a turn streams, so a chat left in a background tab says whether the box
is still going. Any caller is enough — the provider counts owners, so one
finishing does not answer for another.

**Presence is the signal; the spin is decoration.** A hidden tab throttles
timers to once a second, and Chrome drops that to once a MINUTE once a silent
page has been hidden five minutes (developer.chrome.com/blog/timer-throttling-in-chrome-88).
So the animation is exactly what stops being trustworthy during a long
background turn — which is the case the indicator exists for. The glyph's
presence carries the meaning and no throttle can take it away; built the other
way round, a frozen spinner would read as "stuck" at the moment the honest
answer is "still going".

Wherever a surface needs a real raster rather than a character — the Apple
touch icon, the manifest icons, a notification — it comes from box-scoped
routes that render the mark on demand (`webapp/routes/box-identity-assets.ts`,
`core/box/box-icon.ts`). Rendering the emoji as *text* was measured and
rejected; see the root `ACKNOWLEDGEMENTS.md` for why the artwork is a dependency.

The box server also stamps the box's name and mark into the served
`index.html` (`webapp/index-html.ts`) so a tab is identifiable before React
boots. That stamping happens only in the box server: **in local dev Vite
serves the document**, so dev shows the built title for the moment before the
app takes over.

## Frontend Color Palette

Components reach for **semantic color roles**, not brand names. Defined in `src/frontend/tailwind.config.js`.

| Role | Use for | Shades |
|------|---------|--------|
| `primary` | Main brand actions, links, selected state | DEFAULT, dark (hover), light, 50, 100 |
| `accent` | Highlights, CTAs, focus rings, warning-lite | DEFAULT, dark, light, 700 (text on light paper), 50, 100 |
| `info` | Informational callouts, metadata badges | DEFAULT, dark, light, muted, 50, 100 |
| `danger` | Destructive actions, error messages | DEFAULT, dark, light, 50, 100 |
| `success` | Positive confirmations, connected state | DEFAULT, dark, light, 50, 100 |
| `warning` | Caution, dirty state, notes | DEFAULT, dark, light, 50, 100 |
| `coral` | App-nav gradient only (no semantic role) | DEFAULT, dark, light, 50 |
| `warm-50`..`warm-900` | Neutral surface + text scale (backgrounds, body text, borders) | Self-documenting scale |
| `card` | In-card surfaces and text that follow the card theme's material; app palette outside a card. CSS variables, so no opacity modifiers | paper, sheet, tint, ink, soft, pen, rule |

**Rules:**
- **Never** use Tailwind defaults (`red-*`, `green-*`, `yellow-*`, `amber-*`, `purple-*`, `gray-*`, `blue-*`, etc.) for appearance. They're not part of the brand palette. The one exception is `gray-*` in dark-overlay UI (CapturePage, CommandRunner) that's intentionally Tailwind-default dark-theme.
- **Never** add new colors to `tailwind.config.js` without a semantic role. If you need a new color category, define a new role.
- **For shade variation** on an existing color, use opacity syntax (`bg-primary/50`, `text-danger/70`) before reaching for additional numeric shades.
- **Components in `components/`** own their appearance — they reference these semantic names directly. Page-level code (outside `components/`) can only use *outer-layout* classes via `className` (enforced by `restrict-component-classes` ESLint rule).

**Panels inside a card theme.** A `Card` either paints the card's material
(`Card material`) or its own app surface, and it tells the text primitives
inside it which (`components/ui/material.ts`): `Text`, `Hint`, `Heading` and
field labels follow it unless given `material` explicitly. A panel that paints
its own light background with a raw class inside a material `Card` must also
set its own ink. Theme CSS hooks a component by a `bbx-` class, never by a
Tailwind utility class: changing the utility silently drops the override.

When a color role doesn't feel right for a use case, that's usually a sign that a new semantic role is warranted — discuss before inventing a one-off color.

## Workspace presentation

Ordinary cards and built-in interface instruments render in the workspace. Open
them through the workspace target rather than adding a parallel page, generic
preview overlay, or page-level conversation shell. Passive navigation changes
the visible attention target while preserving the conversation recipient, draft,
and send destination; only an explicit conversation action selects a recipient.
Source editing, image lightboxes, capture, and other task-specific dialogs remain
appropriate overlays for their distinct interactions.

A link to a card opens it beside the chat: build it with `cardUrl` from
`src/shared/card-url.ts` (`/<box>/views/<path>`). Notifications, chips, list
rows, and dashboard items use it. Browse (`/<box>/browse/<path>`) is a
maintenance view of the files. Link to it only when the person asks to see a
directory's files ("Open <dir>/") or chose a maintenance action ("Open in
browse view").

## Data and state

Request/response data is a tRPC query or mutation through the client in
`src/frontend/src/lib/trpc/client.ts`. Real-time data rides the shared tRPC
WebSocket: `useBusSubscription` (`hooks/useBusSubscription.ts`) for the box
event stream, `useChatWs` for chat sessions, and the `events.turnStream`
subscription for a turn's output. Do not hand-roll `fetch` or a polling loop
where a procedure or subscription exists. The documented exceptions are REST
chat send (`api-chat.ts`), XHR uploads for progress (`lib/file-upload.ts`),
and the chat recovery watchdog (`processing-status-display.ts`).
View state a reload should keep (filters, the open tab, pagination) belongs in
TanStack Router search params, not component state.

A container fetches and owns the data states; its presentational children take
loaded props. A new data view, or a change to how one loads, handles every
reachable loading, empty, and error state: a skeleton shaped like the content
(`aria-busy`) or `<StatusMessage>` while loading, an empty state that names the
next action, and an `<ErrorText>` message with a retry. A blank screen while
data resolves is a bug. A narrow change keeps the container's existing
handling and does not add unreachable states.

New calendar-date, time-zone, and duration code uses `Temporal`, never `Date`:
a date-only value is a `Temporal.PlainDate`, a timestamp a `Temporal.Instant`.
`boot()` loads the polyfill where the browser lacks Temporal
(`src/frontend/src/lib/temporal.ts`), so read `Temporal` only inside functions, never at module
load; a test of such code imports `src/frontend/test/helpers/temporal-global.ts`.

## Frontend UI Primitives

Reach for a primitive from `src/frontend/src/components/ui/` before writing appearance classes inline. The primitives own appearance (colors, borders, shadows); callers own outer layout (margin, padding, flex-self, sizing, position) via a `className` prop.

A page's own supporting components live in `pages/<x>/components/`; shared ones go in `src/frontend/src/components/`, and primitives in `components/ui/`. A component that is a nav, region, main area, or list renders its own landmark or role; never wrap another component in one from outside. Each area of a screen has at most one `intent="primary"` action.

Motion respects `prefers-reduced-motion` through one global rule in `src/frontend/src/index.css`: every CSS animation and transition runs near-instantly, except `.bbx-spinner`, which slows. Do not add `motion-safe:` per site. Scripted motion checks `prefersReducedMotion()` (`lib/reduced-motion.ts`).

Check changed UI in a browser with the browse skill, including the console errors in the [client debug log](docs/client-debug-log.md). When a change can affect the two-pane layout (`<Stack hideOnMobile>`, `<MobileBackButton>`), also check it at phone width (`set viewport 375 800`).

Every static interactive control carries a stable `id="bbx-<area>-<control>"`: kebab-case and unique app-wide (axe `duplicate-id` in the [tours](docs/testing/tours.md) catches collisions). The box agent and `bin/browse` address controls by it (`src/frontend/src/lib/ui-scan/resolve.ts`). Per-row controls get one only when a unique derived id is obvious. Never rename an existing id; iOS mirrors some of them.

Every control also has an accessible name, which screen readers, the box agent, `bin/browse`, tours, and DOM tests all use:

- The name says the action and, on a per-row control, its object: "Delete Soup", not "Delete" on every row. When an item repeats several controls (a question card's "Submit", "Later", "Answer in chat"), name the item instead: `role="group"` with `aria-labelledby` its heading (`<Card role="group">`). The box agent's scan reports a named group as the container of those controls.
- A raw `<input>`, `<textarea>` or `<select>` fails lint outside the files that own it (`personal-vibe-check/require-ui-primitive`; each tag's owners are listed in `src/frontend/eslint.config.ts`). Use the fields primitives, which carry the label. The chat composer's textarea is `ComposerTextarea` (`components/chat/InteractiveChat-composer/`).
- An icon-only control sets `aria-label`, or the primitive's `label` prop. `title` alone is not enough; `jsx-a11y/control-has-associated-label` enforces this on native elements.
- A toggle or disclosure keeps one name in both states and exposes the state: `aria-checked` on a switch, `aria-pressed` on a toggle button, `aria-expanded` on a disclosure.

**Actions**
- `<Button>` — labeled or icon-only commit-action. Props: `intent` (primary/secondary/destructive/accent/success/ghost), `shape` (rect/circle), `size`, `icon`, `loading` (auto-on for Promise `onClick`), `loadingLabel` (takes a function `(secs) => ...` to show elapsed time), `flash` (post-click feedback like "Copied!"). Discriminated union enforces `label` for icon-only variants.
- `<CloseButton>` — X-icon dismiss. `onDark` prop for dark backdrops.
- `<InlineAction>` — inline action embedded in prose ("(reset)", "retry", "+ Add comment"). Intents: emphatic/subtle/danger/quiet (`quiet` keeps the surrounding color and underlines on hover). Has `flash` for clipboard copies etc.

**Inputs** (all in `ui/fields/`)
- `<TextField>`, `<TextareaField>`, `<NumberField>` — label + input + error + helper, pass-through of native validation attrs (`required`, `minLength`, `pattern`, etc.). `hideLabel` for sr-only labels. Value/onChange are controlled. `identifier` on `<TextField>` turns off spellcheck, autocorrect and auto-capitalization for hostnames, ids, URLs and names. `revealable` on a `type="password"` `<TextField>` adds a "Show password" button (`aria-pressed` carries the state); use it on login, setup and change-password.
- `<CheckboxField>` — inline checkbox with label to the right.
- `<Checkbox>` — a bare checkbox for a row whose own text names it (a todo) or a display-only marker (a Markdown task). `aria-label` or `aria-labelledby` is required by type; with no `onChange` it renders read-only.
- `<SelectField>` — dropdown select with options array. `tone="dark"` on the dark capture screen (the field and ink of `ModalDialog`'s dark tone).
- `useFilePicker({ accept, multiple, onFiles })` — returns `{ open, input }`: render `input` (a hidden file input) and call `open` from the caller's button or menu item.
- `<RadioGroup>` — stacked (`variant="list"`) or card-style (`variant="cards"`) radios.
- `<Toggle>` — iOS-style pill switch for immediate-apply settings (distinct from CheckboxField, which is form-bound). Props: `checked`, `onChange`, `disabled`, `label`.

**Navigation**
- `<Link>` — use TanStack Router's Link for any internal nav.
- `<TextLink>` — styled inline internal link (primary + underline-on-hover).
- `<ExternalLink>` — external-url link with target=_blank, rel=noopener, trailing icon. Variants: inline / plain / button.
- `<ExternalIconLink>` — icon-only "open in new tab" affordance with required `label` for aria. `onDark` variant.
- `<OpenInPanelButton>` — icon-only button that opens a file in the chat's companion side panel; sibling to `<ExternalIconLink>`'s open-in-new-tab action. Sizes `sm`/`md`.

**Display**
- `<Image>` — src/alt/size with built-in lightbox, error placeholder, bbox overlay, rotation. Lightbox and onClick are mutually exclusive at the type level. Only `size="thumb"` reserves its box; for larger sizes, set dimensions or an aspect ratio when known so the layout does not shift, and use `loading="lazy"` below the fold.
- `<VideoEmbed>` — responsive 16:9 lazy-loaded video iframe (privacy-friendly nocookie domain), block-level like a figure; used for embedded video in rendered markdown.
- `<Avatar>` — user profile image with initial fallback. `fallbackClassName` for dark nav contexts.
- `<FriendlyDate>` — renders an ISO timestamp as a localized date/time (the browser's locale and zone) in a semantic `<time>` carrying the machine-readable ISO. `mode` prop: `"datetime"` (default) or `"date"`.
- `<VisuallyHidden>` — renders content for screen readers/the a11y tree only (`sr-only`), hidden visually; use for page-level headings that live inside a component which can collapse or move off-screen at some viewports. `as` prop picks the rendered tag (e.g. `"h1"`).
- `<CardMark>` — the one renderer of a card's symbol (an emoji glyph or an image). The caller supplies `fallback` for a card with no usable mark; a glyph is never truncated.
- `<MetaItem>` — small uppercase label followed by its value, for a document's metadata row.
- `<BrokenLink>` — a visibly disabled marker with the reason in `title`, for a link that leads nowhere (retired `view:` scheme, escaped path, `control:` pointer whose control is not on screen).
- `<ControlRing>` — the accent ring a `control:` pointer draws around its target control for a moment; non-interactive, static under `prefers-reduced-motion`.
- `<Pre>` — preformatted block (code, xml, JSON dumps). Props: `size`, `boxed`, `scroll`, `error`, `muted`.
- `<JsonView>` — human-friendly JSON renderer (keys label indented values, arrays as hanging-indent `0:`/`1:` lists, recursive). Strings keep whitespace and wrap on any character; numbers/booleans/null show via `JSON.stringify` in a distinct color. Use for tool-call args and similar object dumps instead of `JSON.stringify` in a `<Pre>`.
- `<Badge>` — pill label. Tones: neutral/info/success/warning/danger/accent. Sizes: sm/md.
- `<StatusBadge>` — card-status badge that maps `status` (new/pending/answered/processing/processed) to the right Badge tone. Pass `children` to override the displayed text (e.g., show a count instead).
- `<Heading level={2|3}>` — section heading. Renders a real `h2`/`h3`; the level sets the look (2: lg semibold, 3: sm semibold). Pick the level from the page outline, never for size.
- `<Hint>` — secondary explanatory text under a heading or control: a small muted `<p>`. Inline metadata beside other content (a timestamp in a `Row`) stays `<Text size="xs" tone="muted">`.
- `<ErrorText>` — an error message: a small danger-colored `<p>`. Not a live region; the component that shows a new error owns any announcement.
- `<Spinner>` — the indeterminate progress glyph, decorative (`aria-hidden`); name the work in text, a label or `aria-busy`. `size` (`sm`/`md`), `tone` (`current` takes the text color, `onDark` is white). The only owner of `animate-spin` (`restricted-classes` lint rule). Under reduced motion it turns at a third of its speed.
- `<LiveDot>` — a pulsing status dot: recording, uploading, still working. Decorative (`aria-hidden`); the adjacent text or label states the same fact. `tone` (`danger`/`warning`/`info`/`accent`/`current`), `size` (`sm`/`md`). Under reduced motion it pulses once and rests solid.
- `<Skeleton className="h-5 w-48">` — one placeholder bar for content still loading, sized by `className`; compose bars into a component named for the content (`BrowseSkeleton`) that matches its shape. The container that shows skeletons carries `aria-busy` and a label. Do not write `animate-pulse` bars by hand.
- `<StatusMessage>` — a placeholder while there is nothing to show (loading, empty, not found). `variant` `pane` (default) is padded for a whole pane, `menu` is a compact row in a list panel, `inline` is a small-text line with no padding for a card or section. Write loading text as "Loading X…" (one ellipsis character). `role="status"`. Pass `busy` while loading, so screen readers hold the announcement until the result replaces the loading text. Other progress text ("Saving…") is not a live region. Errors use `<ErrorText>`.
- `<Text>` — typography primitive for text no role above covers. `as` (span/p/div/h1..h6), `tone`, `size`, `weight`, `italic`, `mono`, `truncate`, `center`, `uppercase` (uppercase + tracking-wide, for small section headings), `breakAll` (break long URLs across any character).

**Layout containers**
- `<Stack>` — vertical flex column with `gap: none/xs/sm/md/lg` (default `md`). Children stretch to the full width; an inline-level child (a `Button`, a `Badge`) that should keep its natural width takes `className="self-start"`. A child's own margin adds to the gap, so space children with `gap`, not margins. Also the page-level scroll container: `overflow` (visible/hidden/auto/scroll), `focusable` (keyboard-scrollable; set it with `overflow="auto"`), `align` (start/center/end/stretch), and `hideOnMobile` (`hidden sm:flex`, for the detail pane of a two-pane layout).
- `<Row>` — horizontal flex with gap/align/justify/wrap.
- `<Card>` — bordered box with padding/background/shadow/rounding props. `muted` dims the card to indicate inactive/archived content. `material` paints the enclosing card theme's surface; text primitives inside read `MaterialContext` (`useMaterial(explicit)`) and take the material's ink, so a white app panel inside one (a non-material `Card`, a `Menu` panel) keeps app ink.
- `<Accordion>` — collapsible disclosure. `variant: bordered/plain`.

**Overlays & Composite**
- `<FileEntry>` — canonical one-line file representation (icon + title/path + peek button) shared across the recent-files dropdown and tool-use expansions. Expands in place to the full file viewer; `onPanel` escalates to a companion side panel; `onOpen` makes the title open the file instead of previewing it.
- `<Menu>` + `<MenuItem>` + `<MenuDivider>` — a popup panel with click-outside, escape-to-close and auto-close on select. `<Menu>` takes a render-prop `trigger`. `kind` is `"menu"` (default): a command menu with `role="menu"`, `aria-haspopup="menu"` on the trigger, `menuitem` rows and ArrowUp/ArrowDown/Home/End focus movement; or `"navigation"`: a list of links, a plain disclosure with no menu roles. A body that renders its own items reads `useMenuClose()` to close the menu and `useMenuItemRole()` for the role its items take; a panel portaled out of the menu wraps its content in `<PortaledMenuScope>` so those hooks still work. A `MenuItem` with `href` also accepts `download` (filename) and `target="_blank"` for file actions.
- `<TabBar>` — generic tab group with active state. `mode`: `"tabs"` (default) is a tablist whose tabs each control a panel (`idPrefix`, `controlsPrefix`); `"buttons"` is for filter or view switches with no panel: a `role="group"` of `aria-pressed` buttons, all in the tab order.
- `<ModalDialog>` — a modal: a native `<dialog>` opened with `showModal()`, so focus stays inside, the page behind is inert and focus returns to the opener. Props: `open`, `labelledBy` (id of the heading that names it), `tone` (`light`/`dark`), `onCancel` (Escape), `onBackdropClick`, `initialFocus`. The caller supplies the heading, body and action row.
- `<Notice>` — an inline bordered message about a failed or degraded operation, set in the page flow. `tone="error"` is `role="alert"`, `tone="warning"` is `role="status"`. Not a toast and not a field error (`<ErrorText>`).
- `<ToastViewport>` — the one mount point (`app-shell.tsx`) for error toasts. Raise one from any code with `toastError(message, { cause })` (`ui/toast-store.ts`); identical messages collapse into a counter. Do not mount a second viewport.
- `ImageLightbox` is not a primitive: it lives at `components/ImageLightbox.tsx` and is reached through `<Image lightbox>`.
- `<MobileBackButton>` — chevron + label back-navigation button for two-pane mobile layouts. Hidden at `sm+` breakpoints. Used at the top of the detail pane.

Dialog rules, with no exception, since the primitives render a native `<dialog>`:
- A modal is `ModalDialog`; a non-modal anchored panel is `Popover` (planned: Track 7 of `docs/plans/ui-primitives-dedup.md` adds it; until then an anchored panel is a `Menu`).
- Never write `role="dialog"` on a `div`.
- Never lock body overflow; the native modal makes the page behind inert.

**Renderer-specific**
- `<BboxOverlay>` — bounding box for image renderer (rectangle with color + position).

### `className` convention

Every primitive accepts a `className` prop. It is for **outer-layout classes only** — margin, padding, flex/grid item behavior, sizing, position. The `restrict-component-classes` ESLint rule enforces this on files outside `components/` subdirectories. The rule can only check classes it can prove statically (string literals, template-literal quasis, and the resolvable branches of conditional/logical expressions) — a value built from a variable, function call, or member expression is invisible to it and passes silently, so keep `className` values literal if you want the rule to actually catch violations.

Inside the primitive, `className` is merged with the component's own classes via the `cn()` helper in `src/frontend/src/lib/cn.ts`, which wraps `tailwind-merge` — caller values win where they overlap (caller's `p-6` overrides component's default `p-3`).

Examples:
```tsx
<Button className="mb-4" intent="primary">Save</Button>         // margin on button
<TextField className="flex-1" label="Email" ... />              // flex-1 in a row
<Image className="mt-2" src={url} alt={alt} />                  // margin on image
<Stack className="max-w-xl mx-auto" gap="md">...</Stack>        // width-bound stack
```

What fails lint:
```tsx
<Button className="bg-danger" ...>         // appearance — use intent="destructive" instead
<Text className="text-warm-500" ...>       // appearance — use tone="muted" instead
<Card className="shadow-lg" ...>           // appearance — use shadow prop instead
```

### Adding a new UI primitive

1. Does an existing primitive with a new prop cover this? If so, add the prop.
2. Is the pattern used 3+ times with uniform look? If so, extract a primitive.
3. Is it genuinely a one-off in a specific context (inside `components/`)? Then keep it local — don't force abstraction.

New primitives live in `components/ui/<Name>.tsx`, accept `className`, merge via `cn()`, and document their semantic role in frontend.md.

For a fixed development preview and repeatable screenshots, use the
[theme authoring studio](docs/theme-authoring.md).

The generic theme gallery is installed explicitly into a development box from
`test/fixtures/theme-tour`. From the monorepo root:

```sh
node --import tsx beebox/src/scripts/install-theme-tour.ts <box-root>
bin/tour card-themes
bin/tour card-theme-previews
bin/tour card-theme-interface
```

The installer leaves changed files alone and reports conflicts. Its entry card
is `_content/theme-tour/Theme_Tour.doc.card`. Knowledge audits reset their test
box; reinstall the gallery afterward if that box was used for an audit.
