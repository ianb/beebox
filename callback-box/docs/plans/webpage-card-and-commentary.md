# `.webpage.card` + commentary-as-attachment

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
[`web-page-commentary.md`](./web-page-commentary.md) (which is otherwise
implemented and verified live as of 2026-06-14); the landmark
`<destination>` work, the extension capture pipeline, and the chat companion
deep-link from that plan are unchanged and reused here.

---

## Stated preferences this plan trades against

- `callback-box/CLAUDE.md:43` — *"Naming: `Name.type.card` — the type
  determines which schema validates it."* The new type must follow the
  `.webpage.card` convention and register a schema, not special-case the
  parser.
- `callback-box/CLAUDE.md` — *"don't add features beyond what the task
  requires."* A new card type is a real cost (schema, renderer, migration,
  agent vocabulary). It earns its place only because the captured page has
  distinct provenance/immutability/rendering that `doc`+frontmatter would
  fake; this plan must justify the type, not assume it.
- `callback-box/CODE-STYLE.md` — no optional chaining, no default params,
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
  frozen snapshot. Settled in `web-page-commentary.md`; reused verbatim.
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

**Direction.** Files written:
`<destDir>/<name>.webpage.card` + `<destDir>/<name>.attach/page.frozen`, plus
the commentary card (placement per Track 3 / Open questions). Response `open`
still opens chat with the **commentary** as `companion=view:…` (the surface
the boxholder builds up), context dir = the destination. Request schema is
unchanged (`url`, `title`, `readableMarkdown`, `frozenHtml?`,
`destinationDir?`).

**First chunk:** endpoint writes the `.webpage.card` only (no commentary yet)
+ route doctest; commentary wiring follows once Track 3 settles placement.

### Track 3 — Renderer split

**What.** Extract a `WebpageView` that renders a `.webpage.card` (readable
body + "Original page" link + "Frozen snapshot ↗" link + local-zone
`captured` date). `CommentaryView` renders only the remarks and pulls in its
target(s) via `defaultRef`/`targets[]` — reusing `WebpageView` (through the
existing `InboxTargetPane` path) to render the referenced page as the source
pane.

**Why.** `WebpageView` is then reusable for a plain saved page with no
commentary (Track 5), and the jump-to-quote (`onJumpToQuote`,
`CommentaryView.tsx:266-292`) anchors against the rendered webpage body
exactly as it anchors against `readable.md` today.

**First chunk:** lift the saved-page block (`CommentaryView.tsx:319-338`) into
`WebpageView.tsx` keyed on card type `webpage`; register it in the
file/card-renderer registry; CommentaryView references it.

### Track 4 — Migration

**What.** `scripts/migrate/webpage-card.ts` + a `MIGRATIONS` entry: for each
existing `*.commentary.card` carrying `source`/`captured`/`frozen`
provenance, create a sibling `.webpage.card` (body from its
`attach/readable.md`, move `attach/page.frozen` under the new card's attach
scope), and rewrite the commentary's `defaultRef` to point at the new webpage
card. Remarks-only commentaries (no provenance) are left untouched.

**Why.** Dogfooding produced a handful of real `.commentary.card`s on the
hosted box; they must not break. Volume is small (single digits), so the
migrator can be simple and is safe to also run by hand if needed.

**First chunk:** migrator script + a fixture-box doctest that migrates one
captured commentary and asserts the resulting two-card shape + working
`defaultRef`.

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

None required. The placement question (Track 3 / Open questions) is a
*decision*, not a design problem needing its own research phase — it's
settled by verifying one existing behavior (are attach-scoped cards
independently addressable?). If that verification reveals attach-scoped cards
need new addressing machinery, *that* would warrant a subplan; until verified,
it's an open question with a clear lean.

