---
title: "Named Places (`place` cards + `bbx location mark`)"
status: implemented
workstream: unknown
issues: []
---
# Named Places (`place` cards + `bbx location mark`)

> **Status: implemented (2026-06-29).** Frozen design record. Code:
> `src/schemas/place.tsx` (+ `registry.ts`, `templates-builtins.ts`, `BOX_DIRS`),
> `src/core/geo.ts`, `src/core/place-mark.ts`, `src/core/place-cards.ts`,
> `src/cli/commands/location.ts` (`mark` + place resolution in `get`), and the
> "Named places" section of `src/core/agent-guide/location.ts`. Codex-reviewed at
> plan and diff stages. The `aliases`-standardization sweep (rename
> `person.called → aliases` + a shared named-entity fragment + a card migration)
> was done separately afterward — see `src/schemas/named-entity-fields.ts` and
> `scripts/migrate/person-aliases.ts`.

Let the boxholder define named places ("Home", "Office") as cards with a
center coordinate and a radius, then have `bbx location get` report *which named
place* the current live location falls in. This is the semantic layer over the
raw geolocation fix shipped in `user-location`: instead of asking a third-party
geocoder "what place is this?", the box matches the live fix against the
boxholder's own labelled places. Builds on the `.beebox/location.json`
live fix and the `bbx location get` command from `docs/implemented-plans/user-location.md`.

## Settled decisions (from design discussion)

Direction, not open questions:

1. **Card type is `place`** — `places/<Name>.place.card`, modeled on `person`.
   "Place" distinguishes the named entity from the raw "location" fix/command.
2. **Coordinates are committed** to box git (like `person.contact`, which holds
   addresses). A named place is deliberate reference data, categorically
   different from the passive live fix (which stays gitignored). This inverts
   `user-location`'s "never commit coords" stance — for a defensible reason.
3. **Card-first, mark-second.** The agent authors the card (name, description,
   aliases) first; `bbx location mark <path-to-card>` then stamps the **current
   live fix's** coordinates into that existing card. The command owns
   coordinate-writing; the agent owns the prose/identity.
4. **Resolve folds into `bbx location get`** — the matched place name is
   prepended to the existing output; raw coords still shown.

## Stated preferences this plan trades against

- `beebox/CLAUDE.md` (Cards) — *"Schemas live in `src/schemas/`. Cards use
  `cardSchema(type, { fields, instructions? })` ... `src/schemas/registry.ts`
  lists them in `cardSchemas[]`."* New schema follows this registration path.
- `beebox/CLAUDE.md` (Cards) — *"Mutations to frontmatter cards are
  parse-mutate-reserialize via `yaml`'s `parse`/`stringify`."* `bbx location mark`
  follows this, preserving the body verbatim.
- `beebox/CLAUDE.md` (Behavioral Notes) — *"Keep source and docs generic —
  never hardcode personal names ... Refer to 'the user' or 'the boxholder'."*
  Schema `instructions` and guide text stay generic; "Home"/"Office" appear only
  as illustrative examples.
- `beebox/CLAUDE.md` (Cards) — the don't-build-beyond-the-task rule. v1 is
  define + match; geofence events, statistical radius fitting, and a places UI
  are out of scope.
- `beebox/code-style.md` — no default parameters, max 2 positional params,
  no `any`, no bare `catch {}`, custom error classes, files < 300 lines.
- Precedent: `src/schemas/person.tsx` — the closest existing schema (a
  reference-entity card with structured frontmatter + freeform body +
  `instructions` + a `create*Template` helper). This plan mirrors it.
- Privacy carried over from `user-location`: coordinates are sensitive; keep raw
  coords out of logs even though place coords now (intentionally) enter git.

## What already exists

- **Live location fix + reader.** `src/core/location-store.ts`
  (`loadLocation(boxRoot): Promise<StoredLocation | null>`) and
  `src/core/location-format.ts` (`locationAge`, `formatLocationLine`). **Reuse** —
  `bbx location mark` reads the current fix via `loadLocation`; `bbx location get`
  already calls it and formats the line this plan extends.
