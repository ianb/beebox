---
title: "`.webpage.card` + commentary-as-attachment"
status: implemented
workstream: unknown
issues: []
---
# `.webpage.card` + commentary-as-attachment

**Status: shipped to main 2026-06-16 — this doc is the frozen record.** All six
tracks landed: the `webpage` schema (ref-free anchors target the container),
`WebpageView` with inline attach-scoped commentary (verified live), the clerk
capture endpoints, save-page convergence, the migrator (verified on real box
data + fixture doctest), and the agent guide + knowledge audits (4/4 pass).

Restructure the web-page commentary feature so the captured page and the
remarks about it are two separate things. Today a single
`*.commentary.card` is forced to be *both* the captured web page (readable
markdown + frozen snapshot in `.attach/`) *and* the boxholder's remarks.
This plan splits that into:

1. a new **`.webpage.card`** type that *is* the captured page — readable
   rendering as its body, frozen snapshot as a private attachment, original
   URL + capture provenance in frontmatter; and
2. **commentary** that lives *inside the host's attachment scope*
   (typically), keeps the `{% source %}` / `{% quote %}` anchoring and the
   `defaultRef` + `targets[]` multi-target machinery, and points at the
   `.webpage.card` (or any doc) it annotates.

The payoff isn't the multi-document case (that already works via
`targets[]`) — it's that **commentary stops being welded to web capture** and
becomes a capability you can apply to any document, while the captured page
becomes a first-class artifact that `save-page` and `comment-on-page` both
produce.

This plan supersedes the capture-side data-shape decisions in
[`clerk-webpage-capture.md`](./clerk-webpage-capture.md) (which is otherwise
implemented and verified live as of 2026-06-14); the landmark
`<destination>` work, the extension capture pipeline, and the chat companion
deep-link from that plan are unchanged and reused here.

---

## Stated preferences this plan trades against

- `beebox/CLAUDE.md:43` — *"Naming: `Name.type.card` — the type
  determines which schema validates it."* The new type must follow the
  `.webpage.card` convention and register a schema, not special-case the
  parser.
- `beebox/CLAUDE.md` — *"don't add features beyond what the task
  requires."* A new card type is a real cost (schema, renderer, migration,
  agent vocabulary). It earns its place only because the captured page has
  distinct provenance/immutability/rendering that `doc`+frontmatter would
  fake; this plan must justify the type, not assume it.
- `beebox/code-style.md` — no optional chaining, no default params,
  ≤2 positional params, no `any`. Applies to the schema, the migrator, and
  the renderer split.
- **Most recent shipped precedent:** the `<destination for="…">` role +
  back-compat alias (landmark.ts) is the template for how this plan handles
  the `.commentary.card` → split transition (accept old shape for a release
  window, migrate, keep tests green throughout).

Every direction below traces back to one of these.

---

## What already exists

- **Card-type system.** `cardSchema(type, { fields })` registered in
  `src/schemas/registry.ts:39-91`; type resolved from the `Name.type.card`
  filename + frontmatter `type:` field. A new `webpage` type is a normal
  registration, not a parser change. *Reuse.*
- **Commentary schema.** `src/schemas/commentary.tsx:20-39` — `title`,
  `defaultHref` xor `defaultRef`, `targets[]`, `source`/`captured`/`frozen`,
  `body`. The `source`/`captured`/`frozen` fields are captured-page
  provenance that this plan **moves off** the commentary onto the
  `.webpage.card`; the targeting fields (`defaultRef`/`targets[]`) **stay**.
  *Reuse targeting, relocate provenance.*
- **Commentary renderer.** `CommentaryView.tsx` already renders the saved
  page in its own bordered block (`:319-338`) separately from the remarks
  body (`:294-302`), with `savedPaneRef` (`:274`) scoped only to the saved
  page. The two are **already layout-separated and not entangled** — the
  split is mostly mechanical: lift the saved-page block into a reusable
  `WebpageView`. *Reuse, refactor.*
- **Clerk endpoint.** `clerk.ts:157-218` (`POST /api/clerk/commentary`)
  writes card + `attach/readable.md` + `attach/page.frozen` in one commit,
  sets `defaultRef: "attach/readable.md"`, returns `{ created, open }` where
  `open` is a chat deep-link with `companion=view:<card>`. This handler is
  **rewritten** to produce a `.webpage.card` (+ optional commentary). *Rebuild.*
- **Save-page endpoint.** `clerk.ts:108-149` produces a **`.record.card`**
  (`:119`) with the frozen HTML stored as a *sibling* `.frozen` file
  (`:140-144`), filed in `box/inbox/pages-saved|pages-todo`. This is the
  convergence target: today save-page and comment-on-page produce *different*
  shapes. *Candidate to unify onto `.webpage.card`.*
