---
title: "Retire doctest: TypeScript tests with a typed check()"
status: partial
workstream: doctest-typecheck
issues:
  - ../../../issues/code-quality/2026-09-27-convert-test-ts-files-to-doctests.md
  - ../../../issues/code-quality/2026-10-13-try-ai-deslop-rules-and-lint-doctest-code.md
---
# Retire doctest: TypeScript tests with a typed check()

The monorepo's 1,092 Markdown doctests become ordinary `.test.ts` files.
These run on tap and assert with a typed whole-value
`t.check(actual, expected)`. Then the doctest loader, its typecheck adapter,
and the tools that know the format are deleted.

The work runs in three phases:

1. **Destination.** Build `t.check` and prove it is a sound destination
   before anything is converted or announced:
   - its own tests;
   - a differential test against the doctest checks it replaces;
   - usability trials with Haiku, Luna and Sonnet on real tasks.
2. **Conversion.** A mechanical conversion with proof that no check was
   lost. This phase retires the format.
3. **Strengthening.** A separate, reviewed pass that strengthens
   assertions.

Cheap models (gpt-6-luna, Claude Haiku) do most of the per-file work in
phases 2 and 3.

**Issues addressed:**
- `2026-09-27-convert-test-ts-files-to-doctests` is superseded: it went the
  other way. It is closed as "will not do", with a pointer here.