---

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Attach-scoped commentary isn't independently addressable → chat `companion=view:<commentary>` 404s | No | No | **Silent** (chat opens with broken companion) |
| `defaultRef` from commentary → `.webpage.card` is relative *out of* attach scope; ref resolution may not support outward/owner refs | No | Partial (resolveRelativePath exists; direction unverified) | Silent (empty source pane) |
| Migrator runs twice / on an already-split card | No | manifest dedups by name | Clear (manifest skip) |
| Migrator hits a `.commentary.card` with `frozen` set but no `attach/page.frozen` on disk | No | No | Silent (webpage card with dangling frozen ref) |
| Large readable markdown inline in `.webpage.card` body | n/a (record cards already do this) | yes | Clear |
| Real box lacks `*.frozen filter=lfs` before receiving a snapshot | No | No | Silent (huge blob committed to git) |
| `save-page` (if converged) writes a duplicate `.webpage.card` for a URL already captured | No | No | Silent (two cards, same source) |

**Critical gap:** *attach-scoped commentary addressability* — `walk.ts:35`
says attach-scope cards "belong to the owning card," which strongly implies
they do **not** get an independent view route. If so, burying the commentary
in `Host.attach/` silently breaks the chat companion deep-link — the entire
point of the flow. This gates Track 3 and must be verified before any
commentary is written into an attach scope. Lean: keep commentary a
first-class, addressable sibling card (the head-card *peer* model from
`ideas.md:750`, not the private-bag model), expressing "belongs to the page"
via `defaultRef` rather than physical burial — unless verification shows
attach-scoped cards are fully addressable.

---

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field** — agent puts remarks in the `.webpage.card`
  body instead of a commentary card. **ADDRESSED** by schema instructions
  ("this is a snapshot; edit sparingly") + a knowledge audit, but the
  webpage body is freely editable, so it's a soft guard. Note as residual.
- **Stale ref** — commentary's `defaultRef` points at a webpage card that was
  moved/archived. **DEFERRED** — same reverse-discovery gap as
  `web-page-commentary.md`; `cb mv` updates refs for in-box moves, archive is
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

1. **Where does a contained commentary physically live?** (Load-bearing —
   gates Tracks 2-4.) Three candidates:
   - **(a) Inside `Host.attach/`** — literal reading of "inside the
     attachments." *Risk:* attach-scope cards may not be independently
     addressable (`walk.ts:35`), breaking the chat companion + outward
     `defaultRef`. Must verify before committing.
   - **(b) Peer in a `Host/` head-card directory** — the `ideas.md:750`
     "peers, not private bag" model. Addressable, clean, but introduces the
     head-card pairing the ideas doc itself flags as unbuilt
     (`ideas.md:753-755`).
   - **(c) First-class sibling card** referencing the webpage via
     `defaultRef` — simplest, fully addressable, "containment" expressed
     semantically rather than physically.
   **Lean: (c) for now**, treating "inside the attachments" as *conceptual
   ownership via `defaultRef`*, because it preserves addressability (the
   companion deep-link and multi-doc refs both require it) with zero new
   machinery. Revisit toward (a)/(b) if/when the head-card idea lands and
   makes attach-scoped cards first-class. **Verification task that decides
   this:** confirm whether a `.card` inside `.attach/` gets a `view:` route
   and resolves an outward `defaultRef`.

2. **Does `resolveRelativePath` resolve a ref pointing *out* of an attach
   scope to its owner?** Only matters under placement (a). Verify or drop (a).

3. **Save-page convergence (Track 5): in or out?** Lean *in*, but the
   boxholder decides given the extra migration cost.

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
2. **Verification spike** — resolve Open question 1 (attach-scoped card
   addressability). Decides Track 3 placement. *Must precede Tracks 2-4.*
3. **Track 3** — `WebpageView` renderer extraction (independent of endpoint;
   can render a hand-made `.webpage.card`).
4. **Track 2** — endpoint writes webpage card, then (once placement settled)
   the commentary satellite.
5. **Track 4** — migrator + fixture doctest; run against a test1 clone.
6. **Track 5** — *if* in-scope per Open question 3: converge save-page; its
   own `.record.card` → `.webpage.card` migration.
7. Update knowledge audits; run them.

Dependencies: 2→1, 3→(spike), 4→(1,2,3), 5→(1,2,3). The plan ships as one
unit after all in-scope tracks complete; chunks commit independently within
the worktree.

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