- **Attachment scope + card scanning.** `lib/attach-path.ts`
  (`attachmentPath`, `isInsideAttachScope`); `search/walk.ts:4` enumerates
  every `*.card` *including inside `.attach/`* but `:35` treats attach-scope
  cards as *"content [that] belongs to its owning card"*;
  `maps/precheck-ignore.ts:38` ignores `**/*.attach`. This is the machinery
  that makes "commentary lives in the host's attach scope" *possible* — and
  the source of its central risk (addressability; see Open questions). *Reuse,
  verify.*
- **Frozen serving.** `api-files.ts:40,152-156` — `.frozen` →
  `text/html` + `Content-Security-Policy: sandbox` + `nosniff`. Unchanged.
- **Landmark destination.** `<destination for="commentary">` +
  `core/landmark/destination.ts` (`DESTINATION_KINDS`, `findDestination`).
  Still the filing target; **unchanged** (a webpage+commentary bundle lands at
  a `for="commentary"` destination exactly as today).
- **Migration harness.** `src/core/migrations.ts:17-46` + `scripts/migrate/*`
  + `config/migrations.jsonl` manifest. The split migration is one more
  entry. *Reuse.*
- **Directory head-cards idea.** `docs/ideas.md:740-755` — the unifying frame:
  `Foo.attach/` is the *private-bag* special case; a typed `Foo/` is a
  head-card over *peers*. Directly informs the commentary-placement decision
  below. *Internal prior art.*

---

## Prior art (external)

Mostly an internal vocabulary decision, so little external surface — but the
two pieces that touch third-party behavior were already researched and are
unchanged here:

- **Text Fragments** — `text-fragments-polyfill`
  `processTextFragmentDirective` for in-pane jump; native `#:~:text=` for the
  frozen snapshot. Settled in `clerk-webpage-capture.md`; reused verbatim.
- **single-file-core lazy images** — bounded scroll+1s settle replaced the
  unbounded `loadDeferredImages` network-idle wait (committed `20ad9875`).
  Independent of this restructure.

No external prior art exists for the card-shape split itself — it's an
internal schema/vocabulary choice. The relevant prior art is *internal*: the
`<destination>` transition (migration + back-compat pattern) and the
head-cards idea doc.

---

## Tracks / scope

Ordered by implementation dependency: schema → endpoint → renderer →
migration → (optional) save-page convergence.

### Track 1 — `.webpage.card` schema

**What.** A new frontmatter card type `webpage`.

**Why this needs to change.** A captured page has provenance a hand-authored
`doc` doesn't (`source` URL, `captured` instant, `frozen` snapshot ref) and is
semantically a *snapshot* (immutable). Faking it with `doc` + frontmatter
loses validation of those fields and the distinct rendering (readable body +
"original page" / "frozen snapshot" affordances). This is the one place the
"don't add ideas" rule is overridden, and it's overridden deliberately.

**Direction.** `src/schemas/webpage.tsx`:

```ts
export const WebpageSchema: CardSchema = cardSchema("webpage", {
  fields: {
    title: z.string().optional(),
    source: z.string(),              // original page URL (required)
    captured: z.string(),           // ISO instant; rendered in local zone
    siteName: z.string().optional(),
    byline: z.string().optional(),
    excerpt: z.string().optional(),
    frozen: z.string().optional(),  // in-box ref to attach/page.frozen
    body: body(z.string()),         // the readable markdown IS the body
  },
  // instructions: this card is a captured snapshot; the body is the readable
  // rendering; edit sparingly — it represents an external page at capture time.
});
```

**Key shape decision:** the readable markdown is the **card body**, not an
`attach/readable.md` file. The webpage card *is* the document (mirrors how
`.record.card` stores save-page markdown inline). The only attachment is the
heavy frozen snapshot. This is a change from today's commentary layout
(readable in `.attach/`) and it's what makes the webpage card render itself.

**Vocabulary lock-ins:** type string `webpage`; field names
`source`/`captured`/`frozen` (same names the commentary schema uses today, so
the migration is a relocation, not a rename); `frozen` ref convention
`attach/page.frozen`.

**First chunk:** schema file + registry entry + one doctest that round-trips a
`.webpage.card` through parse/validate. No open questions inside it.

### Track 2 — Clerk endpoint: produce webpage + commentary

**What.** Rewrite `POST /api/clerk/commentary` to write a `.webpage.card`
(body = readable markdown, `attach/page.frozen`, provenance frontmatter) and,
when the bundle is a "comment" action, a commentary card pointing at it.