- `2026-10-13-try-ai-deslop-rules-and-lint-doctest-code` part 2 ("decide
  whether doctest code should be linted") is answered: test code is `.ts`, so
  it is linted. Part 1, the deslop rule trial, stays open.
- Related, not resolved:
  - `2026-08-09-test-suite-per-file-cost-floor`, where the spike's tsx cache
    finding belongs.
  - `2026-10-16-narrow-types-to-remove-doctest-casts`, which still applies to
    `.ts` tests.
  - `2026-10-10-doctests-use-real-types-as-generic-fixtures`.
  - `2026-10-13-shared-helper-spawn-bin-ts-from-doctest`.
  - `2026-10-08-test-volume-sweep`.
  - `2026-10-17-move-typescript-eslint-to-typescript-7`. The TypeScript 7
    move (`beebox/docs/implemented-plans/typescript-7.md`) left
    agent-doctest's doctest typecheck on the 6.0 API. That plan says,
    under Open design questions, *"Lean: accept it, because the handoff says
    doctests may be removed"*. Track 6 deletes `agent-doctest/src/typecheck/`,
    whose `check.ts:18` has `import ts from "typescript"`, which leaves
    typescript-eslint as the only 6.0 user.

## Design

No design section: this is test tooling for developers and agents. No box-user
surface changes.

## Smallest fix and budget

**BIG CHANGE.** The converted test files drive the size. They are generated
by a converter and then edited by models, and their size is reported
separately below.

**Smallest fix:** stop writing new doctests and write new tests as `.ts` with
`t.check`. Leave the 1,092 doctests in place. That keeps two test formats and
all doctest tooling forever (see *Could this be simpler?*).

Authored change, estimated as additions plus deletions:

| Track | Lines |
|---|---:|
| 1. Typed `check` and matchers (`agent-doctest/src/check/`) | 1,000 |
| 2. Test typecheck programs, converter, fidelity manifest (converter temporary) | 1,600 |
| V. Trial harness, mistake corpus, differential test (temporary) | 700 |
| 3. Driver, worker slots, brief (temporary) | 600 |
| 5. Upgrade pass (temporary) | 400 |
| 6. Removal of loader, typecheck adapter, doctest-hooks, selection/ledger/hooks/knip/layout code | ~4,500, mostly deletions |
| Authored docs, skills, rules, agent instructions | ~1,500 |

**Generated output,** reported separately: about 1,092 files and 184,000
Markdown lines become about 1,092 `.test.ts` files. The census of 2026-10-17
counted 51,762 prose lines and 110,201 code lines, so the result is roughly
150,000–170,000 lines of TypeScript and comments.

**What the fuller design buys:**
- one test format (principle 8);
- lint, typecheck, and editor support on all test code with no adapters
  (principles 11 and 12);
- expected values typed against the code under test, where that code returns
  typed values (principle 1).

## Stated preferences this plan trades against

- **Principle 8, "One way to do each thing"** (`beebox/docs/engineering-principles.md:95`).
  - Two formats run side by side during phase 2. That is a transition state
    with an end.
  - There are two assertion forms: `t.check` for typed values and
    `t.checkText` for text with `«»` wildcards. The text form exists because
    command output is text, and a type cannot describe the inside of a
    string.
  - Phase 2 uses `checkText` everywhere, because it is the exact doctest
    semantics.
- **Principle 11, "Enforcement beats convention"** (`engineering-principles.md:127`).
  - Doctest code is not linted today. After conversion, `beebox/eslint.config.ts:236`
    (`files: ["src/**/*.{ts,tsx}", "test/**/*.ts"]`) covers all backend test
    code.
  - Lint rules are not weakened. A rule that seems wrong for tests goes to
    the boxholder (repo `AGENTS.md`, "Do not disable or weaken lint rules").
- **Principle 12, "The maintainer is usually an agent"** (`engineering-principles.md:141`).
  - Agents know `.ts` test files without a rules file.
  - `beebox/docs/implemented-plans/doctest-usability.md:95-97`: *"The doctest
    skill was loaded in 3 of 7 Sonnet runs and 0 of 7 Haiku runs."*
- **The boxholder's own decisions:**
  - Exact matching is the default: "yes, definitely exact as the default",
    2026-10-17.
  - Tests should check more of the value: "towards testing _more_, not less".
  - Low churn: "I don't want a lot of churn".
  - No Vitest: "we can put aside vitest now".
- **Most recent precedent:** this workstream's doctest-typecheck grind of
  2026-10-16. Its CODING_FEEDBACK,
  `workstream-exhibits/doctest-typecheck/coding-feedback/20261016T142455Z-review-adjudicated.md:15-18`,
  records: *"Several workers spawned their own sub-agents, one ran pkill on
  tap and disrupted siblings, and they overwrote each other's files in the
  shared scratchpad."* Track 3 gives each worker its own worktree because of
  this.

## What already exists

- **Text check and matcher.** Reused for `t.checkText` and for diffs.
  - `agent-doctest/src/tap-check/check.ts:77` `check()`, `wildcards.ts`,
    `diff.ts:33` `buildDiff`, `suggest.ts:26` `suggestExpected`.
  - `tap.ts` patches `TestBase.prototype.check` and `checkThrows`.
- **Doctest parser and generator.** Reused as the converter's front end.
  - `agent-doctest/src/doctest-hooks/doctest-parse.ts`, `doctest-split.ts`
    (`rewriteImports` at `:157-164`), and `doctest-generate.ts:120`
    `generateTestModule`.
  - All 1,092 files generate without error (census, 2026-10-17).
- **Runtime semantics the converter must reproduce** (`doctest-hooks/`):
  - Every check is awaited (`doctest-emit.ts:77`).
  - Imports inside an example run as dynamic `await import()` in source order
    (`doctest-split.ts:157-164`).
  - Setup blocks run at module scope (`doctest-generate.ts:129-133`).
  - A `continue` block shares the open test's function body (`:182-191`).
  - Cleanup blocks register `teardown` ahead of the body. Each is wrapped in
    `try/catch` and reported through `t.error` (`doctest-runtime.ts:219-240`).
  - `print()` lines drain into the next check, joined with its result
    (`doctest-runtime.ts:171`).
  - `t` and `print` are bound per test unless setup declares them
    (`doctest-runtime.ts:202-203`).
  - A per-example "still running" notice prints after a timeout
    (`doctest-runtime.ts:145`, emitted at `doctest-emit.ts:80`).
- **Prototypes in this worktree.** They are uncommitted. Their designs are
  reused, and the code is rebuilt in track 1.
  - `agent-doctest/src/tap-check/expected.ts`: typed `Expected<T>` with `w.*`
    wildcards over the text matcher.
  - The Vitest spike of 2026-10-17 was deleted, not kept. It showed three
    things this plan relies on:
    - `[others]` and the `str` template work as typed patterns.
    - A diff stays readable when matched patterns are replaced by actual
      values.
    - Two `check` overloads give one-line type errors.
  - Three hand-converted tests: `beebox/test/lib/box-slug.test.ts`,
    `test/core/mobile/session.test.ts`, and
    `test/webapp/server-root.healthz-schema-failures.test.ts`.
- **Test helpers.** Reused, then renamed in track 6.
  - `beebox/test/helpers/doctest-helpers.ts` (431 importers).
  - `doctest-server.ts` (77 importers).
- **Selection, ledger, and tiers already accept `.test.ts`.**
  - `bin/test-tiers.ts:26` has
    `TEST_FILE = /^[^-].*\.(?:doctest\.md|test\.tsx?)$/`.
  - The roots are at `bin/test-ledger-lib.ts:99`.
- **TypeScript programs that cover test code today.**
  - `beebox/tsconfig.typecheck.json` includes `test/**/*.ts`.
  - The root `tsconfig.json:24` includes `bin/**/*.ts`.
  - `scan-uploader/tsconfig.json:20` includes `test/**/*`.
  - Not covered: `beebox/src/frontend/tsconfig.json:63` (`"src"`, not
    `test/`), `browse/tsconfig.json:19` (no `test/`), and
    `workstreams-app/tsconfig.json:21` (only `test/router/**/*`). Track 2
    adds programs for these.
- **Model dispatch.**
  - `bin/cross-model-run.ts:141-148` runs Codex as
    `codex exec - -s read-only -C <cwd> -m <model> …`. That precedent is
    read-only.
  - The Claude form is `claude -p --model <model> --tools …`.
  - Model IDs are at `beebox/src/shared/model-ids.ts:17-24`:
    `luna: "gpt-6-luna"`, `haiku: "claude-haiku-4-5-20251001"`.
  - No bulk-dispatch tool exists; the search found only review and session
    launchers.

## Prior art (external)

- **Expect tests (adopted).** Jane Street, "The Joy of Expect Tests":
  https://blog.janestreet.com/the-joy-of-expect-tests/. This is the named
  pattern the testing docs cite. ACKNOWLEDGEMENTS.md entry in chunk 1.
- **One `check` function, data in and data out (adopted).** matklad, "How to
  Test": https://matklad.github.io/2021/05/31/how-to-test.html. Cited with the
  above.
- **Matcher names (names adopted, not the implementation).** Jest/Vitest
  asymmetric matchers (`any(String)`, `anything()`):
  https://jestjs.io/docs/expect. Their matchers are untyped (`any`).
- **Refinements (names and chaining adopted, not the library).** ts-pattern's
  `startsWith`, `endsWith`, `includes`, `regex`, `int`, `between`, and
  `P.union`: https://github.com/gvergnaud/ts-pattern.
  - Its object patterns ignore extra keys.
  - Its patterns cannot print back as source.
  - It has open "excessively deep" type issues.
- **"Keys not listed" inside the object (adopted).** JSON Schema
  `additionalProperties` and Zod `.catchall()` are the model for `[others]`.
- **earl (evaluated):** https://github.com/earl-js/earl. It types the expected
  object, but its matchers return `never`, and its last release was
  2025-09-30.
- **Elixir pin and TC39 bindings (evaluated).** Re-referencing a capture
  inside one expected value was dropped; a returned capture covers the need.
- **Runners (evaluated; staying on tap).**
  - tap 21.8.0, released 2026-09-03, one maintainer:
    https://github.com/tapjs/tapjs.
  - Vitest 5 spike, 2026-10-17: 40 unchanged doctests ran in 50 s against
    tap's 74 s. The boxholder declined it. The gain comes mostly from
    compiling once, which is independent of Vitest, and box code would load
    through Vite in tests.
  - `node:test`: declined by the boxholder.
  - AVA, Japa, Mocha, and Poku either share processes, which breaks env
    isolation, or offer nothing over tap (npm, 2026-10-17).

## Ontology

- **test file:** a `*.test.ts` file run by tap. Existing
  (`bin/test-tiers.ts:26`). It is NOT a doctest. It keeps the doctest's stem:
  `foo.doctest.md` becomes `foo.test.ts`, or `foo.test.tsx` when it contains
  JSX.
- **check:** `t.check(actual, expected?)`, a method on tap's test object.
  - It compares the whole value against a typed expected value.
  - It reports a failure and the test continues.
  - It replaces the prototype overload of today's `t.check` (`tap.ts`).
- **checkText:** `t.checkText(actual, text)`. This is the doctest `=>`
  semantics: serialize to text, then match with `«»` wildcards. Today's
  `t.check(actual, string)` is renamed to it. It is NOT typed.
- **checkThrows:** `t.checkThrows(fn, "Name" | "Name: message")`. Existing
  (`tap.ts`). The options object becomes a string argument.
- **expected value:** an `Expected<T>`. It has the actual value's shape, and
  any position may be a pattern. It is NOT a schema.
- **pattern:** an object that matches one position and prints as its own
  source text.
  - Base patterns: `any(String | Number | Boolean)`, `anything()`, `uuid()`,
    `isoDate()`, `oneOf(...literals)`, `optional(p)`, and the `str` template.
  - String refinements: `.startsWith`, `.endsWith`, `.includes`,
    `.matches(re)`.
  - Number refinements: `.int()`, `.between(a, b)`, `.positive()`.
  - It is NOT a predicate function: there is no `when(fn)`, because a function
    cannot print back.
- **`[others]`:** a symbol key in an expected object. Its value is the
  pattern that every key not listed must match. `notAllowed()` is the default,
  written out.
- **capture:** `capture(pattern)` is a handle that matches like `pattern` and
  keeps the matched value as `.value`, typed from the pattern.
  - It replaced `.as("name")` during track 1. Returning captures by name
    needed a generic expected type, and that type broke the type checker's
    own excess-property check on nested keys.
  - A handle keeps the expected parameter non-generic, so a misspelled key
    is reported at any depth as `'z' does not exist`.
- **suggestion:** the TypeScript literal printed on failure, or when
  `expected` is omitted. It is built from the actual value.
- **fidelity manifest:** per doctest, the list of its executable examples
  (source line, kind: statement, check, or throws) and its block structure. The
  converter writes it, and `verify` checks it against the converted file. It is
  temporary.
- **converter:** the one-shot tool that turns a doctest into a test file. It
  is temporary.
- **upgrade pass:** the phase-3 deterministic step. It tries to turn each
  `checkText` into a typed `check`, and keeps a change only when tsc and the
  test pass. It is temporary.
- **worker:** a gpt-6-luna or Haiku process that edits one batch in its own
  worker slot under the brief.
- **worker slot:** a dedicated git worktree that one worker uses at a time.
  The driver resets it to the conversion branch tip before each batch.
- **batch:** a set of files in one directory, assigned to one worker.
- **cutover date:** the day tracks 1 and 1b land on main, after the phase 1
  gate.
- **differential test:** for each `checkText` → `t.check` upgrade in the
  sample, mutated actual values that must fail the typed check whenever
  they fail the text check. It is temporary.
- **trial:** one usability task given to one model, scored as in track V.
  - From then on, no new `.doctest.md` may be added.
  - Existing doctests are edited in place until they are converted.
  - It is written as an absolute date in every notice.

## Tracks / scope

Phase 1 (destination) is tracks 1, 1b, 2's converter, and V. Phase 2 (conversion) is tracks 3, 4, and 6. Phase 3 (strengthening) is track 5. Track 6 needs phase 2 only.

### Track 1 — typed `check` and matchers on tap

- **What:** `agent-doctest/src/check/`, exported as `agent-doctest/check`. It
  holds the patterns, `Expected<T>`, the structural matcher, the diff, the
  suggestion printer, and the tap methods `t.check`, `t.checkText`, and
  `t.checkThrows`.
- **Why:** phase 2 needs `checkText` and `checkThrows` under their final
  names. Phase 3 and every new test need the typed `check`.
- **Direction. Matching is recursive and exact, with a defined boundary:**
  - **Plain object:** same own enumerable string keys, unless `[others]` is
    present, and each value matches. A class instance compares by its own
    enumerable data when the expected value is a plain literal. The diff names
    the class.
  - **Array:** length and position.
  - **`Map`:** entries in insertion order, with keys compared by `Object.is`
    and values matched.
  - **`Set`:** members in insertion order.
  - **`Date`:** against an ISO string or a `Date`.
  - **`Error`:** `name`, `message`, and own enumerable properties.
  - **Pattern:** its own test.
  - **Anything else fails with "unsupported value at <path>; compare a
    projection or use checkText":** symbol keys, functions, `WeakMap`, and
    class instances with no own enumerable data.
  - **Diff:** the expected value is rendered with each matched pattern
    replaced by the actual value at that position, so the diff shows only
    real differences. Both sides go through the existing `buildDiff`.
  - **Suggestion:** printed from the actual value as a TypeScript literal:
    - identifier keys are unquoted;
    - UUID strings print as `uuid()`;
    - ISO timestamps print as `isoDate()`;
    - a `Date` prints as `isoDate()`.
  - **Typing:** two overloads, so type errors stay short. A Promise `actual`
    is awaited, and the method returns a Promise.
  - **`checkText`:** wraps today's `inspect` unchanged.
- **Vocabulary lock-ins:**
  - Methods: `t.check`, `t.checkText`, `t.checkThrows`.
  - Patterns and markers: `any`, `anything`, `uuid`, `isoDate`, `oneOf`,
    `optional`, `str`, `others`, `notAllowed`.
  - Refinements: `.startsWith`, `.endsWith`, `.includes`, `.matches`,
    `.int`, `.between`, `.positive`, `.closeTo`.
  - Capture: `capture(pattern)` and its `.value`.
  - Collections: `unordered([...])`. It was added from the generative
    review: a multiset match that keeps multiplicity.
- **First implementation chunk:**
  - Patterns, matcher (with the value boundary above), diff, suggestion, and
    the three tap methods, with `agent-doctest/test/check.test.ts`.
  - A type-test file of `@ts-expect-error` lines for a misspelled key, a
    missing key, a wrong leaf type, and `any(String)` in a number position.
  - The three hand-converted beebox tests ported to the final API.

### Track 1a — lint rules and observation helpers

Decided with the boxholder on 2026-10-18, after the generative review:
- **Lint rules:** "6 is very good, that's really happened".
- **Observation helpers:** "1 is useful, and should hopefully exist and be
  adapted".

- **What:** two lint rules, and two helpers that turn an HTTP response or a
  command run into one checkable value.
- **Why.**
  - Agents write `void` in front of a promise-returning check, and lossy
    checks such as a length, a JSON string, or a boolean.
    `no-floating-promises` (`personal-vibe-check/preset.ts:718`) does not
    flag `void x`, which is its documented escape hatch.
  - Route tests read bodies as `unknown`, so their expected values are never
    typed.
  - CLI tests hand-roll their spawns: 178 `spawnSync`/`execFileSync`/`execa`
    calls in 59 doctests (grep, 2026-10-18). The issue
    `2026-10-13-shared-helper-spawn-bin-ts-from-doctest` asks for a shared
    helper.
- **Direction: lint.** The rules ship from agent-doctest as an ESLint plugin
  (`agent-doctest/eslint`), enabled on beebox test files.
  - `agent-doctest/no-voided-check`: `void t.check…(...)` is an error. Await
    it.
  - `agent-doctest/check-whole-value` flags these as the actual argument of
    `t.check`:
    - a comparison (`a === b`);
    - `.length` or `.size`;
    - `JSON.stringify(...)`;
    - `!`, `!!` or `Boolean(...)`;
    - `.includes`, `.has`, `.some`, `.every`, `.startsWith` or `.endsWith`.

    Each message names the whole-value form. A field check that really is
    the contract carries an `eslint-disable-next-line` with its reason,
    which is the repo's existing exception.
- **Direction: helpers.**
  - **HTTP:** `TestServer.request` already returns `{ statusCode, body }` and
    `rawRequest` returns `{ statusCode, payload, headers }`
    (`beebox/test/helpers/doctest-server.ts:36-45`). A new `response(opts)`
    returns `{ status, headers, body }`.
    - The body stays `unknown`. A schema-parsed variant was built and then
      dropped, because Zod's `object` parse removes unknown keys and so
      would hide extra fields from an exact check.
    - Typed route bodies remain a known gap. tRPC tests are typed through
      their callers.
  - **CLI:** a new `runCommand(argv, { cwd, env })` returns `{ exitCode,
    signal, stdout, stderr }`, and resolves tsx the way the issue describes.
- **First implementation chunk:** both lint rules with RuleTester tests, and
  `runCommand` with its test.

### Track 1b — cutover notice and guard

- **What:** dated, prominent instructions that new tests are `.test.ts` with
  `t.check`, plus a pre-commit guard that rejects any newly added
  `.doctest.md`. Both land on main together with track 1, after track V's
  gate passes.
- **Why:**
  - Conversion takes days. During that time, most feature work still meets
    doctests next to the code it changes.
  - *"Haiku copies neighbouring files"* (`doctest-usability.md:233-235`), and
    any agent may copy them. A notice without a guard is convention
    (principle 11).
- **Direction:**
  - **Cutover date:** the day tracks 1 and 1b land on main, after the
    phase 1 gate. The notices give it as an absolute date.
  - **The notice reads:**
    > **Testing cutover (since <date>).** Write new tests as `.test.ts` with
    > `t.check` ([docs/testing/check.md](…)). Do not create `.doctest.md`
    > files; pre-commit rejects them. Existing doctests are being converted
    > (plan `retire-doctest`). If your change affects an existing doctest,
    > edit the doctest in place; the conversion picks up your edit. If git
    > reports a modify/delete conflict on a doctest that was converted, run
    > `node agent-doctest/bin/doctest-to-ts.ts <file>` on your version.
  - **Where the notice goes.** At the top of each file, so it is read
    before anything else:
    - `beebox/AGENTS.md`, replacing line 19;
    - the root `AGENTS.md` "Where to work" doctest line;
    - `beebox/docs/testing.md`, replacing line 21;
    - `beebox/.claude/rules/doctest.md`, which loads whenever an agent opens
      a `.doctest.md`;
    - the `doctest` skill;
    - `agent-doctest/README.md` and `docs/syntax.md`;
    - `bin/AGENTS.md:8`;
    - `scan-uploader/AGENTS.md`.
  - **New file:** `beebox/docs/testing/check.md`, the reference for
    `t.check`, the patterns, and `t.check(x)` for a suggestion.
  - **Guard:** `.husky/pre-commit` fails when `git diff --cached
    --diff-filter=A` lists a `*.doctest.md`. The message prints the notice.
    Renames and edits pass, so in-place edits and layout moves still work.
  - **Removal:** track 6 replaces all of these notices with the final
    testing docs, and removes the guard together with the doctest
    tooling.
- **Vocabulary lock-in:** the notice text, and the name `docs/testing/check.md`.
- **First implementation chunk:** the notice in every listed file, the new
  check reference page, and the guard with a `bin/` test. It lands with
  track 1 after the phase 1 gate.

### Track 2 — test typecheck programs and the converter

- **What:**
  - A TypeScript program for every test root that lacks one.
  - `agent-doctest/bin/doctest-to-ts.mjs` (logic in
    `src/doctest-hooks/doctest-convert.ts`), which converts one doctest to
    one test file plus its fidelity manifest.
- **Why:**
  - 12,478 expected values and 7,925 executable examples are too many to
    convert by hand or by model without drift.
  - A converted file that no program typechecks would lose the type checking
    doctests have today.
- **Direction: typecheck programs.**
  - Done (8a93e3ea7): `beebox/src/frontend/tsconfig.test.json` (the app plus
    `test/`) is what `typecheck:frontend` checks. workstreams-app adds its
    `test/server`, `test/shared` and `test/scenarios` to the backend program
    and `test/frontend` through `src/frontend/tsconfig.test.json`. browse and
    agent-doctest include all their tests; agent-doctest's 70 older test
    errors this exposed were fixed.
  - Existing coverage stays for beebox `test/`, the root `bin/`, and
    `scan-uploader/`.
  - Frontend lint already covered `test/` (main, 2026-10-16). The
    agent-doctest rules now load in `beebox/src/frontend/eslint.config.ts`;
    beebox's own config ignores `src/frontend/**`, so its frontend pattern
    never applied.
  - `bin/test-roots.ts` lists each test root, where it runs from (`bin/test/`
    runs from beebox), and its typecheck script. The driver, pre-commit, and
    track 6 use that list.
- **Direction: the converter.** It is mechanical and exact. It never changes
  an assertion's strength.

  | Doctest | Test file |
  |---|---|
  | H1 and opening prose | file header comment |
  | Prose between fences | `//` comments in place |
  | Setup blocks | module-level code, verbatim, including top-level `await` |
  | Imports inside an example | the existing `rewriteImports` output: dynamic `await import()` in source order, not hoisted |
  | A plain block plus its `continue` blocks | one `test("<name>", async (t) => { … })` |
  | `expr` / `=> text` | `await t.checkText(expr, \`text\`)`, backticks, backslashes and `${` escaped. `checkText` ignores a string's trailing newlines, as the runtime's trim did |
  | `=> throws Name: msg` | `await t.checkThrows(async () => expr, "Name: msg")`; an expected text with a `:` but no `: ` passes `{ expected, mode: "full" }`, since the runtime read any `:` as full mode |
  | Statement examples (2,370) | verbatim, with no generated line between a statement and the next example (`doctest-emit.ts:69-73`) |
  | `print()` | a per-test `const out = printed(); const print = out.print;`; each check in that test becomes `await t.checkText(out.with(expr), …)`, reproducing `doctest-runtime.ts:171` |
  | `cleanup` | `t.teardown(async () => { try { … } catch (e) { t.error(e) } })` at the runtime's registration point |
  | `teardown` | `tap.teardown(async () => { … })` on the root test, as the runtime did; tap's `after()` waits for the root test to end, which an open server prevents |
  | `eventually`, `printed` | imported from `agent-doctest/check` |
  | Type-only imports in an example | hoisted to module-level `import type`, as the doctest typecheck does |
  | Setup that declares `t` | the callback parameter is named `tap` |
  | A name the converter adds (`tap`, `out`, `printed`, `test`) that the doctest already uses | the added name gets a number (`tap2`, `out2`); a setup that declares `test` gets `tapTest` |

  - Test names come from the first sentence of the prose just before the
    block, cut to 80 characters; a heading often covers several blocks.
    Without prose, the nearest `##` heading. Without that, `line N`. A
    repeated name gets ` (line N)`.
  - The file header comment is the title and the prose before the first
    block, except that an example block keeps its own last paragraph.
  - **Dropped behavior:** the per-example "still running" notice
    (`doctest-runtime.ts:145`). It is a diagnostic, not an assertion. Tap's
    300 s file timeout still ends a hang, and the stack names where. The 5
    `timeout=` blocks become comments.
  - **Fidelity manifest:** each example's source line, kind, and expected
    text. The converter writes a `// doctest:L<n>` marker comment before each
    example it emits.
  - **Statement examples:** a marker goes before its example, except that
    when an example is the second part of a statement a blank line split, its
    marker waits until the statement's brackets close.
- **Vocabulary lock-ins:**
  - The `.doctest.md` → `.test.ts` name mapping.
  - `printed()`.
  - The `// doctest:L<n>` marker. Phase 3 workers may remove markers only
    together with the check they mark, and only when merging.
- **First implementation chunk:**
  - The frontend `tsconfig.test.json` and `bin/test-roots.ts`.
  - The converter for setup, plain, and `continue` blocks, checks, throws,
    statements, cleanup, teardown, and `print`.
  - Golden tests on 10 fixture doctests covering each census feature.
  - A run over all 1,092 files in a scratch copy, reporting files that fail
    to generate, typecheck, pass, or lint, and lint findings by rule.
- **Result (2026-10-18, converter at d2da6ab1f, scratch worktree).** All
  1,094 doctests (four hand-converted ones excluded) convert.
  - **Runtime:** 1,091 pass with tap's assertion count equal to the
    doctest's (1,089 match the manifest-derived count exactly; two,
    `natural-sort` and `history.path-forms`, differ from that formula but
    equal their doctests' own counts). The other three: two `test/manual/` files need real
    services and fail as doctests too; `codex-chat.failure-reporting`
    checks that a stack names its own `.doctest` file, so a worker must
    change that expected text (an exception to "checks are not edited").
  - **Typecheck:** 3 errors in 2 programs. `test/exports.test.ts` needs
    `build:declarations` first (the doctest script builds them); a frontend
    test that imports a backend route hits a DOM/Node `ReadableStream`
    clash; one file has unused callback parameters.
  - **Lint:** 569 files (52%) are clean. 2,043 findings remain in the
    others, almost all in the doctests' own code, which no lint checked
    before: literal error messages (275), `as` casts (112), unused
    variables (124), `max-params` (143), `max-lines` (51 files). 261 files
    have only one or two findings.
  - **Zero-model path:** the 569 clean files need no worker. The converter
    fixes that got there from 18 clean files: one-line expected text as a
    quoted string, setup imports hoisted, `import "agent-doctest/tap"` for
    types, root `teardown`, fresh generated names.
  - **Counted by assertion totals, not exit codes:** tap's junit output
    reported a file that failed to load as one skipped test. The driver's
    runtime fidelity must compare counts.

### Track V — destination validation (phase 1 gate)

- **What:** evidence that `t.check` is a sound destination before the
  cutover notice and before any conversion lands. The boxholder: "That's
  the big phase one: confirming we really do have a solid destination for
  rewriting these doctests to."
- **Why:** every later phase builds on it.
  - Phase 2 copies the API into 1,092 files.
  - The cutover notice sends every agent to it.
  - An API defect found after conversion costs a second migration.
- **Direction: four kinds of evidence.**
  1. **Behaviour tests** (track 1's `check.test.ts`), covering:
     - exactness: extra, missing and reordered keys;
     - `[others]`, `optional`, `oneOf` and refinements;
     - captures;
     - `Map`, `Set`, `Error`, `Date` and class instances;
     - unsupported values;
     - diff readability on nested values;
     - suggestion output for UUIDs, dates and nested arrays.
  2. **Differential translation test.**
     - Take a sample of about 60 doctests, chosen to cover each census
       feature, the 10 largest files, and typical files.
     - Run the converter and the upgrade pass over them.
     - For each check upgraded to typed `t.check`, mutate the actual value
       (change one leaf, add a key, drop a key, reorder an array, change a
       number's type). The typed check must fail in every case where the
       original text check fails.
     - Any case where the typed check passes and the text check fails is a
       defect in `check` or in the upgrade pass.
     - The test also reports which doctest expectations `t.check` cannot
       express, with counts by kind. These counts are the API gaps to close
       or to leave on `checkText` deliberately.
  3. **Mistake corpus.**
     - About 20 small test files, each with one realistic mistake: a wrong
       key, `any(String)` on a number, a missing `await`, `checkText` on an
       object, a pattern where a literal fits, a weak field check, a
       fabricated expected value.
     - Record what the type checker and the runner print for each. Rewrite
       any message that does not name the fix.
     - This follows `doctest-usability.md` evidence item 1.
  4. **Usability trials.**
     - Each task goes to Haiku, Luna and Sonnet (Sonnet as the reference),
       briefed as a normal session with no syntax hints beyond the repo
       docs: `docs/testing/check.md` and the notice.
     - Same method as `doctest-usability.md` evidence item 2.
     - Tasks:
       - T1: add tests for an untested pure function.
       - T2: add a route test with `makeTestServer`.
       - T3: a failing test; fix it from the failure output.
       - T4: convert one doctest to `.test.ts` by hand (stragglers and
         branches need this).
       - T5: fix lint and type errors in converter output without touching
         checks (the phase 2 worker task).
       - T6: strengthen a converted file's `checkText` and weak assertions
         (the phase 3 worker task).
       - T7: create a record, capture its id with `capture()`, then check a list
         that must contain it.
     - **Hidden mutants** (from the generative review): each task carries two
       to four planted bugs in the code under test, each tied to the task's
       contract. The tests a model writes run against each mutant, and a
       test that does not fail on a mutant missed it. Results are reported
       per mutant.
     - Scored per run:
       - whether it passes;
       - assertion strength: whole value or field checks;
       - type errors met, and how they were resolved;
       - misuse of `checkText` or patterns;
       - tool calls and reruns;
       - rule breaks: pnpm install, kill, or edits outside the task.
- **Rounds.**
  - After each round, fix the API, the messages, or `docs/testing/check.md`.
    Then rerun the affected tasks.
  - The phase 1 gate criteria, decided now:
    - The differential test shows no case where a typed check is looser
      than its text check.
    - In the last round, Haiku and Luna complete T1, T3 and T5 with no help.
    - Neither model writes a field-only check where the whole value was
      available.
    - Any task a model fails is assigned to the other model or to manual
      work in phase 2, with the reason recorded.
- **Gate status (2026-10-18, evidence in `bin/doctest-convert/TRIALS.md`).**
  - Differential: met. 0 looser cases over 31,470 mutated values.
  - Haiku completes T1, T3, and T5 with no help: met.
  - Luna completes T1, T3, and T5: T1 met. T5 nearly: in round 4 it left
    one `max-lines` finding (the file needs a split, a judgment the brief
    did not cover). T3 failed once with the plain brief because Luna did
    not run the test, and passed in two reruns and with the verify
    sentence. Luna does not run tests unless the brief
    says to. Every worker brief names its verify command, so phase 2 is not
    affected. Boxholder (2026-10-18): a brief that names the verify
    command counts as "no help". Met.
  - No field-only checks where the whole value was available: one case,
    Haiku's `t.ok(device)` before using a nullable value (T7); `check.md`
    now shows `capture()` for it. Luna's T6 checked each directive exactly
    rather than the whole policy, which the brief invited; T6b fixed the
    brief.
  - Fresh gate run (asked for by the generative review), at a6119b0db, every
    brief naming its verify step: Haiku and Luna both complete T1, T3, and
    T5. T5 came back lint- and type-clean from both, with every expected
    value and marker kept and no edits outside the batch. Mutants: Haiku
    4/4 and 4/4; Luna 3/4 on T1 (the slash-less key case again) and 4/4 on
    T3. Haiku ran `pnpm install` in an installed slot again (T1); the
    worker brief forbids it, and the driver should reject a batch whose
    transcript shows it.
  - Key order: 1,645 typed checks no longer assert the order the code
    built an object in (1,608 of them unwrapped `JSON.stringify`); no
    other loosening over 33,681 mutated values. Boxholder (2026-10-18):
    accepted; the order was incidental.
  - Assignments: every task to either model, with the verify command in
    the brief. T6 (strengthening) uses the whole-value brief: with it, Luna
    caught 4/4 mutants in both runs (T6b).
- **Generative reviews before and after.** These go beyond the adversarial
  reviews in the implementation order: the other model family is asked to
  add to the directions being considered.
  - **Before phase 1:** asked to propose additions and alternatives for the
    `t.check` API, the pattern vocabulary, the trial tasks, and the
    conversion approach, with the reason for each. Its proposals go into the
    trials as variants where they are cheap to test.
  - **After the trial rounds:** given the trial report and asked what the
    results suggest that the plan has not considered. This happens before
    the boxholder's phase 1 gate review.
  - Each review's answer and its adjudication are recorded in `TRIALS.md`.
- **Evidence location.**
  - The summary, a table per round, goes in `bin/doctest-convert/TRIALS.md`
    and is tracked.
  - Transcripts go in the worktree's gitignored `scratch/doctest-trials/`.
- **First implementation chunk:** the differential test over 10 sample
  files, after track 1's first chunk and track 2's converter.

### Track 3 — driver, worker slots, pilot, calibration

- **What:**
  - `bin/doctest-convert.ts` (temporary) runs the converter, verification,
    and workers.
  - A pilot over three directories, converted with the strong model as
    in-tree examples.
  - A calibration run of Haiku against Luna.
- **Why:** *"Haiku copies neighbouring files… Good examples in the tree matter
  more for the lighter models than any document."*
  (`doctest-usability.md:233-235`). The examples must exist before workers
  start.
- **Direction: paperwork in the tree.** All conversion state is tracked in
  git under `bin/doctest-convert/`. A reboot or a new session resumes from
  it, and other sessions can read it. Track 6 deletes the directory.
  - `state/<dir>.json`: manifests, source blob hashes, and status per file.
    The statuses are converted, verified, landed, and strengthened.
  - `PROGRESS.md`: a table of directories by status, regenerated by the
    driver after each batch.
- **Direction: driver commands.**
  - `prepare <dir>` runs the converter and writes the manifests.
  - `verify <batch>`, for each file:
    - **Static fidelity:** every manifest example appears once as its marker,
      and the expected value of each check (its last argument) is unchanged.
    - **Runtime fidelity:** the tap assertion count equals the manifest's
      check-and-throws count plus the number of tests, and the test passes.
      Counts, not exit codes: tap's junit output reported a file that failed
      to load as one skipped test.
    - The file passes eslint, run from the root's `lintFrom` directory, and
      the owning program from `bin/test-roots.ts`.
      Each program runs once per batch, serially, through its package's
      `typecheck` script. That script runs TypeScript 7 since the ts7
      merge (e.g. `beebox/package.json:71`). The driver never calls a
      compiler binary directly, and never inside a worker.
  - `dispatch <batch> --model luna|haiku` runs one worker in a free slot.
    - Luna runs as `codex exec -m gpt-6-luna -s workspace-write -C <slot>`.
    - Haiku runs as `claude -p --model haiku --tools Read,Edit,Bash`, with
      the slot as cwd.
- **Direction: worker slots.**
  - There are four dedicated git worktrees, made once with node_modules
    installed.
  - Before each batch, the driver resets the slot to the conversion branch
    tip.
  - After the worker, the driver runs `verify` inside the slot.
  - It rejects the batch if `git status` shows any path outside the batch.
    One worker per slot makes that check exact.
  - It commits in the slot, and applies that commit to the conversion branch
    serially.
- **Direction: zero-model path.** A converted file that passes fidelity,
  lint, and typecheck with no edits lands with no worker. Whether this path
  is real is measured by track 2's report: the share of files that convert
  clean. Repeated lint findings of one kind go back into the converter as
  a fix, not to workers.
- **Direction: phase 2 worker task.** Make the converted files pass lint and
  typecheck. Assertions are not changed.
  - **Allowed:** rename variables, extract helpers, add types, and remove
    unused code that lint flags. A checked expression may change only to
    satisfy lint and must keep its value: trial T5 showed lint findings
    inside checks (a callback parameter `t` shadowing the test's, `.sort()`,
    an `undefined` argument, a generic `Error` in a fake). Boxholder
    (2026-10-18): the `error/*` rules are off in tests and `undefined`
    arguments are allowed, so workers no longer meet those two.
  - **Not allowed:** editing an expected value or a `// doctest:` marker.
    `verify` enforces this. Runtime fidelity alone cannot show that an
    edited checked expression still observes the same thing, so `verify`
    lists every check whose expression changed, and the batch review reads
    those (Luna reported "no check changed" in T5 when three had).
  - **Brief:** edit only the batch; run the given verify command, one per
    test root's lint and typecheck program; no git, pnpm, rm, kill or pkill,
    and no subagents.
- **Calibration rule (decided now).** Run Haiku and Luna on the same 10
  files. Haiku takes a class of files if it verifies all 10 without a retry
  and the review finds no changed behavior. Otherwise that class goes to
  Luna. The classes are:
  - lint-only;
  - typing needed;
  - route tests.
- **Pilot across roots** (generative review): before calibrating by model,
  run `prepare`, `verify`, and one worker task on five to eight files that
  span test roots (frontend, `bin/test`, workstreams-app, scan-uploader,
  browse) and shapes (`print`, `continue`, `teardown` together).
- **First implementation chunk:** `prepare` and `verify`, with static and
  runtime fidelity, run over `beebox/test/lib/`.
- **Result, first chunk (2026-10-18).** `bin/doctest-convert.ts prepare`
  and `verify` (modules in `bin/doctest-convert/`), tried in a scratch
  worktree at 659167f78, nothing committed from the run:
  - `prepare` folds in the pipeline TRIALS.md section 1 measured, per
    directory: the doctests' own tap counts as the runtime baseline, the
    differential run, typecheck and lint loops, then eslint's layout fixes
    (`--fix-type layout`, which removed every `quotes` finding). It
    records each file in the state file before deleting its doctest, and
    skips a doctest with uncommitted changes or an existing test file the
    state does not record (`beebox/test/lib/box-slug`).
  - The state file keeps a hash of each check's arguments, not their text
    (120 KB for `beebox/test/lib`'s 41 files).
  - `beebox/test/lib/` plus the cross-root pilot (`browse/test`,
    `browse/packages/agent-browser-typed/test`, `scan-uploader/test`,
    `workstreams-app/test/shared`, `workstreams-app/test/frontend/main`, a
    frontend directory, `bin/test/lib`, `agent-doctest/test`): 42 of 83
    files verify with no worker. Every remaining problem is a lint finding:
    `max-params` 15, `security/detect-non-literal-fs-filename` 15 (all in
    `agent-doctest/test`), unused variables 11, `no-shadow` 8,
    `no-useless-escape` 8, `max-lines` 7, and smaller kinds. No file failed
    static or runtime fidelity.
  - `verify` refused a changed expected value and listed the changed
    actual; a lint fix verified.
  - Two Codex review rounds: 10 findings, 9 fixed (`git log` from
    4d74c8355). Accepted: a layout fix inside code that reads its own
    source (`fn.toString()`) changes that text without a failing check.
  - Next chunk: `dispatch` and the worker slots, then calibration on the
    41 lint-only files.
- **Result, slots and calibration (2026-10-18).**
  - `slots` makes four git worktrees with node_modules
    (`$DOCTEST_CONVERT_SLOTS`). `dispatch` resets one to HEAD, copies in the
    batch and the state files from the working tree (an unverified
    conversion cannot be committed: pre-commit lints it), runs the worker
    with the brief in `bin/doctest-convert/dispatch.ts`, rejects a
    forbidden command in the transcript or a change outside the batch, and
    then copies the batch back and verifies it here. `check` is `verify`
    without recording; it is the worker's one verify command. `--trial`
    checks in the slot and applies nothing.
  - Calibration, the same 10 `beebox/test/lib` files to each model:
    Haiku and Luna each verified 9 of 10 on the first run, without a
    retry. The 10th, `file-lock.test.ts`, has only `max-lines`, which no
    worker can fix inside its file. Every changed checked expression keeps
    its value (renames, `.sort()` → `.toSorted()`, `.join()` →
    `.join(",")`). Luna added one justified `eslint-disable-next-line
    max-params`; Haiku fixed the same code without one. The brief now
    forbids suppressions and `verify` refuses an added one. Haiku took 6
    minutes and $0.15 for the batch.
  - By the calibration rule, Haiku takes the lint-only class. The pilot
    produced no "typing needed" file (prepare keeps a typed check that
    fails typecheck as text) and no route-test file, so those classes are
    not calibrated yet.
  - End to end, without `--trial`: Haiku on four more files; all four
    were copied back and verified in the checkout (28 of 41 verified).
  - Two Codex rounds on `dispatch`: 13 findings, 11 fixed. Accepted and
    noted in the code: a worker's background process outliving the
    timeout; `--trial` running the slot's node_modules; two drivers taking
    over one stale lock at the same moment.
  - `max-lines`: a worker cannot fix it without a second test file.
    Boxholder (2026-10-18): the limit can be longer for tests, though past
    some length a file still needs a split. Test files now allow 600 lines
    (`personal-vibe-check/preset.ts`). Of the 73 converted files over 300,
    8 are over 600; those go to a split by hand in track 4.

### Track 4 — phase 2 bulk conversion

- **What:** convert every remaining directory with the driver.
- **Why:** this retires the format.
- **Direction:**
  - **Order:** the smallest directories first, then beebox `test/` by
    subdirectory, `src/frontend/test/`, `bin/test/`, workstreams-app,
    scan-uploader, and browse.
  - **Landing:** each verified batch group (one top-level directory) lands on
    main. This is decided now: holding 1,092 conversions on one branch while
    main keeps editing doctests collects conflicts. The boxholder's yes to
    this plan covers these landings.
  - **Before each landing:**
    1. The driver merges main into the conversion branch.
    2. It re-runs the census of that directory against the merged tree.
    3. It reconverts any doctest whose blob changed since its conversion,
       plus any new doctest. The manifest records the source blob hash.
  - **Gates:** a landing uses the finish flow and its checks.
  - **New tests:** the track 1b notice and guard are already on main, so
    new tests are `.test.ts` from the cutover date.
  - **Branches with doctest edits:** for a modify/delete conflict, a branch
    re-runs `doctest-to-ts <file>` on its own version. The notice says so.
  - **Doctest tooling stays in place** until the last doctest is converted.
    That includes the loader, `typecheck:doctest`, the skill, and the
    rules. Track 6 removes it in one step.
- **First implementation chunk:** none beyond track 3. This track repeats
  that chunk per directory.
- **Progress (2026-10-18):**
  - Small roots landed (98 files); `src/frontend/test` landed (195 of 200).
  - beebox `test/`: `prepare` converted 801. 488 verified with no worker;
    Haiku workers brought the total to 782 in three passes. Luna reviewed
    every worker diff: one finding, rejected (a `\[...]` regex rewrite that
    matches the same text). 14 verified files went back to doctests because
    the commit blocklist matches their fixture names and a common English word
    (some inside expected values); that needs a boxholder decision.
  - Left as doctests for hand work: 8 files over `max-lines` 600, 6 with
    other lint findings, the 3 `manual/` tests, `scripts/knip-doctest-imports`,
    `services/claude-chat/codex-chat.failure-reporting`, 4 whose test file
    already exists, and 3 that `layout-check` flags once they are TypeScript
    (two import `typescript` outside `src/lib/typescript/`; one uses a tour
    helper from outside `test/tours/`). `verify` does not run `layout-check`
    yet; the commit hook caught these.
  - Hand-work round (2026-10-18): the 8 files over 600 lines were split at
    `##` boundaries into 19 parts (leaf assertion counts match); the
    new-doctest guard refuses committing the parts, so `prepare
    --uncommitted` converts them from blobs it writes to the object store.
    The 14 blocklist files were converted after renaming their fixture
    people. Sonnet agents restructured the files the cheap workers could not
    (split long tests, options objects, typed fakes); test doubles of large
    interfaces are built with `Object.assign(Object.create(proto), …)`, the
    pattern `clerk.send.test.ts` already used, in place of `as` casts.
    The 4 doctests with track V hand ports were deleted (their tests cover
    them; `server.frozen-serve` gained one assertion). Manual tests convert
    but `verify` does not run them. `verify` now compares leaf assertions
    (subtests not counted), so splitting a test is not a count change.
    `cards/extend-schema` and `plugins/courseware/plugin.types` typechecked
    through the TypeScript 5 `typescript` package, which the layout rule
    keeps behind `src/lib/typescript/` (the TypeScript 7 boundary). They now
    use that boundary (`typecheckProject`, and a new `typecheckSource` for an
    in-memory fixture). TypeScript 7 prints union members and object
    properties in another order, so three expected messages changed to its
    text: the one exception to "expected values are not edited", recorded
    here and in the state's checks for those two markers.
    Left: `scripts/knip-doctest-imports` (track 6 removes the script it
    tests).
  - Driver changes from this round: `revert` now points references back at
    the doctest (before, `prepare`'s repoint stayed, so `test:manual` named
    missing files); `rm`/`kill` are forbidden only in command position, so
    `grep "rm\b"` no longer rejects a batch; `verify` accepts the repo's
    existing markdoc `import-x/no-named-as-default-member` suppression (the
    module is CommonJS; `src/core/body-markdoc-lint.ts:32` has the same line).

### Track 5 — phase 3: strengthen assertions

- **What:** turn `checkText` into typed `check` where the value is
  structured, and rewrite weak assertions as whole values.
- **Why:**
  - Typed expected values (principle 1).
  - The boxholder's "testing more". The census found weak forms that the
    doctest rules forbid, such as `JSON.stringify(...)`, `=== … => true`, and
    `x?.field`.
- **Direction:**
  - **Upgrade pass (deterministic): moved into the conversion.** The
    boxholder (2026-10-18): yes to `checkText` becoming `t.check` "as long as
    it's going to happen". Doing it at conversion avoids touching every file
    twice. `src/convert/upgrade.ts` parses each expected text
    (`parseLiteral`), maps wildcards (`«int»` → `any(Number).int()`,
    `«uuid»` → `uuid()`, `«date»` → `isoDate()`, a wildcard inside a string
    → a `str` hole), and unwraps a checked `JSON.stringify(x)` to `x`. A
    check stays `checkText`, with its reason in the manifest, when the
    differential run shows its typed form failing on the real value, when
    tsc rejects it, or when lint rejects it (a lossy actual value, or an
    expected `undefined`, until the boxholder exempted arguments from
    `unicorn/no-useless-undefined` on 2026-10-18). Result: 9,317 of 12,319
    checks typed
    (`bin/doctest-convert/TRIALS.md`).
  - **Workers then handle the judgment cases:**
    - the 1,583 lossy checks kept as text: `a === b` checked against
      `true` → `t.check(a, b)`; `.length` or `.includes()` → the whole
      value;
    - printed output and multi-line text that is really a value;
    - field reads → the whole object;
    - restating comments.
  - **A lint rule against `checkText` on an object** (boxholder: yes,
    2026-10-18) lands with this phase. Test lint has no type information
    (`personal-vibe-check/preset.ts` gives `projectService` to `src/**`
    only), so the rule needs it added for test files, or a runtime check in
    `checkText`. Either form fires on the converted checks kept as text
    for multi-line output, a failed typed form, or a structure, which are
    this phase's work list; enabling it earlier would make phase 2 workers
    do phase 3's work. `agent-doctest/no-tap-assert` (tap's own `t.equal`,
    `t.ok`, ...) is already on.
  - **Brief (trial T6):** "check the whole value the code returns". A brief
    that says "keep what each check covers" made Luna strengthen each check
    in place and miss what the doctest never named.
  - **Reviewed separately:** every phase-3 batch diff is reviewed by a
    model from the other family. It checks each change against one rule:
    the new check must fail wherever the old one failed.
    - A literal may become a pattern only where the value varies between
      runs. The worker shows two runs.
    - A merge of field checks into one whole check removes their markers
      together.
  - **Landing:** phase 3 lands per directory. It can pause at any directory,
    because phase 2 already retired the format.
- **Measure gains, not only preservation** (generative review): one
  held-out file per common weak form (field read, `.length`, equality
  boolean, printed structure), each with hidden mutants; phase 3 reports
  mutants newly caught. 9,317 typed checks is a conversion count, not a
  strength result.
- **First implementation chunk:** the phase 3 worker brief and its review
  rule, on the lossy checks in `beebox/test/lib/`.
- **Progress (2026-10-18): done.**
  - **The gate is the type, not a lint rule.** `t.checkText(actual: string |
    PromiseLike<string>, expected: string)`: every non-string actual became a
    type error (2,390 sites in 555 files), which was the work list. Lint
    without type information could not see the actual's type; the signature
    can. `check-whole-value` now also sees through `?.`, `await`, `!`, `as`,
    `satisfies` and `<T>x`, which added 112 findings.
  - **Workers:** Sonnet subagents, one batch of 7–18 files each, 41 batches
    in six waves, with one brief (check the whole value; the new check must
    fail wherever the old one failed; a self-check over every removed
    `===`, `instanceof`, `indexOf` and bound). The driver from track 3 was
    gone, so batches went through the Agent tool in this worktree, and each
    wave was committed between waves (the commit hook typechecks the working
    tree).
  - **Review:** codex `gpt-6-luna` reviewed the pilot and each wave against
    the fidelity rule. Its regressions were all of three kinds, and each
    became a tool or a brief rule: identity (`a === b` on objects became a
    value check), class (`instanceof` became a name check), and strict
    bounds (`< n` became an inclusive `between`). codex `gpt-6-sol` reviewed
    the tool changes; its accepted findings are fixed.
  - **Tools added to `agent-doctest/check`:** `not(x)` / `not(pattern)`,
    `is(x)` (identity), `instanceOf(C)`, `.below(n)` / `.above(n)`; an
    optional key typed `k?: V | undefined` takes `k: undefined`.
  - **Text comparison is text only.** The comparer lost its value paths
    (serializers, JS-literal expected text, function-with-print actuals,
    labels, returned extractions, `«show»`); `agent-doctest/src` went from
    about 2,800 to 2,170 lines. `checkThrows` now fails when nothing throws
    even against a wildcard, and a rejected checked promise is a failed
    check.
  - **Result:** `checkText` calls 3,078 → 709 (all on text); `t.check`
    9,465 → 11,619; one `check-whole-value` disable, with its reason.
  - **Gains measured.** Round 1, four small pure modules whose old checks
    already compared concrete text: 32 mutants, old and new both caught 25.
    Round 2, four modules whose old checks read a predicate or length of a
    larger result, with mutants aimed at the parts those checks skipped:
    old caught 8 of 32, new 19, none lost.
  - **Found by stronger checks:** `bbx pub` printed "publication URL" twice
    (fixed); the Google Calendar `.ics` time-zone bug
    (`issues/bugs/2026-10-18-calendar-ics-labels-unconverted-time-with-event-zone.md`);
    a no-op test in `mention-apply.test.ts` (fixed).
  - **Left as is:** large generated text (pages, prompts, scripts) keeps
    narrow `any(String).includes(...)` checks; `test/manual/` files were
    typechecked and linted but not run; `// doctest:L` markers remain where
    their checks were not merged (12,154).

### Track 6 — remove doctest

- **What:** delete the format and every tool that knows it, once phase 2 has
  converted the last `.doctest.md`.
- **Why:** each remaining reference is a maintained adapter (principle 8).
- **Direction,** from the inventory of 2026-10-17:
  - **Runner config:**
    - Remove the loader preloads: `beebox/.taprc:12-13`,
      `agent-doctest/.taprc:6`, and the browse, scan-uploader, and
      workstreams-app `.taprc` files.
    - Replace the `*.doctest.md` include globs with `*.test.ts` / `*.test.tsx`.
    - Change `beebox/package.json:86` `test:manual` to name the three
      converted files.
    - Update `beebox/test/careful.txt:18-19` to the new paths.
  - **Selection, ledger, and tiers:**
    - Remove the doctest typecheck branch at `bin/test-select.ts:180-182`.
    - Remove the doctest plugin at `bin/test-graph.ts:86-90`. Move
      `candidateFiles`/`isRelative` (imported at `bin/test-graph.ts:21` from
      `agent-doctest/src/doctest-hooks/resolve-rules.ts`) to
      `bin/lib/resolve-rules.ts`.
    - Remove the doctest handling at `bin/test-graph-query.ts:52` and
      `bin/test-graph-cache.ts:69-71`.
    - Remove the doctest alternatives from `bin/test-tiers.ts:26,84` and
      `bin/test-ledger-lib.ts`.
    - Update the fixtures in `bin/test-*.test.ts`.
  - **Pre-commit:** replace `.husky/pre-commit:127-129` and
    `bin/doctest-typecheck-staged.ts` with a staged-test typecheck over
    `bin/test-roots.ts` programs, unless the existing per-package typecheck
    already covers them.
  - **Full-suite schedule:**
    - Remove `schedules/full-suite/doctest-typecheck.ts`, its condition at
      `run.ts:226-237`, and the `"doctest-typecheck"` alert kind at
      `trust.ts:142`, with their tests.
    - Test typechecking joins the existing typecheck condition.
  - **Typecheck adapter:** remove the `typecheck:doctest` scripts in five
    packages and `agent-doctest/bin/doctest-typecheck.mjs`.
  - **agent-doctest package:**
    - Delete `src/doctest-hooks/`, `src/doctest-loader.ts`, `src/typecheck/`,
      and its 3 doctests.
    - Remove the `./loader`, `./hooks`, `./resolve-rules`, and `./typecheck`
      entries from the `exports` map (`agent-doctest/package.json:9-16`), and
      the `bin` entry.
  - **Other tools that read doctests:**
    - knip (6.x since the 2026-10-17 upgrade): `knip.ts:2,25-26,51,59,176`
      and `knip-doctest-imports.ts`.
    - doc-check: `beebox/src/dev/doc-check/check.ts:71-168` and
      `doc-graph-data/data.ts:22`.
    - Layout tools: `beebox/src/dev/layout/` (`graph.ts:16`, `scan/package/`,
      `move/apply.ts:20`, `move/doctest-edit.ts`).
    - Metrics: `bin/project-size.ts:38,224-233`.
    - `bin/finish-preflight-lib.ts:134`.
    - `schedules/retrospective/lib.ts:112`.
    - `schedules/cross-box-leak-scan/run.ts:47` and its prompt.
  - **Helper renames:** `doctest-helpers.ts` → `test-helpers.ts`, and
    `doctest-server.ts` → `test-route-server.ts`, across their importers.
  - **Docs and agent instructions:**
    - The `doctest` skill becomes a `tests` skill.
    - `beebox/.claude/rules/doctest.md` becomes `rules/tests.md` for
      `**/*.test.ts{,x}`.
    - `beebox/docs/testing.md:21`.
    - `docs/testing/doctests.md` is replaced by `docs/testing/check.md`.
    - `docs/testing/tap-tests.md`.
    - Agent and contributor docs: `beebox/AGENTS.md:19`, `bin/AGENTS.md:8`,
      `scan-uploader/AGENTS.md`, `src/services/AGENTS.md:44,78,87`,
      `CONTRIBUTING.md:28,56`, and `README.md:48`.
    - `agent-doctest/README.md` and `docs/`.
    - `site/docs` and `site/docs-manifest.yaml:213-215`.
    - `.claude/skills/bbx-plan/TEMPLATE.md:162,167,177`.
    - Other skills that name doctests: `bbx-guide-api`, `security-report`,
      and `field-probe`.
  - **Cutover:** remove the track 1b notices, the added-doctest guard, and
    the `bin/doctest-convert/` paperwork (state and `PROGRESS.md`).
  - **Knowledge audit:** rewrite `dev-doctest-unrunnable-value`
    (`knowledge-audits.yaml:8561`).
  - **Path comments:** the 61 source lines that name a `.doctest.md` path get
    the new path, from the converter's rename map.
- **First implementation chunk:** the runner-config edits, plus the
  selection, ledger, and tiers branches with their `bin/` tests.

- **Progress (2026-10-18): done.** The last doctest (`scripts/knip-doctest-imports`)
  went with the script it tested. Four agents took one area each; the
  helpers were renamed after (`test-helpers.ts`, `test-route-server.ts`).
  Decisions made on the way:
  - No staged-test typecheck in the hook: each package's typecheck program
    already includes its tests (`bin/test-roots.ts`).
  - The full-suite schedule's doctest typecheck became a full typecheck
    (`schedules/full-suite/typecheck.ts`): `pnpm typecheck` at the root and
    in every workspace package with the script, a held condition as before.
    A commit's hook typechecks only the packages it touches.
  - beebox `typecheck:backend` builds the export declarations first:
    `test/exports.test.ts` imports `beebox/cards` through `dist/*.d.ts`,
    which only `typecheck:doctest` used to build.
  - `bin/test-graph-fixture.ts` resolves its temp root's real path; the old
    doctest plugin had hidden that esbuild reports importers by real path
    (issue filed for a symlinked checkout).
  - The `// doctest:L<n>` markers stay in the tests for track 5, which reads
    them against the conversion record in git history.
  - Temp boxes keep the `bbx-doctest-` prefix: tests, the sweep, and issues
    name it.

## Could this be simpler?

- **The simplest version:** stop new doctests and leave the rest (the rule
  change in track 4).
  - It fails principle 8: two test formats stay forever, along with the
    loader, the typecheck adapter, line maps, the knip compiler, and the
    layout tooling.
  - 12,478 expected values stay unlinted.
- **The next simplest: phase 2 only** (tracks 1–4 and 6, all `checkText`).
  The plan is built so this is a complete stopping point. Track 5 is
  separate and can pause at any directory.
  - What track 5 adds: typed expected values (principle 1) and whole-value
    rewrites, the boxholder's "testing more".
  - Phase 2 still needs model work, because pre-commit lint requires every
    converted file to pass. Track 2's report sizes that work before track 3.
- **Not added:**
  - a second runner;
  - inline write-back;
  - `ref()` captures;
  - predicate patterns;
  - a package rename.

## Subplans

None. The converter mapping is in track 2, and the census numbers it covers
are in this plan.

## Failure modes

> **Critical gap:** none open.
> - A check dropped in phase 2 is caught by the static and runtime fidelity
>   checks in `verify`.
> - A weakened check in phase 3 is caught by reviewing every phase-3 diff.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Converter drops a statement example (no `=>`, so no assertion) | golden fixtures | static fidelity: every manifest example has its marker | clear |
| Converter drops or alters a check | golden fixtures | static (marker plus unchanged expected text) and runtime (assertion count) fidelity | clear |
| Phase-2 worker edits a check while fixing lint | none | `verify` rejects any change to `t.check*` lines or markers | clear |
| Phase-3 worker weakens a check (literal → pattern, smaller value) | none automatic | every phase-3 diff reviewed by the other model family against "fails wherever the old one failed"; two-run evidence for new patterns | clear when reviewed; a reviewer miss is the accepted residual |
| An unawaited async check finishes after its test | golden fixture | every converted check is `await`ed (`doctest-emit.ts:77`) | clear |
| Import order changes side effects | golden fixture | example imports stay dynamic, in place | clear |
| `continue` scope redeclares a `const` | golden fixtures | compile error | clear |
| Cleanup order changes | golden fixture for a cleanup before the first test (`doctest-generate.ts:164-165`) | same registration point as the runtime | clear when it throws; a leaked temp dir is silent (as today) |
| `print()` output joined differently | golden fixture | `out.with()` reproduces `__doctest_withPrints` | clear |
| A converted file is typechecked by no program | track 2 report | `bin/test-roots.ts` maps every root to a program; `verify` runs it | clear |
| A worker edits outside its batch, or runs pnpm/rm/kill (`doctest-usability.md:246-249`) | none | one worker per slot worktree; `git status` in the slot rejects outside paths; damage stays in the slot | clear |
| main changes a doctest after its directory was converted | none | merge main and reconvert changed blobs before each landing | clear |
| `check` passes two different `Map`s as empty objects | `check.test.ts` | `Map`/`Set` compared by entries; unsupported values fail by path | clear |
| `Expected<T>` too deep on large types | type test on the card schema config type | plain mapped type | clear (tsc error) |
| An agent copies a nearby doctest and adds a new `.doctest.md` during the conversion | guard test (track 1b) | the pre-commit guard rejects added `.doctest.md` and prints the notice | clear |
| A JSX-bearing doctest emitted as `.ts` | converter test | `.tsx` when the code has JSX | clear |

## Agent-flow / user-flow edge cases

- **Wrong form: `checkText` on a structured value in a new test.** ADDRESSED:
  the rules file says to use `check` for values and `checkText` for command
  output. Phase 3 converts the legacy uses.
- **Wrong matcher: `any(String)` in a number position.** ADDRESSED: it is a
  type error (track 1 type tests).
- **Stale reference to `foo.doctest.md`.** ADDRESSED in track 6 by the rename
  map, and `pnpm doc-check` catches broken links.
- **Two agents on the same file.**
  - ADDRESSED within the conversion: one worker per slot, disjoint batches,
    commits applied one at a time.
  - From other worktrees: the reconversion step before each landing.
- **Hand-edit drift: someone uses the old string form.** `checkText` is named
  differently, and the choice is visible. No lint rule.
- **Fabricated expected value.** ADDRESSED: `t.check(x)` prints the real
  value, and the rules file says to run it.
- **Validation error UX.** ADDRESSED: overloads give one-line type errors
  (spike, 2026-10-17: `Property 'exp' is missing`, `'deviceID' does not
  exist`).
- **Partial migration.** ADDRESSED.
  - Both formats run under the same `.taprc` until track 6.
  - Selection, ledger, and tiers accept both today.
  - `typecheck:doctest` keeps checking the remaining doctests until the last
    is gone.

## NOT in scope

- **The tsx per-process cost** (a cache of 205,036 files, 1.5 GB, and native
  type stripping). It belongs to `2026-08-09-test-suite-per-file-cost-floor`.
- **Moving `node:test` files** in `bin/`, `site/`, `canvas-loop/`, and
  `schedules/` to tap. That is another runner question, and it is not
  needed to retire doctest.
- **Renaming the `agent-doctest` package.** It is a deploy path
  (`bin/deployed-paths.ts:22`, `beebox/deploy/deploy.sh:507`). A rename is a
  later chore.
- **Inline write-back of suggestions.** The agent pastes after reading.
- **Removing weak or redundant tests**
  (`2026-10-08-remove-tests-that-never-earn-their-keep`). Workers strengthen;
  they do not delete.
- **A lint rule against `checkText` on structured values.** Wait to see
  whether it is misused.
- **The "still running" per-example notice.** Dropped in track 2, with the
  reason given there.

## Open design questions

1. **Lint rules that read wrong on test code** (for example `max-params` on
   test helpers).
   - Lean: fix the code.
   - Ask the boxholder about any rule whose findings, after conversion, are
     dominated by one test pattern.
   - Track 2's report gives the data. This is settled before track 3.
2. **Restating prose comments.** Lean: phase-3 workers delete comments that
   restate the code, and keep the contract and incident notes.

## Knowledge audits

The new concept is how to write a test here: `t.check`, the patterns, and
`t.check(x)` with no expected value. `dev-doctest-unrunnable-value`
(`knowledge-audits.yaml:8561`) is rewritten as `dev-test-check-value`, asking
for a `.test.ts` for `contentHash`. It lands run, in track 6.

## What will hold this after it ships

- **`check` behavior:** `agent-doctest/test/check.test.ts`, covering exactness,
  `[others]`, captures, `Map`/`Set`/`Error`/class instances, unsupported
  values, diffs, and suggestions.
- **Typing:** the `@ts-expect-error` type-test file, under agent-doctest's
  `tsc`.
- **Test code:** the per-root programs from `bin/test-roots.ts` and eslint.
- **The converter, driver, and upgrade pass** are deleted. Nothing needs to
  hold them.

## Implementation order

1. **Phase 1, destination.** Nothing lands on main until its gate passes.
   1. Track 1, `check`. It includes the ACKNOWLEDGEMENTS.md entries
      (Jane Street, matklad) and porting the three hand-converted tests.
   2. Track 2's converter and its golden fixtures, which the differential
      test needs.
   3. Track V: the generative review before phase 1, then the differential
      test, the mistake corpus, and the usability trial rounds, with API and
      doc fixes between rounds. Then the generative review after the
      trials.
   4. Track 2's full report over all 1,092 files. Open question 1 is
      settled here.
   5. Boxholder review of the trial report: the phase 1 gate.
   6. Cross-model review of `check`, then tracks 1 and 1b land on main
      together. That day is the cutover date.
2. **Track 2's typecheck programs,** if they did not land with step 1.
3. **Track 3, driver and slots.** Then the pilot exemplars and calibration.
4. **Track 4.** Phase-2 conversion, landing by directory.
5. **Track 6, removal,** once no doctest remains.
   - Runner and tooling go first.
   - Then the agent-doctest internals.
   - Then the docs, skills and rules, the track 1b notices and guard, the
     audit, and the `bin/doctest-convert/` paperwork.
6. **Track 5, phase 3,** by directory. It can begin after a directory's
   phase-2 landing.
7. **Cross-model review** of the authored code (tracks 1, 2, 3, 6) before
   track 4's first landing and before track 6 lands.

## Rollout shape

**Done when these pass:**
- `agent-doctest/test/check.test.ts` and the type-test file.
- The converter's golden fixtures.
- For every converted file:
  - static and runtime fidelity;
  - eslint;
  - its owning program from `bin/test-roots.ts`;
  - tap.
- The full suite on the final tree, green in the hourly run.

**Knowledge audit:** `dev-test-check-value` lands run in track 6.

**Migration:**
- **Method:** scripted conversion plus agent cleanup, gradual by directory.
- **Transition state:** both formats run together. This state is designed,
  and it can stop at any landed directory.
- **Phase 3** is independent, and it can stop at any directory.

**Boxholder check-ins:**
1. After track V's trials and track 2's report over all 1,092 files: the
   phase 1 gate. The boxholder reviews the trial report and decides any lint
   rule question (open question 1).
2. After the pilot and calibration. The boxholder reads the example
   directories and the Haiku/Luna results, and approves the converted style.
3. After the first phase-2 landing on main.
4. Before track 6 removes doctest.

Between check-ins 3 and 4, landings proceed. Each landing posts a
one-paragraph summary: the files, any fidelity rejections, and any batch
moved to a stronger model.

**Stop and re-plan when:**
- more than 1 file in 10 in a batch fails fidelity, which points to a
  converter bug;
- workers in one class of files keep needing retries;
- a third fix to the same problem fails.