- **`bbx location get` command.** `src/cli/commands/location.ts` — the `get`
  subcommand loads the fix and prints `formatLocationLine`/JSON. **Reuse/extend** —
  add place resolution here and a new `mark` subcommand to the same `Command`.
- **Reference-entity schema precedent.** `src/schemas/person.tsx:18`
  (`cardSchema("person", { fields, instructions })`, `people/First_Last.person.card`,
  `createPersonTemplate`). **Reuse the pattern** — `place.tsx` mirrors its shape,
  directory convention, and template helper. Person commits `contact` (addresses)
  to git, the precedent for committing place coords.
- **Schema registration.** `src/schemas/registry.ts:60` (`cardSchemas: CardSchema[]`),
  `PersonSchema` imported at `:40` and listed at `:87`. **Reuse** — import + add
  `PlaceSchema`.
- **Card mutate path.** `src/cards/frontmatter.ts:41` `splitCardContent` (splits
  frontmatter from body) + `yaml` `parseDocument` (a node tree). **Reuse** —
  `mark` splits the card, mutates `lat`/`lng`/`radius` on the frontmatter
  Document node, and recombines with the original body byte-for-byte. Editing the
  node tree (not a plain `parse`→`stringify` round-trip) leaves untouched keys —
  including their comments and original scalar spelling — exactly as written
  (the CLAUDE.md parse-mutate-reserialize contract, faithful form). **Not**
  `parseCardText`/`serializeCardText`
  (`src/core/card-io.ts:108`/`:247`): that path validates through the schema and
  re-emits only the parsed fields, **stripping** any unknown/drifted frontmatter
  key (lenient parse, `src/cards/schema.ts:206`) — wrong for a key-preserving edit.
- **Card-by-glob scan.** `src/core/triage-instructions.ts:78`
  (`glob("**/*.landmark.card", ...)`). **Reuse the pattern** — a `loadPlaces`
  helper globs `**/*.place.card`.
- **Box path resolution.** `src/cli/lib/paths.ts` `requireBoxRoot`. **Reuse** in
  the `mark` subcommand (resolve a card path relative to the box root).
- **Agent guide.** `src/core/agent-guide/location.ts` (the "User location"
  section). **Reuse/extend** — add the places workflow here.
- **No existing geo math.** A grep for `haversine|geofence|distanceMeters|toRadians`
  over `src/` returns nothing — the distance/match utility is net-new.

## Prior art (external)

- **Distance for point-in-radius: haversine is the standard; equirectangular is
  marginally faster at short range.** For sub-kilometer geofencing the
  equirectangular approximation is both faster and adequately accurate (error
  well under 0.5% within a few hundred miles), but haversine is the canonical,
  edge-case-free choice. Sources:
  https://www.movable-type.co.uk/scripts/latlong.html and
  https://blog.mapbox.com/fast-geodesic-approximations-with-cheap-ruler-106f229ad016 .
  **Decision:** use **haversine** — there are only a handful of place cards, so
  the perf gap is irrelevant, and haversine has no latitude/bearing caveats. ~15
  lines, no dependency.
- **No prior art inside the project** — geo matching is greenfield (grep above).
- **Reverse-geocoding deliberately not used** — named places *are* the
  human-readable layer, so no third-party geocoder enters (cost + sends coords
  out), consistent with `user-location`'s deferral.

## Tracks / scope

Ordered by dependency: schema → geo util → mark → get-resolve → guide.

### Track 1 — `place` card schema

- **What:** A new card type for named places.
- **Why this needs to change:** Nothing models a named place today; the match
  and mark surfaces both need a defined on-disk shape.