**Why.** The endpoint currently fuses both into one `.commentary.card`. With
the split, the *page* is always written; the *commentary* is the annotation
layer on top (initially empty body — the chat agent fills it).

**Direction.** Files written, all in one commit:
- `<destDir>/<name>.webpage.card` — body = readable markdown, provenance
  frontmatter.
- `<destDir>/<name>.attach/page.frozen` — the snapshot.
- `<destDir>/<name>.attach/<name>.commentary.card` — the commentary, **inside
  the webpage's attach scope** (resolved: ownership is correct — the
  commentary is invalidated/moved when the page is; `bbx mv` already moves an
  attach scope as a unit). Body starts empty; the chat agent authors the
  anchors. Its primary subject is the owning page (see Open question 1 for how
  the anchor refs name the owner); `targets[]` may add cross-doc references.

Response `open` opens chat with the **webpage card** as `companion=view:…` —
the webpage view renders the page *and* surfaces its attach-scoped commentary
inline (Track 3), so the companion shows the annotated document as it fills in.
Context dir = the destination. Request schema unchanged (`url`, `title`,
`readableMarkdown`, `frozenHtml?`, `destinationDir?`).

**First chunk:** endpoint writes `.webpage.card` + `attach/page.frozen` + an
empty-body `attach/*.commentary.card` + route doctest asserting the three-file
shape and the `open` companion target.

### Track 3 — Renderer: webpage view surfaces its commentary inline

**What.** Two pieces:
1. **`WebpageView`** renders a `.webpage.card`: the readable body + "Original
   page" link + "Frozen snapshot ↗" link + local-zone `captured` date.
2. **Card views surface attach-scoped commentary.** When a card is viewed,
   load any `*.commentary.card` from its attach scope and render the remarks
   **inline** alongside the body — each `{% source %}` anchor's chip jumps into
   the *already-displayed* body (no second source pane: the page body is shown
   once, as the card's own content, and the anchors highlight within it). This
   is the standard-card-view surfacing the boxholder described; it's written
   generically (any host card can carry attach commentary), with `webpage` as
   the first consumer.

**Why.** This is cleaner than today's `CommentaryView`, which renders a
*separate* "Saved page" block (`CommentaryView.tsx:319-338`) duplicating the
source. With the split, the page body is the card's content and the commentary
anchors jump within it — one rendering of the page, annotations layered on.
`WebpageView` is also reusable for a plain saved page with no commentary
(Track 5). The jump-to-quote machinery (`onJumpToQuote`,
`CommentaryView.tsx:266-292`) is retargeted from the saved-pane to the webpage
body — same text-fragments-polyfill + CSS-highlight path.

**Note on independent commentary viewing.** Viewing a commentary card *on its
own* (outside its host) rides the general "attachments are viewable" UI path
(deferred, see NOT in scope) — a different browse route, not radically
different. The primary capture→annotate flow never needs it: the webpage view
is the surface.

**First chunk:** `WebpageView.tsx` registered for card type `webpage` (renders
a hand-made `.webpage.card`); then the attach-commentary loader + inline
anchor rendering, retargeting `onJumpToQuote` to the body. Today's
`CommentaryView` saved-page block is retired once both land.

### Track 4 — Migration

**What.** `scripts/migrate/webpage-card.ts` + a `MIGRATIONS` entry. For each
existing fused `Foo.commentary.card` carrying `source`/`captured`/`frozen`
provenance:
- create `Foo.webpage.card` taking over the basename — body lifted from
  `Foo.attach/readable.md`, provenance frontmatter copied over, `frozen` ref
  kept (`Foo.attach/page.frozen` stays in place);
- move the remarks into the attach scope as `Foo.attach/Foo.commentary.card`,
  stripped of the relocated provenance fields, its anchors repointed from
  `attach/readable.md` to the owning page (per Open question 1);
- delete `Foo.attach/readable.md` (now the webpage body).

Remarks-only commentaries (no provenance) are left untouched.

**Why.** Dogfooding produced a handful of real fused `.commentary.card`s on
the hosted box; they must not break. Volume is small (single digits), so the
migrator can be simple and is safe to run by hand if needed.

**First chunk:** migrator script + a fixture-box doctest that migrates one
fused commentary and asserts the resulting shape (`Foo.webpage.card` +
`Foo.attach/Foo.commentary.card`, no stray `readable.md`) and that the webpage
view renders the migrated remarks inline.

### Track 5 — (Decision) save-page convergence

**What.** Point `POST /api/clerk/save-page` at `.webpage.card` too, replacing
`.record.card` + sibling `.frozen`.

**Why this needs to change.** Today save-page and comment-on-page produce
*different* artifacts for the same underlying thing (a captured page). Unifying
means one renderer, one shape, and "comment later on a page I saved" becomes
natural. **But** it touches a separately-shipped, working flow and adds its own
migration (`.record.card` → `.webpage.card`), so it's called out as an explicit
in-or-out decision rather than assumed (see NOT in scope).

---

## Subplans

None required. Commentary placement is **resolved**: the commentary lives in
the webpage's attach scope (ownership is correct — it's invalidated/moved with
the page), and the webpage view surfaces it inline rather than relying on an
independent route. Independent attachment viewing is a separate, deferred UI
path (general "attachments are viewable" work), not a blocker for this plan.

