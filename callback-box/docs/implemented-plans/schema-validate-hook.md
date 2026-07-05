# Schema `validate` hook — co-locate non-Zod card validation with its schema

> **Status: implemented (2026-06-18).** Frozen historical record. The shipped
> convention lives in `docs/adding-schemas.md`, the box-local schema guide
> (`src/core/box-templates.ts` → `config/schemas/CLAUDE.md`), and the
> `commentary.tsx` / `extfile.tsx` schema modules. As-shipped deviations from
> the original plan are flagged inline in the Rollout / Knowledge-audits
> sections.

Add a first-class `validate` hook to cardworks' `cardSchema()` so that
validation a Zod schema can't express (cross-field rules, body parsing) lives
**on the schema that defines the card type**, instead of in a central
type-keyed `if`/ternary dispatch in `callback-box/src/core/card-lint.ts`. The
hook is **self-contained**: it sees only the card's own parsed data, no box /
loader / cross-card access. The generic ref-existence walk (which needs the
loader) stays centralized in `card-lint.ts`.

## Stated preferences this plan trades against

- `callback-box/CLAUDE.md:101` — *"Read before writing. Don't guess file
  formats, XML structures, or API shapes."* This plan is grounded in the
  actual `card-lint.ts` / `card-schema.ts` source, cited below.
- `callback-box/CLAUDE.md` (Improving These Instructions / Guides table) — the
  schema-authoring doc (`docs/adding-schemas.md`) and schema-module headers are
  the canonical places a future agent learns "where does validation go"; this
  plan must update them or it leaves false guidance behind.
- `cardworks/conventions.md` — *"Only export what's needed"* (knip-enforced),
  *"Max 2 positional parameters"*, *"No optional chaining"* (explicit null
  checks), *"Use custom error classes"*, files ≤300 / functions ≤150 lines.
  The new hook type and the validators that move into schema modules follow
  these.
- `callback-box/code-style.md` — *"as type assertions are like Rust's
  unsafe"*; *"No default parameters"*; max-2-positional. The dispatch rewrite
  and the moved validators must not introduce bare `as` or default params.
- `callback-box/CLAUDE.md` (Behavioral Notes) — *"don't add features beyond
  what the task requires"* (paraphrase of the project's minimalism). This is
  why context-aware validation is designed-for but **not built** here.
- Most recent precedent: the commentary/extfile validators themselves
  (`card-lint.ts:158-180`, `257-277`) and the existing optional-field copy
  pattern for `instructions` (`card-schema.ts:194-197`) — the densest
  preference for how an optional schema member is carried.

## What already exists

- **`cardSchema()` and its config/resolved types** —
  `cardworks/src/schema/card-schema.ts:98-108` (`CardSchemaConfig`),
  `:114-132` (`CardSchema`), `:142-198` (`cardSchema()`). The resolved
  `CardSchema` already carries an optional member (`instructions?`) by
  conditional spread at `:194-197`:
  > `if (config.instructions !== undefined) { return { ...schema, instructions: config.instructions }; }`
  **Reuse:** `validate?` attaches the same way — new optional field on the
  config, copied onto the resolved schema by the same conditional-spread idiom.
- **`LintIssue` type** — `cardworks/src/lint/lint.ts:9-14`, re-exported from
  `cardworks/src/index.ts:89`. Closed `type` union
  (`"parse" | "validation" | "reference" | "id" | "schema" | "contains"`).
  Both current validators emit `type: "validation"`
  (`card-lint.ts:165, 173, 261`). **Reuse:** the hook returns
  `LintIssue[]`; `card-schema.ts` adds `import type { LintIssue } from "../lint/lint.js"` (type-only — no value cycle for madge).
- **The type-keyed dispatch to replace** — `card-lint.ts:140-145`:
  > `const errors = type === "commentary" ? commentaryErrors(...) : type === "extfile" ? extfileErrors(...) : [];`
  **Rebuild → generic:** becomes `parsed.schema.validate?.({ fields }) ?? []`.