- **Direction:** `src/schemas/place.tsx`, mirroring `person.tsx`; registered in
  `registry.ts` (import + `cardSchemas[]`). Fields:
  ```typescript
  cardSchema("place", {
    fields: {
      status: PlaceStatus.default("active"),     // active | inactive | archived
      name: z.string(),                           // required, e.g. "Home"
      aliases: z.array(z.string()).optional(),   // other names for the place
      address: z.string().optional(),            // freeform human address (street, city)
      lat: z.number().min(-90).max(90).optional(),
      lng: z.number().min(-180).max(180).optional(),
      radius: z.number().positive().optional(),  // meters
      body: body(z.string()),                    // markdown: what the place is + why it matters in the box
    },
    instructions: /* how to author + mark; generic, see below */,
  })
  ```
  - **`address`** is an optional, human-readable address (street/city) — distinct
    from `lat`/`lng`, which the agent does not hand-type but `mark` stamps from
    the device fix. The address is what a person reads; the coordinates are what
    matching uses. Either can exist without the other (a place can have an address
    but no fix yet, or a fix but no written address).
  - **`body`** is the place's description: what it is and **why it's important in
    the box** (e.g. "Home — where the boxholder usually works; default for
    after-hours context"). This is the freeform notes/context field, mirroring
    `person`'s body.
  - **`aliases`** is the **new standard name** for an entity's other-names field.
    The closest precedent, `person.tsx:22`, currently calls this `called`;
    reconciling that (a rename + card migration) is a separate cross-cutting plan
    (see NOT in scope). `place` is net-new, so it adopts `aliases` from day one —
    deliberately the first card on the standard name, not accidental drift.
  - **Coordinates are optional** so the agent can author the card (name, address,
    description) before any fix is stamped — the card-first workflow. **A coordless
    card is valid** (a draft place) and never matches; matching requires *both*
    `lat` and `lng` (a half-set card is treated as coordless and skipped). `radius`
    is optional; `mark` always writes it, and matching falls back to a default
    when a hand-edited card omits it.
  - **Both-or-neither is a `validate` hook, not a load-time reject.** `cardSchema`
    has no object-level `.refine` slot; cross-field rules go through the
    `CardSchemaConfig.validate?` callback (`src/cards/schema.ts:124` — "cross-field
    rules ... Returns LintIssue[]"), which fires at **lint** time (`bbx validate` /
    the PostToolUse hook), not at `parseCardText` load. So a `lat`-without-`lng`
    card still *loads*; it surfaces as a lint **warning** and is simply not matched.
    `place.tsx` supplies a `validate` that flags a half-set coordinate.
- **Box-layout + create surfaces (so `bbx create place …` works and `places/` is
  known):** register a `place` builtin template in
  `src/schemas/templates-builtins.ts` (mirroring the `person` registration at
  `:230` — `createPersonTemplate` only works with `bbx create` because of that
  entry), and add `places` to `BOX_DIRS` (`src/cli/lib/paths.ts:54` has `people`
  but no `places`), keeping `docs/box-layout.md` and the box-shape agent guide
  (`src/core/agent-guide/box-shape.ts`) in sync (the docs require it). Without
  these, the agent would have to hand-author the file + directory.
- **Vocabulary lock-ins:** type `place`; directory `places/`; filename
  `places/<Name>.place.card`; fields `name`, `aliases`, `address`, `lat`, `lng`,
  `radius` (meters), `status`; body = description of the place + why it matters.
  `aliases` (array of strings) is the standard other-names field name going
  forward. Committed across the schema, the mark command, the match loader, and
  the guide.
- **First implementation chunk:** `place.tsx` (fields + `validate` hook) + registry
  entry + `BOX_DIRS`/box-layout/box-shape update + a `place` builtin template +
  `createPlaceTemplate({ name, aliases?, address? })` helper + a schema doctest
  (coordless draft with name + address + body validates clean; a full card
  validates; a `lat`-without-`lng` card loads but the `validate` hook returns a
  lint issue; out-of-range lat fails the per-field Zod check).

### Track 2 — Geo match utility

- **What:** Distance + nearest-place matching, pure.
- **Why this needs to change:** `bbx location get` must turn a fix + a set of
  places into "which place am I in," and `mark`'s radius-expansion needs the same
  distance function.
- **Direction:** `src/core/geo.ts`:
  ```typescript
  export interface LatLng { lat: number; lng: number }
  export function haversineMeters(a: LatLng, b: LatLng): number;

  export interface PlaceCircle { name: string; lat: number; lng: number; radius: number }
  // The nearest place whose center is within its radius of the fix, or null.
  export function matchPlace(fix: LatLng, places: PlaceCircle[]): PlaceCircle | null;
  ```
  `matchPlace`: compute haversine to each place center; keep those with
  `distance <= radius`; return the one with the smallest distance (deterministic
  on overlap), or `null`. **Strict radius** — the fix's GPS `accuracy` does *not*
  inflate the match (a low-confidence 5 km fix must not claim "at Home"); accuracy
  is reported separately in the line. Pure → directly doctestable.
- **First implementation chunk:** `geo.ts` + a pure doctest (haversine against a
  known city-pair distance within tolerance; match inside/outside radius;
  nearest-wins on two overlapping circles; empty list → null).

### Track 3 — `bbx location mark <card-path>`

- **What:** Stamp the current live fix's coordinates into an existing place card.
- **Why this needs to change:** This is the bridge from the gitignored live fix
  to a committed place card — the only way coordinates legitimately enter a card.
- **Direction:** New `mark` subcommand on the `location` Command
  (`src/cli/commands/location.ts`):
  - Argument: a path to a `*.place.card`. **Must resolve inside the box** —
    `toRelativePath(boxRoot, abs)` (`src/cli/lib/paths.ts:147`, returns null when
    outside) gates it; a path outside the box is rejected (the privacy story is
    "coords enter *box* git", never an arbitrary file). Errors clearly if missing,
    not a `.place.card`, outside the box, or not parseable as a place.
  - Loads the current fix via `loadLocation`. **No fix → error**: "No current
    location — share location from the web UI first." **A stale fix is used, not
    refused** — `mark` always proceeds and reports the fix's age (and a `[stale]`
    marker past `LOCATION_STALE_MS`, 1h) in its confirmation, so the agent can
    judge whether the fix is current enough for this place. (Reuses
    `locationAge`/`describeElapsed`.)
  - **Mutate the frontmatter Document node, not the schema serializer.**
    `parseCardText` strips unknown frontmatter keys (lenient, `src/cards/schema.ts:206`)
    and `serializeCardText` re-emits only the parsed fields (`card-io.ts:255`) — so a
    parse→serialize round-trip would silently drop drifted/unknown frontmatter.
    Instead, `splitCardContent` (`src/cards/frontmatter.ts:41`) → `yaml.parseDocument`
    the frontmatter → `doc.set` `lat`/`lng`/`radius` → `String(doc)` → recombine
    with the original body. Editing the node tree preserves every untouched key,
    its comments, and its original scalar spelling verbatim (the CLAUDE.md
    parse-mutate-reserialize contract).
  - Radius logic:
    - **No existing coords/radius:** set center = fix, `radius = max(round(fix.accuracy), MIN_RADIUS)`
      (MIN_RADIUS ≈ 50 m — a GPS fix is never a point).
    - **Existing coords, fix inside the radius:** already covered — no change to
      center/radius (optionally refresh nothing); report "already covers this fix."
    - **Existing coords, fix OUTSIDE the radius:** **do not silently expand**
      (a stale or wrong fix would balloon the place — e.g. "Home" to city scale —
      and then `get` would confidently match it). Default: leave the card
      unchanged and report the distance ("fix is 4.2 km from Home's center, outside
      its 120 m radius — not updated; re-run with `--expand` to grow the radius to
      include it"). `mark --expand` performs the monotonic expand-to-include
      (`radius = haversineMeters(center, fix)`, center fixed). Expansion is opt-in.
  - Does **not** auto-commit — the agent commits the card via the normal box flow
    (the commit is where coords intentionally enter git). Prints a confirmation
    that includes the fix's age so staleness is visible:
    `Marked Home at 45.5231,-122.6765 (radius 120m, from a fix captured 4 minutes ago).`
    (with ` [stale]` appended when the fix is older than `LOCATION_STALE_MS`).
  - **Never logs coords** beyond this intended confirmation line.
- **First implementation chunk:** the `mark` subcommand + a CLI/filesystem-tier
  doctest (`makeTmpBox`): author a coordless place card **with an extra/non-schema
  frontmatter key and a body**, drop a fresh `location.json`, run mark → card
  gains lat/lng/radius while the body **and the extra key** survive verbatim; a
  second mark with an inside fix is a no-op; a mark with an **outside** fix leaves
  the card unchanged and reports the distance; `mark --expand` with that outside
  fix grows the radius; mark with no fix errors; mark on an out-of-box path errors;
  mark with a stale fix proceeds and its confirmation reports the age.

### Track 4 — `bbx location get` place resolution

- **What:** Name the matched place in `bbx location get` output.
- **Why this needs to change:** The whole point — turn raw coords into "you're at
  Home."
- **Direction:**
  - New `src/core/place-cards.ts` `loadPlaces(boxRoot): Promise<PlaceCircle[]>` —
    globs `**/*.place.card` **with the same ignores the precedent uses**
    (`triage-instructions.ts:78` ignores `node_modules`, `.git`, `tmp`,
    `.beebox`), parses each, and returns those with **both** `lat` and `lng`
    present (skips coordless/half-set drafts and `status: archived`/`inactive`),
    defaulting a missing `radius` to `DEFAULT_RADIUS`. Parse failures on a single
    card are logged and skipped (one bad card never breaks the read).
  - In `location.ts` `get`: after loading the fix, call `loadPlaces` +
    `matchPlace`. If matched, prepend the name to the human line:
    `Home — 45.5231,-122.6765 (±18m, captured 4 minutes ago, web)`. For `--json`,
    add `place: "Home" | null`. No match → today's output unchanged.
  - `formatLocationLine` gains an optional leading place name (kept pure/
    testable).
- **First implementation chunk:** `place-cards.ts` + the `get` extension + a
  doctest covering: fix inside a place → name prepended + `place` in JSON; fix
  outside all places → unchanged; coordless/archived places skipped.

### Track 5 — Agent guide + knowledge audit

- **What:** Teach the agent the place-card workflow.
- **Why this needs to change:** The agent authors place cards and runs `mark`;
  without guidance it won't know the card-first/mark-second flow.
- **Direction:** Extend `src/core/agent-guide/location.ts` (the "User location"
  section) with a short "Named places" paragraph: places live at
  `places/<Name>.place.card`; **author the card describing the place first, then
  run `bbx location mark <path>` to stamp the current location into it**; `bbx
  location get` names the place when the boxholder is inside one. The detailed
  field reference lives in the schema `instructions` (Track 1), per the
  doc-altitude convention. Plus one `knows_directly` knowledge audit: "how do you
  record where 'Home' is" → author a place card, then `bbx location mark`.
- **First implementation chunk:** the guide paragraph + the audit entry, run
  against a test box.

## Subplans

None. Each track's shape is fully specified; no sub-question needs its own design
step. The radius-refinement algorithm is settled inline (no silent expand;
opt-in `--expand`, keep center).

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| `mark` on a non-existent / non-`.place.card` path | Yes (T3) | Yes — validate path + type, error | Clear (error) |
| `mark` with no current fix | Yes (T3) | Yes — error "share location first" | Clear (error) |
| `mark` with a stale fix (>1h) | Yes (T3) | Yes — proceeds; reports fix age + `[stale]` so the agent judges | Clear (visible age) |
| `mark` drops the body / other frontmatter fields | Yes (T3 asserts body + extra key survive) | Yes — raw-YAML mutate (split + parse/stringify), not the schema serializer | Clear |
| stale/out-of-place `mark` balloons a place's radius | Yes (T3 outside-fix + `--expand`) | Yes — no silent expand; outside fix leaves card unchanged, growth is opt-in `--expand` | Clear (reports distance) |
| place card with `lat` but no `lng` (hand-edit) | Yes (T1 `validate` hook) | Yes — `validate` lint warning; matcher requires both coords → skipped | Clear (lint warning; not matched) |
| place card with coords but no `radius` (hand-edit) | Yes (T4) | Yes — matching falls back to DEFAULT_RADIUS | Clear (matches with default) |
| `mark` targets a `.place.card` outside the box | Yes (T3) | Yes — `toRelativePath` gate rejects | Clear (error) |
| one `*.place.card` fails to parse during `get` | Yes (T4) | Yes — log + skip that card, others still match | Clear (warns, degrades) |
| two places overlap the fix | Yes (T2) | Yes — nearest center wins (deterministic) | Clear |
| fix has huge accuracy (low confidence) | Yes (T2 strict-radius) | Yes — strict radius; no false "at X" | Clear (reports coords, no place) |
| coords now enter git via a committed place card | n/a (intended) | Intended per decision #2 | Clear (deliberate) |
| raw coords leak into logs | No automated test | Convention: mark/get never log coords beyond the confirmation line | Risk — see below |

> **Critical gap:** none. The closest is the same "coords could leak into logs"
> convention risk inherited from `user-location` — convention-enforced over a
> small surface (`location.ts`, `geo.ts`, `place-cards.ts`), reviewed at
> implementation. Note that place coords are *already* committed to git by
> decision #2, so a log leak is a strictly smaller marginal exposure than in v1.

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field** — low risk: `place` fields are structured. The one
  confusable is hand-writing `lat`/`lng` instead of running `mark`; the guide +
  schema instructions steer to `mark`, and a hand-set coordinate still matches
  (honest as long as the value is real). **ADDRESSED** (guide steers; per-field
  Zod validates ranges; the `validate` hook lint-warns on a half-set coordinate).
- **Stale ref** — `mark <path>` to a card that was moved/archived/deleted between
  authoring and marking → path-not-found error (T3). **ADDRESSED.**
- **Two agents touching the same card** — two concurrent `mark`s on one card →
  last-write-wins (a single coordinate set; harmless, self-heals on next mark).
  No lock needed (contrast `src/lib/file-lock.ts`, for richer card mutations).
  **ADDRESSED** (accept last-write-wins; cite this line).
- **Hand-edit drift** — boxholder hand-edits a place card: per-field Zod validates
  lat/lng ranges; the `validate` hook lint-warns on a half-set coordinate; the
  matcher requires both coords (half-set skipped); missing radius falls back to
  default. **ADDRESSED.**
- **Fabricated free-form value** — the agent could invent coordinates by
  hand-writing `lat`/`lng` rather than marking from a real fix. The design makes
  honesty the easy path: `mark` stamps the actual device fix, and `address` gives
  the agent a proper home for human-supplied location text (a street/city the
  boxholder states) so it never needs to fake coordinates to record "where" a
  place is. A fabricated `lat`/`lng` is possible but off the documented path.
  **ADDRESSED** (design bias, not enforcement) — and called out as a residual.
- **Validation error UX** — the `validate` hook's lint message ("lat and lng must
  be set together") and the `mark` errors (no fix / outside-radius / out-of-box
  path) read in the agent's context. **ADDRESSED.**