---

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Webpage view doesn't load its attach-scoped commentary → annotations invisible despite being captured | No | No (new codepath) | **Silent** (page renders, remarks vanish) |
| Commentary's anchor refs to the owning page don't resolve from inside the attach scope | No | Partial (resolveRelativePath exists; owner-direction unverified) | Silent (chips don't jump) |
| Migrator runs twice / on an already-split card | No | manifest dedups by name | Clear (manifest skip) |
| Migrator hits a `.commentary.card` with `frozen` set but no `attach/page.frozen` on disk | No | No | Silent (webpage card with dangling frozen ref) |
| Large readable markdown inline in `.webpage.card` body | n/a (record cards already do this) | yes | Clear |
| Real box lacks `*.frozen filter=lfs` before receiving a snapshot | No | No | Silent (huge blob committed to git) |
| `save-page` (if converged) writes a duplicate `.webpage.card` for a URL already captured | No | No | Silent (two cards, same source) |

**Critical gap:** *webpage view must surface attach-scoped commentary.* This is
the new load-bearing codepath the split introduces: with the commentary living
inside `Host.attach/` (correctly owned, per the boxholder), the *only* way the
boxholder sees their remarks in the primary flow is the webpage view loading
and rendering them inline (Track 3). If that loader is missing or silently
returns nothing, capture succeeds but the annotations are invisible — the whole
point of the flow. This must have a doctest (a `.webpage.card` with an
attach-scoped commentary renders the remarks + a working anchor jump) before
the plan completes. It is *handling*, not just *verification* — the loader is
net-new code, not an existing behavior to confirm.

---

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field** — agent puts remarks in the `.webpage.card`
  body instead of a commentary card. **ADDRESSED** by schema instructions
  ("this is a snapshot; edit sparingly") + a knowledge audit, but the
  webpage body is freely editable, so it's a soft guard. Note as residual.
- **Stale ref** — commentary's `defaultRef` points at a webpage card that was
  moved/archived. **DEFERRED** — same reverse-discovery gap as
  `clerk-webpage-capture.md`; `bbx mv` updates refs for in-box moves, archive is
  the open edge. Cite Open questions.
- **Two agents touching the same bundle** — chat agent edits commentary while
  a reactor touches the webpage card. **ADDRESSED** — they're now *separate
  files*, which is strictly better than today's single fused card.
- **Hand-edit drift** — boxholder hand-writes a `.webpage.card` with a wrong
  `captured` format. **ADDRESSED** — schema validates the fields; `source`
  required.
- **Fabricated free-form value** — agent invents `source`/`captured` rather
  than using capture metadata. **ADDRESSED** — these are set by the clerk
  endpoint from real capture data, not authored.
- **Validation error UX** — webpage card missing required `source`. **ADDRESSED**
  — standard card-lint message; readable in agent context.
- **Partial migration / transition state** — during rollout, some
  `.commentary.card`s carry provenance (old fused shape), some don't (new
  remarks-only). **GAP→ADDRESSED-by-design**: the renderer must handle *both*
  a commentary with relocated provenance gone (new) and a legacy commentary
  still carrying `source`/`captured`/`frozen` (pre-migration) — keep reading
  those fields on `commentary` for one release window (back-compat, the
  `<destination>` precedent), migrate, then drop.

---

## NOT in scope

- **Multi-document commentary UI / reverse index.** `targets[]` already lets
  a commentary reference several docs; this plan keeps the door open but
  builds no new multi-target authoring UI or backlink index. Rationale: the
  user asked only that the model *not foreclose* it, and `targets[]` already
  satisfies that. Reverse discovery (a doc finding commentary that references
  it) is a known, separate gap.
- **save-page convergence (Track 5).** Carried as an explicit *decision*, not
  silently bundled. Default lean: **do it**, because divergent shapes for the
  same artifact is the smell this whole plan removes — but it adds a second
  migration and touches a shipped flow, so it's a conscious in/out call for
  the boxholder, not an assumption.
