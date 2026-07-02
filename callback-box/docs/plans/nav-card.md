# Nav as a card — first interface-as-cards slice

Status: planned 2026-07. First implementation slice of
`docs/plans/interface-as-cards.md`. Small on the surface, but deliberately
forces the three load-bearing pieces of the architecture into existence:

1. a schema for an interface card,
2. the shell-reads-a-card-with-builtin-fallback pattern (the can't-break
   invariant, v0),
3. live update when an agent edits an interface card.

End-state demo (the thesis in miniature): tell the box agent "put the grocery
list in my nav" → it edits one YAML file → the nav updates with no deploy.
Delete the card → stock nav returns.

## The card

`nav.card` at the **box root** — positional identity (bare `type.card`), its
own `nav` type (not a generic view card; nav's shape is specific). Root-only
in v1; the placement leaves room for per-directory navs later. Not seeded:
no card means builtin nav (materialize-on-assertion — the agent writes one
the first time the boxholder asks to customize).

```yaml
---
entries:
  - { href: /questions }
  - { href: /chat, label: Recent }
  - { href: /chats }
  - { href: /browse }
  - { ref: store/projects/Big_Refactor.project.card, label: The Refactor }
  - { href: /capture }
---
```

Entry union — this is the bootstrap made into a migration tracker:

- **`href:`** — a box-relative route path (`/questions`, `/history`).
  Validated strictly against the builtin route set (a typo fails `cb
  validate`, it doesn't silently 404). As surfaces convert to cards, entries
  flip from `href:` to `ref:`; when no `href:` entries remain anywhere, the
  interface has finished converting.
- **`ref:`** — a real card ref: validated, `cb mv`-rewritten, navigates to
  the card's browse URL. Delivers a capability today's nav can't — pin any
  card into the nav.

Optional per-entry `label`; `ref` entries default to the target card's title
(same rule as landmark links). `searchable: false`. Schema `instructions`
tell the agent what the card controls and how to edit it — the first
interface card an agent can be pointed at.

## Failure = health, not UI improvisation

An invalid or unresolvable `nav.card` is a **health issue**: AppNav falls
back to the builtin nav (no partial rendering — a half-valid nav is more
confusing than stock nav), and the condition is reported through the
existing health system (`health.check` gains a nav check; it surfaces in
dashboard HealthWarnings, naming the card). No bespoke nav-side error UI.

## Implementation order

### PR 1 — positional naming (prerequisite, standalone)

Bare `type.card` — "the ‹type› of this directory": filename parsing (dotless
stem = the type, name empty/implicit), validation, title derivation
(fall back to type / containing directory name), doctests. Basename
uniqueness already yields at-most-one-per-directory. First consumer of the
positional-identity decision; everything later (landmark/briefing renames,
chat husks) wants it too.

### PR 2 — `nav` schema + resolution + health

- `src/schemas/nav.ts` (+ registry): entry union as above, strict href
  validation against the route set, `instructions`.
- tRPC procedure (shape of the landmarks resolver): load root `nav.card`,
  validate, resolve ref labels/targets server-side. Returns resolved entries
  or a typed absent/invalid result — never throws to the client.
- Health check: invalid/unresolvable nav card → warning naming the card.

### PR 3 — AppNav consumes it

- Fetch resolved nav; card absent → today's hardcoded array (which stops
  being *the nav* and becomes *the builtin fallback nav* — same code, new
  job). Invalid → fallback (health carries the report).
- `file-change` on `nav.card` invalidates the query — agent edits appear
  live.
- Match-highlighting: existing per-route logic for `href` entries; `ref`
  entries match the browse path.
- Verify in the worktree box clone via `bin/browse`.

## Deliberately deferred

- The **nav form** (third card form beside tile/full; type-computed badges).
  V1 keeps the Chats freshness badge hardcoded, attached to the `/chats`
  href entry.
- A nav renderer for Browse (opening `nav.card` in Browse shows plain
  frontmatter — fine).
- Per-directory / contextual navs; mobile layout changes; seeding.