- **Partial migration / transition state** — N/A. Net-new schema, additive; no
  existing card shape changes, no migration. Existing boxes simply have zero
  place cards until the agent makes one.

## NOT in scope

- **Reverse-geocoding to a city/address.** Named places are the human-readable
  layer; a geocoder stays out (cost + sends coords to a third party).
- **Geofence events / arrival triggers** ("notify me when I get home"). That's an
  automation/connector feature with its own design; this plan only answers "where
  am I now" on demand.
- **Statistical radius fitting / centroid averaging.** `mark --expand` uses
  expand-to-include with a fixed center. Fitting a radius from many samples (or
  recentering) is a refinement deferred until the simple version proves
  insufficient.
- **Auto-recenter on `mark`.** The first mark sets the center; `--expand` only
  grows the radius, never moves the center. Recentering is deferred (see above).
- **A frontend UI for places.** Places are agent-authored via chat; no dedicated
  page/CRUD UI in v1.
- **Per-user places / multi-user boxes.** One set of places per box, like the
  single live fix.
- **`mark --create`** (auto-authoring the card). The settled flow is card-first;
  `mark` requires an existing card. A create flag is a possible later convenience.
- **Cross-cutting `aliases` standardization.** `place` adopts `aliases` here, but
  renaming `person.tsx`'s `called` field to `aliases` (with a `called:`→`aliases:`
  migration over existing `*.person.card` files) is a separate small plan — a
  vocabulary sweep with a card migration, kept out of the places feature. That
  plan should also define a shared named-entity field fragment (`name` +
  `aliases`) for `person` + `place` to share. **Explicitly excluded from the
  sweep** (different concepts, not aliases): `personality.tsx`'s nested
  `BoxholderEntry.called` (`schemas/personality.tsx:44` — the boxholder's
  nickname, a single string) and the `{% key-person called="…" %}` tag attribute
  (`markdoc-emit-tags.ts:118` — a per-reference *display name*, not an entity's
  alias set; keeping it `called` disambiguates the two).