- **The two validators to move** — `extfileErrors` + helpers `isFileUrl` /
  `hasSha256Marker` (`card-lint.ts:158-193`); `commentaryErrors` +
  `validateMarkdocBody` (`card-lint.ts:257-277`). **Move:** into
  `src/schemas/extfile.tsx` and `src/schemas/commentary.tsx` respectively.
  `commentaryErrors` runs `Markdoc.parse`/`validate` against `markdocConfig`
  (`../shared/markdoc-config.js`) — both importable from a schema module
  (they're callback-box-internal).
- **Parsed data on hand at the call site** — `card-lint.ts:101-117`:
  `parsed = parseCardText(...)` yields `ParsedCard`
  (`card-io.ts:95-102`) with `fields: Record<string, unknown>` (Zod-validated
  frontmatter **plus** the body value injected at `fields[schema.bodyFieldName]`
  — `card-io.ts:148-151`) and `rawBody: string`. So the body is reachable as
  `fields["body"]`; the hook does **not** need a separate `body` param.
- **The generic ref-walk that stays** — `card-lint.ts:115-136`
  (`extractRefs` + `extractBodyRefs` → `loader.resolveRef`). Context-dependent
  (needs the loader) and applies to *all* cards. **Stays in card-lint.ts** — it
  is explicitly *not* a per-schema, self-contained rule.
- **cardworks test convention** — `cardworks/test/card-schema.test.ts` uses
  `tap` (`import { test } from "tap"`). **Reuse:** the hook's cardworks-level
  unit test extends this file.
- **callback-box dispatch test** — `callback-box/test/card-lint.doctest.md`
  exists. **Reuse:** add a case proving generic dispatch fires a schema's
  `validate` (and that a schema without one is a clean no-op).

## Prior art (external)

This is an internal API-shape change to a first-party library (`cardworks`) we
own and edit in-repo; no third-party tool's capabilities or limitations are in
play. The one library touched at runtime is Markdoc, and only because
`commentaryErrors` *relocates* its existing `Markdoc.parse`/`validate` call
unchanged — no new Markdoc behavior is requested. **No external prior-art
search performed, and none is warranted:** the design question ("optional
validation callback on a schema descriptor") is a local refactor, not a
pattern we need to validate against the ecosystem. Recorded as a deliberate
skip per the skill's skip-with-rationale allowance.

## Tracks / scope

Single track, four ordered chunks (see Implementation order). The work is
small and cohesive enough that splitting into named tracks would be ceremony.

- **What** — introduce `validate?(input): LintIssue[]` on `CardSchemaConfig`
  / `CardSchema` in cardworks; move the two existing self-contained validators
  onto their schemas; replace the type-keyed dispatch in `card-lint.ts` with a
  generic `schema.validate?.(...)` call; update docs + schema-module headers;
  add and run a knowledge audit.
- **Why this needs to change** — concrete problem: every card type needing a
  rule Zod can't express today edits the central `card-lint.ts` ternary
  (`:140-145`) and adds a pure function *away from* the schema that defines the
  type. Validation for a type is not discoverable from its schema module; the
  module headers even point the reader at `card-lint.ts`
  (`commentary.tsx:12`: *"Markdoc validation of those tags lives in
  card-lint.ts"*). The dispatch is O(types) and grows with every new type.
- **Direction** — exact shape:

  ```ts
  // cardworks/src/schema/card-schema.ts
  import type { LintIssue } from "../lint/lint.js";

  /** Input to a schema's self-contained validate hook: the card's own parsed
   *  data and nothing else (no loader / box / cross-card access). `fields` is
   *  the Zod-validated frontmatter with the body value at `fields["body"]`
   *  when the schema declares a body. */
  export interface CardValidateInput {
    fields: Record<string, unknown>;
  }

  export interface CardSchemaConfig<TFields extends Record<string, FieldDecl>> {
    fields: TFields;
    instructions?: string;
    searchable?: boolean;
    /** Self-contained validation a Zod schema can't express (cross-field
     *  rules, body parsing). Returns cardworks LintIssue[]. Sees only the
     *  card's own data — for box-aware checks (ref resolution) the generic
     *  walk in the host stays separate. */
    validate?: (input: CardValidateInput) => LintIssue[];
  }
  ```

  `CardSchema` gains a matching `readonly validate?: (input: CardValidateInput) => LintIssue[];`
  (`card-schema.ts:114-132`), carried by extending the existing conditional
  spread at `:194-197` (so a schema with neither `instructions` nor `validate`
  still produces the same object shape).

  Call site (`card-lint.ts:140-145`) collapses to:

  ```ts
  const errors = parsed.schema.validate
    ? parsed.schema.validate({ fields: parsed.fields })
    : [];
  ```

  (Explicit-conditional form, not `?.() ?? []` — `code-style.md` /
  `conventions.md` forbid optional chaining.)

  Schema modules supply the hook. extfile (`extfile.tsx`):

  ```ts
  validate: ({ fields }) => extfileErrors({ fields }),
  ```

  commentary (`commentary.tsx`) narrows the body itself (chosen input shape
  passes only `fields`):

  ```ts
  validate: ({ fields }) => {
    const body = fields["body"];
    return commentaryErrors({ body: typeof body === "string" ? body : "" });
  },
  ```

  The moved `extfileErrors` / `commentaryErrors` and their private helpers keep
  their current bodies verbatim (`card-lint.ts:158-193`, `257-277`); they
  become module-private functions in the schema files, **not** exported (knip:
  *"Only export what's needed"*) — only the `validate` reference on the schema
  uses them.
- **Vocabulary lock-ins** — the member name **`validate`**, the input field
  name **`fields`**, and the input type name **`CardValidateInput`**. These are
  cross-cutting: every future schema author writes `validate: ({ fields }) =>
  …`. Locking them now so the future context-aware sibling reads consistently
  (see Open questions).
- **First implementation chunk** — Chunk 1 (cardworks hook). No open questions
  inside it: add `CardValidateInput`, the two optional members, the
  conditional-spread copy, and a `tap` test asserting (a) a schema with
  `validate` carries it and it runs, (b) a schema without `validate` has
  `schema.validate === undefined`. Self-contained and exercisable in cardworks
  alone.

## Subplans

None. No sub-question here needs its own design step — the input shape and the
future-context question are settled decisions / explicit deferrals, recorded in
Direction and Open questions rather than spun into a subplan.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A schema's `validate` throws (e.g. Markdoc internal error on a pathological body) at the `card-lint.ts` call site | No — add | **Gap today too:** `commentaryErrors` already calls Markdoc inside the existing dispatch with no try/catch; `validateMarkdocBody` catches `markdocParse` failure (`card-lint.ts:269-272`) but not `markdocValidate`. The refactor preserves this exactly. | Would surface as a thrown error → `lintOne` has no catch around `lintFrontmatterCard`'s post-parse section, so it propagates to `lintCardsDispatch`'s loop (uncaught). Same as today. |
| `parsed.fields["body"]` is not a string when commentary's `validate` reads it (body-less commentary, or future body-kind change) | Covered by the `typeof body === "string" ? body : ""` narrow in the moved hook | Yes — narrow is in the hook | Clear: empty-string body → `commentaryErrors` returns `[]` (`card-lint.ts:267`) |
| A new schema author forgets `validate` and expects a rule to fire | Audit (see Knowledge audits) nudges discovery | N/A — absence of a hook means no extra rules, which is the correct default | Silent by design (no hook = no extra validation), but documented in `adding-schemas.md` |
| `import type { LintIssue }` introduces a module cycle cardworks' madge rejects | `pnpm lint:circular` in cardworks | Type-only import — madge accepts type-only cycles (`conventions.md`) | Clear (build/lint catches it) |
| Moved `extfileErrors`/`commentaryErrors` left exported and unused-elsewhere | `pnpm lint:knip` | Make them module-private | Clear (knip errors) |

**Critical gap:** none. The one pre-existing thin spot (an unguarded
`markdocValidate` throw) is *carried unchanged*, not introduced — flagging it
here as a documented, out-of-scope risk: hardening Markdoc error handling is
not part of this refactor (it would change behavior, not just relocate it).

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field** — N/A to this change. The hook is invoked by the
  host on the resolved schema; an agent never selects it. **ADDRESSED** (not
  applicable — no agent-facing selection surface).
- **Stale ref** — **ADDRESSED**: ref-existence checking deliberately stays in
  the centralized generic walk (`card-lint.ts:115-136`), untouched. The new
  self-contained hook never sees the loader, so it cannot regress ref handling.
- **Two agents touching the same card** — N/A: validation is read-only over a
  single parsed card; no shared mutable state. **ADDRESSED** (not applicable).
- **Hand-edit drift** — **ADDRESSED**: a malformed commentary body still routes
  through the same `commentaryErrors`/Markdoc path, now invoked via the hook;
  identical lint output. Verified by carrying the doctest behavior.
- **Fabricated free-form value** — N/A: the hook adds no new author-supplied
  free-form field. **ADDRESSED** (not applicable).
- **Validation error UX** — **ADDRESSED**: the moved validators return the same
  `LintIssue` messages verbatim (`extfile href must be a file: URL …`,
  `extfile version must contain a sha256:<hex> marker …`, Markdoc messages), so
  agent-context readability is unchanged.
- **Partial migration / transition state** — **ADDRESSED**: there is no data
  migration and no transition window. The cardworks hook is additive; the two
  schemas and the dispatch flip in the same plan. During the brief window
  between Chunk 1 (hook added) and Chunk 2/3 (validators moved + dispatch
  flipped), the old ternary still works because the schemas don't yet define
  `validate`. The chunks land in one plan, so no released state is half-migrated.

## NOT in scope

- **Context-aware validation** (a hook that can resolve refs / read other cards
  / see box config). Deferred because the task is explicitly self-contained and
  the project rule is *don't add features beyond what's required*
  (`CLAUDE.md` Behavioral Notes). Designed-for, not built — see Open questions
  for why the chosen signature stays additive.
- **A `validate` seam on the legacy XML `element()` path**
  (`cardworks/src/schema/element.ts:7-12`, `:74`). XML cards validate through
  cardworks' own `lintCard` (`card-lint.ts:92`), a separate pipeline; no XML
  card currently needs a non-Zod self-contained rule. Adding symmetric support
  is unjustified net-new surface now. Deferred; revisit only if an XML card
  grows such a need.
- **Moving the generic ref-walk** (`card-lint.ts:115-136`) onto schemas. It is
  context-dependent (loader) and universal; per-schema relocation would
  duplicate it across every schema. Stays centralized.
- **Hardening the unguarded `markdocValidate` throw** (see Failure modes). It
  is a pre-existing behavior carried unchanged; fixing it is a separate concern.

## Open design questions

- **Future context-aware sibling — separate hook vs. second param.** Lean:
  **separate optional member** `validateWithContext?(input, ctx): LintIssue[]`
  (or returning a `Promise`, since ref resolution is async — `resolveRef` is
  awaited at `card-lint.ts:121`). Rationale for keeping it separate rather than
  widening `validate`'s input: `validate` is synchronous and pure; a
  context-aware check is async and impure, and most schemas will only ever want
  the simple form. Adding a sibling member later is **purely additive** — it
  does not touch `CardValidateInput`, the existing `validate` signature, or any
  current caller. This is why `CardValidateInput` is an object (room to grow)
  and why `validate` returns a plain (non-Promise) `LintIssue[]` now. **Not
  decided here; not built here** — recorded so the chosen shape is known to be
  non-cornering.
- **Should `CardValidateInput` be an object given it has one field today?**
  Lean: **yes, keep it an object.** A bare positional `fields` would force a
  breaking change the day a second self-contained datum is wanted, and the
  named-params-object convention (`code-style.md`) favors it. Settled enough to
  be in Direction, noted here for the reviewer's eye.

## Knowledge audits

This plan introduces an **agent-facing convention**: "validation a Zod schema
can't express now goes in the schema's `validate` hook, not in
`card-lint.ts`." A schema author is an agent role, so this gets an audit.

*(As-shipped correction: the level is `discoverable`, not `knows_directly`.
The convention lives in the box-local schema guide
(`config/schemas/CLAUDE.md`, generated from `box-templates.ts` — updated by
this plan), which a box agent reads on demand rather than carrying in context.
This matches the sibling `create-new-card-type` audit, which is also
`discoverable` with `should_read: ["config/schemas/CLAUDE.md"]`. The audit was
run against the worktree box and passed — the agent discovered the doc and
named the hook; status recorded in the yaml.)*

Add one entry to `callback-box/src/dev/knowledge-audits.yaml`, tagged
`[schemas, validation]`:

```yaml
- id: schema-validate-hook
  prompt: >
    You're adding a card type whose rules go beyond what Zod field types can
    express — e.g. a cross-field constraint, or validating the body's parsed
    structure. Where does that validation go?
  expected_level: knows_directly
  watch_for: >
    Names the schema's `validate` hook on cardSchema() — self-contained,
    co-located with the schema, returning LintIssue[]. Must NOT say "add a
    branch to card-lint.ts" or "add a type=== check to the central dispatch".
    Knowing it's self-contained (no loader/cross-card access) is a plus.
  correct_contains: ["validate"]
  tags: [schemas, validation]
```

**Run before the plan completes:** `pnpm knowledge-audit run --box
~/src/box-worktrees/schema-validate-hook/test1 --filter schema-validate-hook`
(absolute box path per the *"--box is a path"* hazard). Record the pass/fail
status as a dated comment above the entry in the yaml, matching the existing
status-comment convention (`knowledge-audits.yaml:2557`). The audit can only be
authored honestly after the docs land (Chunk 4), since `knows_directly`
presumes the convention is discoverable from CLAUDE.md / the schema docs —
so it runs in Chunk 5, after docs.

## Implementation order

1. **cardworks hook** — add `CardValidateInput`, `CardSchemaConfig.validate?`,
   `CardSchema.validate?`, the conditional-spread copy in `cardSchema()`, and
   the `import type { LintIssue }`. Extend `cardworks/test/card-schema.test.ts`
   with the carry/no-op assertions. `pnpm --filter cardworks typecheck && lint
   && test` green. Depends on nothing.
2. **Move the validators onto their schemas** — relocate `extfileErrors` (+
   `isFileUrl`, `hasSha256Marker`) into `extfile.tsx` and `commentaryErrors`
   (+ `validateMarkdocBody`) into `commentary.tsx`, each wired as the schema's
   `validate`. Update each module's header comment (they currently say
   validation lives in card-lint.ts — `commentary.tsx:12`, and extfile's
   surrounding prose). Depends on Chunk 1.
3. **Generic dispatch in card-lint.ts** — replace the `:140-145` ternary with
   the explicit `parsed.schema.validate ? … : []` form; delete the now-moved
   functions from `card-lint.ts`; update the file header (`:1-15`) so it no
   longer implies type-specific validation lives here. Add a
   `card-lint.doctest.md` case: a card whose schema has a `validate` surfaces
   its error; a card whose schema has none is a clean no-op. Run
   `pnpm --filter callback-box typecheck && lint && test`. Depends on Chunk 2
   (schemas must define `validate` before the ternary is removed, else the rules
   vanish).
4. **Docs** — update `docs/adding-schemas.md` (add a "Validation beyond Zod"
   subsection documenting the `validate` hook, self-contained, returns
   `LintIssue[]`); check/refresh any CLAUDE.md card-section or `.claude/rules`
   wording that points validation at card-lint.ts (grep found none in
   `.claude/rules`; the live schema-module headers are handled in Chunk 2).
   Depends on Chunks 1-3 (docs describe the shipped shape).
5. **Knowledge audit (author + run)** — add the yaml entry, run it filtered
   against the worktree box, record status. Depends on Chunk 4 (the audit
   presumes the convention is documented).

## Rollout shape

- **Test posture.** *(As-shipped: per the boxholder's direction to favor
  Markdown doctests over cardworks/XML unit tests since XML is being removed,
  the planned cardworks `tap` unit test was dropped.)* One new test lands *with*
  the change: a `card-lint.doctest.md` case proving generic dispatch fires an
  arbitrary schema's `validate` hook and is a clean no-op for a schema without
  one. The existing `card-lint.doctest.md` extfile/commentary cases stay green
  unchanged — identical `LintIssue` output through the new hook is the contract,
  and that is the real regression guard (the hook's presence/absence behavior is
  fully observable through dispatch).
- **Knowledge audits.** One `knows_directly` entry (`schema-validate-hook`),
  authored and **run** with status recorded, lands with the plan (Chunk 5).
  None deferred.
- **Migration.** None — no on-disk card data shape changes. This is a code-only
  relocation of validation logic; every card validates to the same result
  before and after. The change ships as one unit (cardworks hook + both schemas
  + dispatch + docs + audit); it is not released in pieces.
- **Ship signal.** The plan completes when Chunks 1-5 are committed on this
  worktree and `pnpm typecheck && pnpm lint && pnpm test` are green at the
  monorepo root. Merging to `main` is a separate, boxholder-triggered step
  (`/finish`) — not done by the implementing agent on its own.
