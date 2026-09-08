# Frontend Conventions

UI palette, primitives, and the `className` rule. Backend code never needs to load this; code-style.md covers conventions that apply to both halves.

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
rejected; see `docs/attribution.md` for why the artwork is a dependency.

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
| `accent` | Highlights, CTAs, focus rings, warning-lite | DEFAULT, dark, light, 50, 100 |
| `info` | Informational callouts, metadata badges | DEFAULT, dark, light, muted, 50, 100 |
| `danger` | Destructive actions, error messages | DEFAULT, dark, light, 50, 100 |
| `success` | Positive confirmations, connected state | DEFAULT, dark, light, 50, 100 |
| `warning` | Caution, dirty state, notes | DEFAULT, dark, light, 50, 100 |
| `coral` | App-nav gradient only (no semantic role) | DEFAULT, dark, light, 50 |
| `warm-50`..`warm-900` | Neutral surface + text scale (backgrounds, body text, borders) | Self-documenting scale |

**Rules:**
- **Never** use Tailwind defaults (`red-*`, `green-*`, `yellow-*`, `amber-*`, `purple-*`, `gray-*`, `blue-*`, etc.) for appearance. They're not part of the brand palette. The one exception is `gray-*` in dark-overlay UI (CapturePage, CommandRunner) that's intentionally Tailwind-default dark-theme.
- **Never** add new colors to `tailwind.config.js` without a semantic role. If you need a new color category, define a new role.
- **For shade variation** on an existing color, use opacity syntax (`bg-primary/50`, `text-danger/70`) before reaching for additional numeric shades.
- **Components in `components/`** own their appearance — they reference these semantic names directly. Page-level code (outside `components/`) can only use *outer-layout* classes via `className` (enforced by `restrict-component-classes` ESLint rule).

When a color role doesn't feel right for a use case, that's usually a sign that a new semantic role is warranted — discuss before inventing a one-off color.

## Frontend UI Primitives

Reach for a primitive from `src/frontend/src/components/ui/` before writing appearance classes inline. The primitives own appearance (colors, borders, shadows); callers own outer layout (margin, padding, flex-self, sizing, position) via a `className` prop.

**Actions**
- `<Button>` — labeled or icon-only commit-action. Props: `intent` (primary/secondary/destructive/accent/success/ghost), `shape` (rect/circle), `size`, `icon`, `loading` (auto-on for Promise `onClick`), `loadingLabel` (takes a function `(secs) => ...` to show elapsed time), `flash` (post-click feedback like "Copied!"). Discriminated union enforces `label` for icon-only variants.
- `<CloseButton>` — X-icon dismiss. `onDark` prop for dark backdrops.
- `<CancelButton>` — semantic shortcut for `<Button intent="secondary">Cancel</Button>`.
- `<InlineAction>` — inline action embedded in prose ("(reset)", "retry", "+ Add comment"). Intents: emphatic/subtle/danger. Has `flash` for clipboard copies etc.

**Inputs** (all in `ui/fields.tsx`)
- `<TextField>`, `<TextareaField>`, `<NumberField>` — label + input + error + helper, pass-through of native validation attrs (`required`, `minLength`, `pattern`, etc.). `hideLabel` for sr-only labels. Value/onChange are controlled.
- `<CheckboxField>` — inline checkbox with label to the right.
- `<SelectField>` — dropdown select with options array.
- `<RadioGroup>` — stacked (`variant="list"`) or card-style (`variant="cards"`) radios.
- `<Toggle>` — iOS-style pill switch for immediate-apply settings (distinct from CheckboxField, which is form-bound). Props: `checked`, `onChange`, `disabled`, `label`.

**Navigation**
- `<Link>` — use TanStack Router's Link for any internal nav.
- `<TextLink>` — styled inline internal link (primary + underline-on-hover).
- `<ExternalLink>` — external-url link with target=_blank, rel=noopener, trailing icon. Variants: inline / plain / button.
- `<ExternalIconLink>` — icon-only "open in new tab" affordance with required `label` for aria. `onDark` variant.
- `<OpenInPanelButton>` — icon-only button that opens a file in the chat's companion side panel; sibling to `<ExternalIconLink>`'s open-in-new-tab action. Sizes `sm`/`md`.