## Open design questions

- **Default radius** — lean `max(round(accuracy), 50m)` on first mark. A tunable
  constant, not a structural choice.
- **Accuracy margin in matching** — lean **strict** (`distance <= radius`, no
  accuracy inflation). Revisit only if real fixes routinely sit just outside a
  place's radius.

## Knowledge audits

Two agent-facing concepts: (a) place cards exist and are authored card-first,
(b) `bbx location mark <path>` stamps the current location into a place card. Per
the default (each new agent-facing concept gets a `knows_directly` audit), add to
`src/dev/knowledge-audits.yaml`:

- A `knows_directly` audit: "The boxholder wants the box to know where 'Home' is.
  How do you record it?" → expects: author a `places/<Name>.place.card` describing
  the place, then run `bbx location mark <path>` to stamp the current location
  (not: hand-write coordinates, not: a generic file).

Land it **run**: `pnpm knowledge-audit run --box <absolute-path-to-test-box>
--filter <id>` (per memory, `--box` is a path — absolute or omit), status
recorded in `knowledge-audits.yaml` before the plan completes.

## Implementation order

1. **Track 1 — `place` schema** (+ registry + `validate` hook + `place` builtin
   template + `BOX_DIRS`/box-layout/box-shape sync + schema doctest). No
   dependencies; defines the shape everything consumes.
