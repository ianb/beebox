# Coding Conventions

## Type Checking and Linting

Run checks after writing code. The build tool (esbuild) does NOT do type checking or linting — it just strips types. A pre-commit hook runs both automatically.

```bash
npm run typecheck    # TypeScript errors
npm run lint         # ESLint errors
npm run lint:oxlint  # Supplemental linter (fast, catches patterns ESLint misses)
npm run lint:knip    # Dead code detector (unused files, exports, dependencies)
npm run lint:circular  # Circular dependency detector (madge)
```

- The tsconfig is strict — no implicit `any` allowed
- ESLint config is in `eslint.config.mjs` with rules reviewed individually
- oxlint provides supplemental checks (ambiguous constructors, useless spreads, identical ternary branches, etc.) — run periodically, not in pre-commit
- knip detects unused files, exports, and dependencies — run periodically to catch dead code
- madge detects circular dependencies — type-only cycles (`import type`) are acceptable, value import cycles are not

## Error Handling

- NEVER use `any` type (enforced via tsconfig and eslint)
- NEVER use bare `catch {}` — always bind the error: `catch(e)` to log it, or `catch(_e)` if truly unused
- ONLY catch the minimal, specific error you can handle
- If there's an error boundary with recovery, ALWAYS log the error somewhere
- Never silently ignore errors — at minimum log them
- Use custom error classes, not `new Error()` — enables programmatic error inspection

## Code Style

- **Semicolons**: always (enforced by eslint)
- **Quotes**: double quotes (enforced by eslint)
- **No optional chaining** (`?.`): use explicit null checks for clarity
- **No default parameters**: handle defaults explicitly in function body
- **Max 2 positional parameters**: functions with more must use a named params object:
  ```typescript
  // Bad: too many positional params
  function save(path: string, content: string, hash: string) { ... }

  // Good: named params object
  function save(path: string, { content, hash }: SaveOptions) { ... }
  ```
- **Consistent naming between variables and parameters**: name object properties to match common variable names at call sites, so callers can use shorthand:
  ```typescript
  // Good: property names match local variables, enabling shorthand
  const content = readFile(path);
  const hash = computeHash(content);
  save(path, { content, hash });

  // Bad: property names don't match, forcing verbose call sites
  save(path, { fileContent: content, contentHash: hash });
  ```
- Prefer explicit types over inference where it aids readability
- Use meaningful variable names
- Files max 300 lines, functions max 150 lines (excluding blanks/comments)
- **Only export what's needed**: don't export functions/constants only used within their own file. knip enforces this.

## Data Source Tagging

UI elements that display data from a known source (card, commit, session, etc.) must be tagged with `data-cb-source` attributes for traceability. Use the `cbSource()` and `cbSourceItem()` helpers from `src/frontend/src/lib/source-tag.ts`. Tag the outermost meaningful data boundary — not every inner element. See `docs/data-source-tagging.md` for the full convention.

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
- `<Toggle>` — iOS-style pill switch for immediate-apply settings (distinct from CheckboxField, which is form-bound).

**Navigation**
- `<Link>` — use TanStack Router's Link for any internal nav.
- `<TextLink>` — styled inline internal link (primary + underline-on-hover).
- `<ExternalLink>` — external-url link with target=_blank, rel=noopener, trailing icon. Variants: inline / plain / button.
- `<ExternalIconLink>` — icon-only "open in new tab" affordance with required `label` for aria. `onDark` variant.

**Display**
- `<Image>` — src/alt/size with built-in lightbox, error placeholder, bbox overlay, rotation. Lightbox and onClick are mutually exclusive at the type level.
- `<Avatar>` — user profile image with initial fallback. `fallbackClassName` for dark nav contexts.
- `<Pre>` — preformatted block (code, xml, JSON dumps). Props: `size`, `boxed`, `scroll`, `error`, `muted`.
- `<HighlightedCode>` — wraps highlight.js output in a `<code class="hljs">`. Use inside a `<Pre boxed>`.
- `<Badge>` — pill label. Tones: neutral/info/success/warning/danger/accent. Sizes: sm/md.
- `<Text>` — typography primitive. `as` (span/p/div/h1..h6), `tone`, `size`, `weight`, `italic`, `mono`, `truncate`, `center`.

**Layout containers**
- `<Stack>` — vertical `space-y-*` between children. `gap: none/xs/sm/md/lg`.
- `<Row>` — horizontal flex with gap/align/justify/wrap.
- `<Column>` — vertical flex-col (different from Stack: uses flex not space-y, has align).
- `<Card>` — bordered box with padding/background/shadow/rounding props.
- `<Accordion>` — collapsible disclosure. `variant: bordered/plain`.

**Overlays & Composite**
- `<Dropdown>` + `<MenuItem>` + `<MenuDivider>` — menu with click-outside, escape-to-close, auto-close on select. `<Dropdown>` takes a render-prop `trigger`.
- `<TabBar>` — generic tab group with active state.
- `<ImageLightbox>` — fullscreen image overlay (usually accessed via `<Image lightbox>` rather than directly).

**Renderer-specific**
- `<BboxOverlay>` — bounding box for image renderer (rectangle with color + position).

### `className` convention

Every primitive accepts a `className` prop. It is for **outer-layout classes only** — margin, padding, flex/grid item behavior, sizing, position. The `restrict-component-classes` ESLint rule enforces this on files outside `components/` subdirectories.

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

New primitives live in `components/ui/<Name>.tsx`, accept `className`, merge via `cn()`, and document their semantic role in CONVENTIONS.md.