- **Enforced immutability of `.webpage.card`.** The "snapshot, edit sparingly"
  semantic is a convention + instruction, not a write-lock. Rationale: no
  existing card type is write-locked; adding the first enforcement mechanism
  is its own feature.
- **Commentary on non-document targets** (a card type other than
  webpage/doc). The machinery is generic, but this plan only *wires up* webpage
  and doc as targets; broader targets are latent capacity, not delivered UI.

---

## Open design questions

1. **How does a commentary anchor name its owning page? — RESOLVED: ref-free
   default.** A `{% source %}` anchor with *no* `ref`/`href` targets the
   **containing document** (the webpage card that owns the attach scope). `ref`
   is still available for the other situations — cross-doc anchors via
   `targets[]`. The webpage view loads commentary from its own attach scope, so
   the primary target is implicit; the common case carries no ref at all. This
   means `defaultRef`/`defaultHref` are no longer required on a commentary
   that's attach-scoped to its target (the container *is* the default), though
   they remain valid for free-floating commentary.

2. **Save-page convergence (Track 5): RESOLVED — in.** `save-page` writes a
   `.webpage.card` (replacing `.record.card` + sibling `.frozen`), with its own
   `.record.card` → `.webpage.card` migration.

3. **Independent commentary/attachment viewing** — deferred to the general
   "attachments are viewable" UI path (a distinct browse route). Not designed
   here; the webpage view is the only surface the capture→annotate flow needs.
   Noted so it's an explicit hand-off, not an omission.

---

## Knowledge audits

This introduces an agent-facing concept (`.webpage.card` as the captured-page
type; commentary as a separate annotation that references it). The three
existing commentary audits (`knowledge-audits.yaml:2560-2594`) **must be
updated** — `commentary-capture-files` currently expects *"A .commentary.card
plus its attachments — readable markdown (attach/readable.md) and the frozen
page snapshot"*, which the split makes wrong. New/updated audits:

- **Update `commentary-capture-files`** → expect a `.webpage.card` (readable
  body + `attach/page.frozen`) *and* a separate commentary card referencing
  it.
- **New `webpage-vs-commentary`** (`knows_directly`) — "What's the difference
  between a `.webpage.card` and a `.commentary.card`?" Watch for: webpage =
  the captured snapshot; commentary = the remarks, references the webpage via
  `defaultRef`.
- Keep `commentary-destination` and `commentary-anchors-author` (still valid).

Audits land **run**: `pnpm knowledge-audit run --box test1 --filter
commentary` (+ the new id) before the plan completes, status recorded in the
yaml.

---

## Implementation order

1. **Track 1** — `webpage` schema + registry + round-trip doctest. (No deps.)
2. **Track 3** — `WebpageView` + the attach-scoped commentary inline loader
   (renders a hand-made `.webpage.card` + `attach/*.commentary.card`,
   independent of the endpoint). Settles Open question 1's owner-ref direction
   in passing — the loader is what exercises it.
3. **Track 2** — endpoint writes `.webpage.card` + `attach/page.frozen` +
   empty commentary; companion points at the webpage card.
4. **Track 4** — migrator + fixture doctest; run against a test1 clone.
5. **Track 5** — *if* in-scope per Open question 2: converge save-page; its
   own `.record.card` → `.webpage.card` migration.
6. Update knowledge audits; run them.

Dependencies: 3→1, 2→(1,3), 4→(1,2,3), 5→(1,2,3). The plan ships as one unit
after all in-scope tracks complete; chunks commit independently within the
worktree.

---

## Rollout shape

- **Test posture.** Dogfooding precedes broad tests; one doctest per new
  codepath at the shape boundaries (schema round-trip, endpoint output,
  migrator). Migration gets a real fixture-box test because it mutates
  existing data — that's the regression-risk piece.
- **Knowledge audits** — updated `commentary-capture-files` + new
  `webpage-vs-commentary` land *with* the plan, run green.
- **Migration approach.** Forward migrator (`scripts/migrate/webpage-card.ts`)
  for existing captured commentaries; small volume, idempotent via the
  `migrations.jsonl` manifest. Back-compat: the `commentary` schema keeps
  reading `source`/`captured`/`frozen` for one release window so a
  pre-migration box renders, then those fields are removed from `commentary`
  (they live on `webpage` only). Same accept-old-shape-then-migrate pattern as
  the `<destination>` transition.
- **LFS.** Add `*.frozen filter=lfs` to real boxes' `.gitattributes` before
  they receive a snapshot (test1 already has it) — the silent-huge-blob
  failure mode above.