2. **Track 2 — `geo.ts`** (+ pure doctest). No dependencies; the match math.
3. **Track 3 — `bbx location mark`** (+ fs doctest). Depends on T1 (card shape)
   and the existing `loadLocation`; uses `haversineMeters` from T2 for the
   `--expand` radius growth and the outside-radius distance report.
4. **Track 4 — `bbx location get` resolution** (+ doctest). Depends on T1 (parse
   places) and T2 (match). Now the loop is exercisable: author → mark → get names
   the place.
5. **Track 5 — guide + knowledge audit.** Depends on T3/T4 existing and behaving
   as described. Run the audit last, against a test box.

Chunks 1–4 are committable independently within the worktree; nothing ships until
the whole plan completes.

## Rollout shape

- **Tests (design-first):**
  - `test/schemas/place.doctest.md` — coordless draft valid; full card valid;
    out-of-range lat fails per-field Zod; a `lat`-without-`lng` card loads but the
    `validate` hook returns a lint issue (T1).
  - `test/core/geo.doctest.md` (pure) — haversine vs a known distance within
    tolerance; inside/outside radius; nearest-wins on overlap; empty → null (T2).
  - `test/location-mark.doctest.md` (`makeTmpBox`) — first mark stamps
    lat/lng/radius and leaves body + a non-schema frontmatter key verbatim;
    inside-fix mark is a no-op; outside-fix mark leaves the card unchanged and
    reports distance; `mark --expand` grows the radius; no-fix errors; out-of-box
    path errors; stale-fix proceeds with the age reported (T3).
  - `test/location-resolve.doctest.md` (`makeTmpBox`) — fix inside a place →
    name prepended + JSON `place`; fix outside → unchanged; coordless/archived
    skipped; one unparseable place card skipped, others still match (T4).
- **Knowledge audit:** one `knows_directly` entry, written and **run** against a
  test box, status recorded before completion.
- **Migration:** none — `place` is a net-new, additive schema. Existing boxes
  have no place cards until the agent authors one; no existing card shape changes.
- **Done-when:** all four doctests pass; the audit passes; on a test box, the
  author→mark→get loop names the place and `bbx location get` outside any place is
  unchanged from `user-location`'s behavior.