**Display**
- `<Image>` — src/alt/size with built-in lightbox, error placeholder, bbox overlay, rotation. Lightbox and onClick are mutually exclusive at the type level.
- `<VideoEmbed>` — responsive 16:9 lazy-loaded video iframe (privacy-friendly nocookie domain), block-level like a figure; used for embedded video in rendered markdown.
- `<Avatar>` — user profile image with initial fallback. `fallbackClassName` for dark nav contexts.
- `<FriendlyDate>` — renders an ISO timestamp as a localized date/time (the browser's locale and zone) in a semantic `<time>` carrying the machine-readable ISO. `mode` prop: `"datetime"` (default) or `"date"`.
- `<VisuallyHidden>` — renders content for screen readers/the a11y tree only (`sr-only`), hidden visually; use for page-level headings that live inside a component which can collapse or move off-screen at some viewports. `as` prop picks the rendered tag (e.g. `"h1"`).
- `<Pre>` — preformatted block (code, xml, JSON dumps). Props: `size`, `boxed`, `scroll`, `error`, `muted`.
- `<HighlightedCode>` — wraps highlight.js output in a `<code class="hljs">`. Use inside a `<Pre boxed>`.
- `<JsonView>` — human-friendly JSON renderer (keys label indented values, arrays as hanging-indent `0:`/`1:` lists, recursive). Strings keep whitespace and wrap on any character; numbers/booleans/null show via `JSON.stringify` in a distinct color. Use for tool-call args and similar object dumps instead of `JSON.stringify` in a `<Pre>`.
- `<Badge>` — pill label. Tones: neutral/info/success/warning/danger/accent. Sizes: sm/md.
- `<StatusBadge>` — card-status badge that maps `status` (new/pending/answered/processing/processed) to the right Badge tone. Pass `children` to override the displayed text (e.g., show a count instead).
- `<Text>` — typography primitive. `as` (span/p/div/h1..h6), `tone`, `size`, `weight`, `italic`, `mono`, `truncate`, `center`, `uppercase` (uppercase + tracking-wide, for small section headings), `breakAll` (break long URLs across any character).

**Layout containers**
- `<Stack>` — vertical `space-y-*` between children. `gap: none/xs/sm/md/lg`.
- `<Row>` — horizontal flex with gap/align/justify/wrap.
- `<Column>` — vertical flex-col (different from Stack: uses flex not space-y, has align). Takes `overflow` (visible/hidden/auto/scroll) so it can serve as a page-level scroll container. `hideOnMobile` makes it `hidden sm:flex` — typical for the detail pane in a two-pane layout.
- `<Card>` — bordered box with padding/background/shadow/rounding props. `muted` dims the card to indicate inactive/archived content.
- `<Accordion>` — collapsible disclosure. `variant: bordered/plain`.

**Overlays & Composite**
- `<FileEntry>` — canonical one-line file representation (icon + title/path + peek button) shared across the recent-files dropdown and tool-use expansions. Expands in place to the full file viewer; `onPanel` escalates to a companion side panel.
- `<Dropdown>` + `<MenuItem>` + `<MenuDivider>` — menu with click-outside, escape-to-close, auto-close on select. `<Dropdown>` takes a render-prop `trigger`.
- `<TabBar>` — generic tab group with active state.
- `<ImageLightbox>` — fullscreen image overlay (usually accessed via `<Image lightbox>` rather than directly).
- `<MobileBackButton>` — chevron + label back-navigation button for two-pane mobile layouts. Hidden at `sm+` breakpoints. Used at the top of the detail pane.

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

The generic theme gallery is installed explicitly into a development box from
`test/fixtures/theme-tour`. From the monorepo root:

```sh
node --import tsx beebox/scripts/install-theme-tour.ts <box-root>
bin/tour card-themes
bin/tour card-theme-previews
bin/tour card-theme-interface
```

The installer leaves changed files alone and reports conflicts. Its entry card
is `_content/theme-tour/Theme_Tour.memo.card`. Knowledge audits reset their test
box; reinstall the gallery afterward if that box was used for an audit.
