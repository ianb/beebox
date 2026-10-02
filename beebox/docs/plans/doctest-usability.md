---
title: "Doctest usability: errors that teach, comparisons that show values, a runner that names what hung"
status: partial
workstream: doctest-usability
issues:
  - ../../../issues/closed/exploration/2026-09-27-doctest-usability-review.md
---
# Doctest usability

Doctest is the repository's default test form: 1,004 `.doctest.md` files and
12,521 `=>` assertions, written almost entirely by agents. This plan reports a
usability review of doctest (evidence below) and proposes changes to the parser,
the comparison and diff, the runner, and the guidance. Nothing here is
implemented; each track needs the boxholder's approval first.

**Issues addressed:**
[doctest usability review](../../../issues/closed/exploration/2026-09-27-doctest-usability-review.md).
Related, not closed by this plan:
[convert `*.test.ts` to doctests](../../../issues/code-quality/2026-09-27-convert-test-ts-files-to-doctests.md)
(this plan supplies its fit guidance, see Track F), and
[beebox `test/` is never type-checked](../../../issues/code-quality/2026-08-25-beebox-scripts-and-test-untypechecked.md)
(doctest code blocks are also never type-checked; see NOT in scope).

## Evidence

Five sources. Scratch material lives in the gitignored `scratch/doctest-usability/`
and `beebox/test/_usability/` directories of the `doctest-usability` worktree.

1. **Mistake corpus.** 27 small doctests, each with one known or suspected
   mistake, run through `beebox/.taprc`. Outputs in
   `scratch/doctest-usability/corpus-out/`.
2. **Usability test.** 7 test-writing tasks, each given to Haiku 4.5 and to
   Sonnet 5.5 (14 runs), briefed as a normal session would be: "add doctest
   coverage for X", "this doctest fails, fix it", "convert this `*.test.ts`".
   No syntax hints. Transcripts were scored for runs, failures, and edits.
3. **Corpus statistics** over all 1,004 tracked doctests.
4. **Flake history**: every flake and timeout incident in `issues/` and
   `issues/closed/`, classified runner-caused vs test-caused.
5. **Literate-use grading** of 25 random doctests, and a shape classification
   of the 132 remaining `*.test.ts` files.

6. **Session transcripts.** Real Claude sessions in the beebox and callback
   project directories, and Codex sessions under those checkouts, searched for
   doctest failure signatures. Counts are distinct sessions.

The statistics in this document come from `grep` over `git ls-files
'*.doctest.md'` on 2026-09-28 (see "Counting method" at the end).

**Real sessions show the same failures as the test subjects, at larger scale.**
An esbuild "Transform failed" on a `.doctest.md` is the most common doctest
authoring failure: 60 Claude sessions and 38 Codex sessions. Classified by the
error's `lineText`:

- About 20 sessions: a multi-line statement (`try`, `for`, a brace-bodied
  arrow) before the checked expression, which the splitter cuts in the middle.
  Agents blamed template literals, comments, or blank lines first. Recovery
  took 3 to 20 or more tool calls.
- About 10 sessions: a blank line inside a multi-line expected value, or
  prose left in a fence.
- About 8 sessions: an `import` in an example block instead of `setup`
  (`Unexpected "{"`).
- 5 sessions: a redeclared identifier, including `t`.

The reported line number is a generated-code line in every case. The one
useful clue, the esbuild `lineText` field, sits in a multi-line error object
above the TAP block. Agents pipe test output through `head`, `tail`, or `grep`
in 166 of 174 sessions, which usually drops it. The file then shows only
`1..0 # no tests found`, seen in 73 Claude and 163 Codex sessions. Across
2,097 (session, file) pairs, a file was run 2.3 times on average; many reruns
differ only in the output filter.

### Findings, by the review's four questions

**Writing: agents break layout rules that the parser infers from line shape.**

| Mistake | Where seen | What the agent sees today |
|---|---|---|
| Object expected written as a JS literal or compact JSON (`=> { kind: "box" }`) | 3 of 14 subject runs; T1 Haiku failed 16 of 19 examples, T6 Haiku about 60 | A line diff of pretty JSON against the one-line literal. Every agent "fixed" it by wrapping in `JSON.stringify`, which is why 2,983 doctest expression lines start with `JSON.stringify` |
| No blank line between two examples | issue evidence; planted in T5, both subjects | The second expression appears inside "expected" in the diff. Haiku then split every example into its own `ts continue` block instead of adding a blank line |
| Prose inside a fence | memory note (3 times, one session); planted in T5 | esbuild `Expected ")" but found "we"` at a line number from the generated code, with the generated line `await t.check(__withPrints(__prints, Now we sort…` and ~50 lines of esbuild stack and tap arguments |
| `try {…} catch {…}` or `if {…}` directly before the checked expression | T4 Sonnet (new) | esbuild `Unexpected "}"`. The splitter (`doctest-generate.ts:54-60`) treats the last line ending in `;` as the end of the statements, so the checked expression starts with `}` |
| `const` redeclared across `continue` blocks | T3 Haiku (5 errors) | esbuild "symbol has already been declared". The agent renamed variables `lineB`, `taskC` |
| Variable used from an earlier, non-`continue` block | T3 Sonnet (2 errors) | `bad is not defined`; the syntax doc does not say that blocks are separate tests |
| String expected in quotes (`=> "HELLO"`) | planted in T5, both subjects found it | A clear single-line diff; this rule is documented and the diff works |
| Setup variable `t`, `print`, or `test` | issue evidence; corpus 03, 13 | `t2.request is not a function`, or a silent shadow of `print` |
| Unknown directive (`ts teardown`) | 2 tracked files: `beebox/test/core/secrets/cloudflare-publish.hostnames.doctest.md:39`, `beebox/test/publications/managed-publications.doctest.md:537` | Nothing. The block runs as an ordinary example test, so it is skipped when an earlier example fails |
| Non-`ts` fence in prose (` ```json `, ` ```bash `) | corpus 18, 18b | esbuild parse error; every fence executes as TypeScript (`doctest-parse.ts:32`) |
| Indented fence (inside a list item) | corpus 19 | Nothing: zero tests, `exit 0`. A wrong assertion passes |
| `=>2` (no space) | corpus 05 | esbuild `Unexpected "=>"` |
| Type error in a block (`const n: number = "str"`) | corpus 26 | Nothing: esbuild strips types; no doctest is type-checked |

Only 3 of the 14 subjects read `agent-doctest/docs/syntax.md`. The doctest skill
was loaded in 3 of 7 Sonnet runs and 0 of 7 Haiku runs. Subjects learned the
format by copying a nearby doctest; Haiku picked the same exemplar in 3 runs.
Guidance that lives only in documents therefore reaches a minority of writers.
The error message and the neighbouring file are what teach.

The skill says the opposite of this evidence. `.claude/skills/doctest/SKILL.md:20`:
*"the traps are in assertion semantics (see the syntax reference's
string-comparison rules), not syntax."*

**Wildcards are almost unused, and the diff punishes using them.** 69 of 1,004
files use any `«»` pattern; `«uuid»`, `«number»`, `«string»` and named captures
are never used. No subject used one, including the lock task, whose output
contains a pid, hostname, and timestamp. They wrote
`typeof recorded.hostname => string` and `Number.isNaN(Date.parse(…)) => false`
instead. The literate grading found the same in 0 of 25 files. The diff also
works against wildcards: `buildDiff` (`agent-doctest/src/tap-check/match.ts:167-183`)
compares lines by index as text, so when one wildcard line fails, every
wildcard line is shown as a mismatch (corpus 16c).

**Reading failures: the diff is hard to read in four ways.**

- Signs are inverted against the header. The header says `expected vs actual`,
  but `-` is the actual line and `+` is the expected line (`match.ts:180-181`).
- The line diff is index-aligned, not a real diff. One missing line misaligns
  everything after it: a 30-item array produced a 493-line failure (corpus 25).
- Each failure prints the diff, then `found:` and `wanted:` in full.
- Runtime errors report line numbers in the generated code as if they were
  `.md` lines, because the loader emits no source map
  (`agent-doctest/src/doctest-hooks/hooks.ts:108-112`). Corpus 21 reports
  `21-runtime-throw.doctest.md:24:11` for a 10-line file.

Test names use the first line of the block (`const s = "a,b";`), and every
assertion is reported as `(unnamed test)`.

**Assertions often hide the value.** 21% of `=>` results are bare `true` or
`false` (2,580 of 12,521); the literate sample found 27%. These come from
`.includes(…)`, `.length === n`, and hand-built boolean summaries such as
`duplicateRejected: duplicate.includes("already assigned")`. A failure then says
only `expected "true", actual "false"`. Median prose-to-code line ratio is 0.22,
and 28% of example blocks have no prose since the previous block.

**Running.** A single-file run takes about 2.8 s wall time. `test:changed`
selection took 1.7 s for a 115-file diff. Output volume is dominated by a failing
file's tap diagnostics (about 20 lines of node arguments per file-level failure)
and the esbuild stack on parse errors. Flakes: about 15 of 24 incidents were
test-caused (fixed sleeps, unsettled waits, budgets sized for an idle machine),
3 were product bugs, and 3 were runner-caused (teardown order, misattributed
source, tap plugin set). All 3 runner causes are fixed. The runner still has no
per-example deadline, so a hung example shows as a whole-file `expired:` after
300 s that names nothing. It also has no shared wait helper: doctests define
`waitFor` 14 times with 6 signatures, `settle*` 14 times, and `delay` 10 times,
and one `waitForSessionState` has no deadline at all.

**Fit.** Doctest serves input-to-output tests well, including many-case tables:
both subjects converted `auth.classify.test.ts` (59-64 assertions) without trouble
once objects compared. It serves these badly: harness-dominated tests (fake
clocks, fake child processes, event-order checks), process and lock concurrency
tests, tests that must run in another runtime (the Cloudflare worker suite on
vitest), ESLint `RuleTester` suites, and the doctest framework's own tests.

## Prototype and experiments (2026-09-28 to 09-29)

The boxholder approved prototyping these parts on the worktree branch:

- make the common parse failures work;
- fix line numbers;
- `ts teardown`;
- `eventually()`;
- hang notices;
- setup-failure reporting;
- wildcard suggestions;
- the diff.

All of them are built, on commits `46a02a09f` through `7f66b9692`. None is on
`main`.

**What the prototype does.**

- These now work instead of failing:
  - a missing blank line between examples;
  - `=>value` with no space;
  - `import` in an example or cleanup block, rewritten in place to
    `await import()`;
  - `try`/`catch`/`for` before the checked value, split by asking esbuild,
    and only when the old split fails to compile;
  - a setup variable named `t` or `print`;
  - `json` and `bash` fences in prose;
  - object results written as JS literals or compact JSON, in any key order.
- A file that cannot load reports a failing TAP test,
  `DoctestSyntaxError file.md:LINE: …`. It shows the line, the first lines of
  the block, and hints for prose in a fence, a blank line in output, a
  redeclared name, a declaration before `=>`, and `=>` inside braces.
- A throwing setup block is reported as `setup block at file.md:L threw …`.
- Stack traces and tap locations name `.doctest.md` lines, through a line
  map composed into esbuild's source map.
- Failures print a conventional diff (`- expected`/`+ actual`, LCS,
  wildcard-aware) and `suggested:`, the actual value with the varying parts as
  wildcards and blank lines as `«blankline»`, ready to paste.
- `=> ?` is the convention for "show me the value".
- `ts teardown` runs once per file.
- `eventually(fn, { label, timeoutMs })` is in scope everywhere.
- A `still running after 60s: file.md:L …` TAP comment names a hanging
  example. Use `ts timeout=…` to change the limit.
- A ReferenceError for a name another block declares says where it is and
  how to share it.
- Unknown directives and indented fences are errors.
- **Compatibility.** All 1,004 tracked doctests compile. Every example parses
  as before. No file declares `t`, `print` or `eventually` at top level, so
  bindings are unchanged. A full beebox run found one regression: an `import`
  inside a template literal was rewritten. It is fixed. The run also found a
  pre-existing test-caused flake (filed).
- **Cost.** Loading all 1,004 files through the new loader takes about 1.9 s
  in total (about 1.9 ms per file), including the source-map rewrite.

**Subject runs.** The same briefings were used every round. Round 1 used
today's tool. Round 2 used the prototype with the old docs. Round 3 used the
prototype and the rewritten `syntax.md` and skill, on the four tasks where
values vary.

| Measure | Round 1 | Round 2 | Round 3 |
|---|---|---|---|
| `JSON.stringify` wrapping results (T1 Haiku, cookies) | 19 of 19 examples | 0 of 24 (literals) | n/a |
| Object literals in the conversion task (both models) | 0 | 63 and 58 | n/a |
| Wildcards in the lock task (T7) | 0, 0 | 0, 0 | Sonnet 3 (via `=> ?`); Haiku 3, copied from Sonnet's file |
| Subjects that read `syntax.md` or loaded the skill | 3 of 14 | 4 of 16 | Sonnet 4 of 4, Haiku 2 of 4 |
| `=> ?` used | n/a | n/a | Sonnet 2 of 4, Haiku 0 of 4 |

What moved and what did not:

- **The comparison change removed the largest format failure.** In round 1,
  T1 Haiku failed 16 of 19 examples because it wrote objects as literals. In
  round 2 it wrote the same literals and they passed.
- **The remaining Haiku failures in round 2 were environmental.**
  - Haiku ran tap from the monorepo root. The root `.taprc` now tells it
    where to run.
  - Haiku ran `pnpm test <path>`, which ran the whole suite (filed).
  - Haiku imported from the wrong relative path.
- **Guidance reaches Sonnet and not Haiku.** Haiku copies neighbouring
  files, including another subject's file when one is visible. Good examples
  in the tree matter more for the lighter models than any document.
- **Scope was the most common conceptual miss.** In 4 Sonnet runs across
  rounds, the author expected variables to carry between blocks, as notebook
  cells do.
- **Booleans persisted** in tasks that never printed a varying value: 10 of 15
  results in T3 Haiku in round 3. `=> ?` only helps an author who asks to see
  the value.

**An environment incident, and a runner-caused flake.** Round 2 was stopped
partway.

- Haiku subjects ran tap from the monorepo root. That rebuilt tap's shared
  runtime with the default plugins and broke every concurrent run.
- Subjects then ran `pnpm install --force` and `rm -rf node_modules`, and one
  also deleted `pnpm-lock.yaml`.
- This worktree's install was restored from the lockfile. `git status` was
  clean throughout.
- The cause is the same one behind the closed 2026-08-05 tsx-resolution flake:
  any tap run whose plugin set differs from the shared build rebuilds it.
  `beebox-clerk` also used a different set.
- Fixed on the branch:
  - a root `.taprc` with the shared plugin list;
  - `beebox-clerk` on the same list (160 of 160 tests pass);
  - a root preload that reports `run this test from its package: cd beebox &&
    pnpm exec tap …`.

**Round 4: the fuller path rule, isolated directories.** The four varying-value
tasks again, each subject in its own randomly named directory. The path rule
(`beebox/.claude/rules/doctest.md`) now carries six short rules, narration
first; it loads with any `.doctest.md`, which round 3 confirmed reaches Haiku
where the skill and syntax reference do not.

| Measure | Round 3 | Round 4 |
|---|---|---|
| `=> ?` used | Sonnet 2 of 4, Haiku 0 of 4 | Sonnet 1 of 4, Haiku 1 of 4 (rolling log) |
| Wildcards in the lock task | Sonnet 3, Haiku 3 (copied) | Sonnet 2, Haiku 0 (booleans via `print`) |
| Files with a bare `=> true`/`false` share above half | 2 of 8 | 1 of 8 |
| Subjects reading another subject's file | 1 | 0 |

The first Haiku use of `=> ?` came in this round, with no skill or syntax
read: the rule is what reached it. Two subjects (one per model) wrote a
`try { … } catch (e) { e.message }` and expected the block's last expression
to be the checked value; the split now makes that work. One Sonnet subject,
finding that `cleanup` runs per test, used `process.on("exit")` instead of
`ts teardown`: the teardown form needs more prominence in the reference.

**Cross-model review of the code** (Codex, gpt-5.5, 2026-09-29) found four
defects, all fixed on commit `dfd924ef9`:

- knip's doctest import reader skipped untagged fences, which the runner has
  always executed;
- `import … with { type: "json" }` was not rewritten in example blocks;
- `import type { t }` counted as declaring `t`, which would have dropped the
  runner's `t` binding;
- the cross-block hint missed destructured and imported names.

It found no contradiction with the decisions above and did not block landing
after a full-suite run.

**Experiment caveats.**

- There is one run per task, model and round, so small differences are noise.
- Concurrent subjects could read each other's scratch files. One did.
- Runs that fail on purpose with `=> ?` make failure counts misleading from
  round 3 on.

**Filed from this work.**

- [partial-file race in hashStreamToFile](../../../issues/closed/bugs/2026-09-29-hash-stream-to-file-leaves-partial-file.md),
  reproduced in 41 of 200 attempts;
- [the namespace-fence-traversal flake](../../../issues/closed/bugs/2026-09-29-namespace-fence-traversal-doctest-flake.md);
- [bin/test doctests run by no suite](../../../issues/bugs/2026-09-29-bin-test-doctests-not-run.md);
- [`pnpm test <path>` running the full suite](../../../issues/closed/bugs/2026-09-29-pnpm-test-unrecognized-path-runs-full-suite.md).

## Smallest fix and budget

The smallest fix for the observed failures is the parser and comparison work
in Tracks A and B plus the guidance rewrite in Track E:

- detect the common layout mistakes at parse time and report them as failing
  TAP tests;
- add the esbuild-oracle fallback for statements before the checked
  expression;
- accept an object written as a JS literal or compact JSON by normalizing it
  into the existing text comparison;
- fix the diff's signs and alignment;
- rewrite `syntax.md` and the skill.

That covers every failure the subjects hit, and the four largest real-session
causes, except the scope rules.

Estimate for the full plan (source + tests, additions plus deletions):

| Track | Source | Tests |
|---|---:|---:|
| A. Parse-time checks and mapped locations | 450 | 350 |
| B. Comparison and diff | 200 | 220 |
| C. Runner names and scope | 60 | 60 |
| D. Waiting and deadlines | 150 | 150 |
| E. Guidance (authored docs) | 250 | none |
| F. Fit guidance (issue note) | 30 | none |

That is about 860 source lines and 780 test lines, plus about 310 lines of
authored docs: about 1,950 in total. That is at the 2,000-line **BIG CHANGE**
line, so treat it as one. Every track carries its own tests. The tracks are
independent enough to approve one at a time; A, B, and E alone are about 1,500
lines.

Existing doctests are not bulk-rewritten here. Track B makes the
`JSON.stringify` wrappers unnecessary but leaves them valid.

## Stated preferences this plan trades against

- **Fix the code, not the instructions.** The review issue asks "whether the
  syntax or its error messages should change instead of the instructions". The
  subjects' behaviour (3 of 14 read the syntax doc) supports changing messages.
- **Bias toward strict** (memory `feedback_bias_toward_strict`). Unknown
  directives, indented fences, and zero-example files become errors (A2). The
  trade-off is that some files may fail at first; A2 lists the known cases.
- **Minimize invented concepts** (`feedback_minimal_concepts_prefer_primitives`).
  No new block kinds are added except for one question (file-level cleanup),
  which is left open. `eventually` is a helper in scope, the same kind of thing
  as `print`.
- **Noisy output is a bug** (root `CLAUDE.md`, "Treat unsolicited tool
  output… as a bug"). Track A replaces the esbuild stack with one located
  message.

## What already exists

- Parser: `agent-doctest/src/doctest-hooks/doctest-parse.ts` (`parseCodeBlocks`,
  `parseExamples`, `nextTemplateState`). Reused; the checks in A1 are added to it.
- Generator: `agent-doctest/src/doctest-hooks/doctest-generate.ts`
  (`splitExpression` at :44, `emitExamples`, `generateTestSource`). Reused.
  `splitExpression` is replaced (A3).
- Loader: `agent-doctest/src/doctest-hooks/hooks.ts:103-113` calls
  `transformSync` with no source map. Extended (A4).
- Comparison: `agent-doctest/src/tap-check/check.ts` `compare()` (:175) and
  `match.ts` `matchWithWildcards` and `buildDiff` (:145). Extended (B).
- Existing good error: `doctest-generate.ts:272-276` already names the file,
  line, and fix for a `continue` block with no open test. A1's messages follow
  that model.
- Existing teardown hoisting (`doctest-generate.ts:195-240`) and cleanup error
  reporting. Kept as is.
- Flake bookkeeping: `bin/test-ledger.ts`, `bin/finish-verify`, and
  `beebox/test/careful.txt` classify retries outside the runner. Kept; D does
  not add retries.
- Wait helpers: none shared for doctests (see Evidence). D adds one.

## Prior art (external)

- Python `doctest` separates examples by the `>>>` prompt, not by blank lines,
  so a missing blank line cannot merge two examples. This plan keeps
  blank-line separation and detects the mistake instead; changing the prompt
  syntax across 12,521 assertions is not justified by the evidence.
- esbuild `transform` does not apply an input source map to parse-error
  locations. Verified in this session: an inline `sourceMappingURL` input map
  left the error at the generated line. So A4 remaps locations itself.
- Jest and Vitest `toEqual` diffs use `- Expected / + Received` with an LCS
  line diff. B2 adopts that convention.

## Ontology

The plan adds one noun and names existing ones.

- **Block**: one fenced code region (`CodeBlock`, `doctest-parse.ts:14`).
- **Directive**: the words after the language in the fence info (`setup`,
  `continue`, `cleanup`). Today it is matched with `includes`
  (`doctest-generate.ts:249-253`), so any unknown word is ignored.
- **Example**: an expression plus an optional `=>` expected value (`Example`,
  `doctest-parse.ts:122`).
- **Test**: one tap test = one block plus the `continue` blocks after it.
  Variables are shared inside a test and not across tests.
- **Line map** (new): an array from generated-source line to `.md` line,
  built by `generateTestSource`. It is not a source map file. It is used to
  remap esbuild errors and to rewrite runtime stack frames.

## Tracks / scope

### Track A: parse-time checks and mapped locations

**What.** The parser reports layout mistakes as doctest errors with an `.md`
location and a fix. The loader prints one compact message instead of the
esbuild dump. Runtime errors point at `.md` lines.

**Why.** esbuild parse errors on generated code are the most common doctest
failure in real sessions: 98 sessions across Claude and Codex. The causes are
`try`/`catch` before an expression, a blank line in expected output, prose in a
fence, `import` outside setup, `=>2`, and non-`ts` fences. Two more mistakes
pass silently: an unknown directive and an indented fence. A parse failure is
also hard to see, because it prints above the TAP block and the file reports
`no tests found`.

**Direction.**

- A1. Checks in `parseExamples` and `generateTestSource`, each throwing a
  `DoctestSyntaxError { file, line, message, hint }`:
  - **Expected value contains a line starting with `=> `**: "Two examples
    are not separated by a blank line (line N). Add a blank line before line M."
  - **Arrow without a space** (`/^=>\S/`): "Write `=> value` with a space."
  - **esbuild parse error inside an example whose failing line looks like prose**
    (a letter-initial line that is not valid TypeScript, followed by text):
    "Line N looks like prose inside a code fence. Close the fence, write the
    prose, and reopen with ```ts continue." Otherwise, the esbuild message is
    remapped to the `.md` line.
  - **A parse error on the line after a blank line that follows an expected
    value**: "A blank line ends the expected value. If the output contains a
    blank line, write `«blankline»`."
  - **A static `import` in an example block** is reported with a fix: "move
    this import to a ```ts setup block, or use `await import()` if it must run
    after the code above it." Silent hoisting was considered and rejected.
    ES semantics would run the import before any example code written above
    it, which misleads the author.
  - **Every load-time failure becomes a failing TAP test.** This covers
    generation errors, esbuild errors, and a `setup` block that throws. The
    mechanism is one design used for all three:
    - The loader answers a `.doctest.md` URL with a small entry module. It
      imports `test` from tap and runs `await import(<same url>?doctest-body)`
      inside `try`.
    - The loader answers the `?doctest-body` URL with the generated module,
      unchanged from today. Setup blocks stay at its module scope, so their
      imports and bindings keep today's semantics.
    - If that import rejects, the entry module registers one test named
      `DoctestSyntaxError file.md:LINE: <message>` or
      `setup block at file.md:LINE threw: <message>`, and fails it.
    - The failure then appears among the `not ok` lines that agents filter
      for, not above the TAP block as `no tests found`.
    - This depends on tap collecting a test registered after a failed
      top-level `await import()`. Verified on 2026-09-28 with a one-file
      prototype under `beebox/.taprc`. The output was `not ok 1 -
      DoctestSyntaxError proto.md:3: Cannot find module …`, and the summary
      was `{ total: 1, pass: 0, fail: 1 }`. The success path was verified too: a body module's tests, imported the same way, were collected and passed.
- A2. Strict fences:
  - Only info strings whose language is `ts`, `typescript`, `js`,
    `javascript`, or empty are examples. Other languages are prose, so
    ` ```json ` and ` ```bash ` are allowed in the narrative.
  - An unknown directive is an error ("`teardown` is not a directive; use
    `cleanup`"). The two `ts teardown` files are changed to `ts cleanup` in
    the same commit.
  - A file with zero examples fails with "no examples found".
  - An indented fence is an error ("fence is indented; doctest ignores it").
    `parseCodeBlocks` matches column-0 fences only (`doctest-parse.ts:32`), so
    this needs a separate scan in `parseCodeBlocks` for lines matching
    `^\s+```` outside a block. `parseExamples` never sees them.
  - The info string gets a grammar: `<lang>? <directive>* <key>=<value>*`.
    The directives are `setup`, `continue`, and `cleanup`, and the only
    combination allowed is `continue cleanup` (22 files use it). Keys are
    validated per directive; D2 adds `timeout`. This replaces the `includes`
    tests at `doctest-generate.ts:249-253`, which accept any word that contains
    a directive name.
- A3. Keep `splitExpression`'s `;` rule, and add a fallback that uses esbuild
  as the parse oracle, with no hand-written parser. When the split it produces
  does not compile, try each line boundary from the end. Pick the longest
  suffix for which both of these hold:
  - `(suffix)` transforms as an expression;
  - the prefix transforms as statements.

  Each candidate is one `transformSync` call on a few lines. Today's split
  always wins when it compiles, so every example that passes today keeps its
  meaning. The fallback only changes examples that fail to parse today. That
  is the class seen in about 20 real sessions: `try`/`catch`, `for`, and
  brace-bodied arrows before the checked expression. When no candidate parses,
  the error names the example and says "could not find the checked
  expression; put it on its own line after the statements". The documented
  rule becomes: "the last expression before `=>` is checked."
- A4. Line map:
  - A new export, `generateTestModule`, returns `{ source, lineMap }`.
    `generateTestSource` keeps its signature and returns `.source`, because it
    is a documented export of `agent-doctest/hooks`
    (`agent-doctest/README.md:352`).
  - Only lines that come from the `.md` file get an entry. Generated helper and
    header lines have none, and a stack frame on such a line is shown
    unmapped. A wrapper line such as `await t.check(__withPrints(__prints,
    <expr>), …)` gets the `.md` line and a column offset equal to the wrapper
    prefix length.
  - When loading the `?doctest-body` URL, `hooks.ts` catches esbuild errors,
    maps them through `lineMap`, and rejects with a `DoctestSyntaxError`. The
    entry module (A1) turns that rejection into a failing TAP test. The esbuild
    stack is not printed.
  - The loader asks esbuild for an inline source map, and rewrites its
    line mappings through `lineMap` so that node's `--enable-source-maps` (on in
    tap) reports `.md` lines. Columns are shifted only on wrapper lines.

**Vocabulary lock-ins.** `DoctestSyntaxError`; "example", "block", "test" as
defined in Ontology; the executable-language list.

**First implementation chunk.** A1's blank-line check and `=>`-space check in
`parseExamples`, and the failing-TAP-test form of `DoctestSyntaxError` in
`hooks.ts`. Add `agent-doctest/test/doctest-hooks.test.ts` cases for corpus
files 01, 02 and 05.

### Track B: comparison and diff

**What.** An object result can be written as a JS literal or compact JSON, and
the diff reads like other test frameworks' diffs.

**Why.** The single most common subject failure. It is the source of the
`JSON.stringify` habit (2,983 lines), which in turn produces the one-line blobs
the literate grading rated lowest.

**Direction.**

- B1. Normalize the expected literal into the existing comparison. B1 is not a
  second, structural comparison. In `compare()` (`check.ts:175`), when the
  actual value is not a string and the text match fails:
  - Parse the expected text as a JS literal. Use JSON5-style rules: unquoted
    keys, single quotes, trailing commas; no expressions.
  - If it parses, serialize the parsed value with the default JSON
    serialization (`JSON.stringify(v, null, 2)`, as documented at
    `README.md` "Custom serializers"). Run today's `matchWithWildcards` on that
    text against today's serialized actual.
  - A `«…»` token is carried through the parse as a placeholder string and
    restored as a wildcard in the normalized text.
  - A value with a custom serializer serializes as it does today, so a literal
    never matches it. Custom serializers keep their meaning, and the text
    comparison stays the only comparison. This needs one API change.
    `serialize()` (`serialize.ts:30`) returns only text, so B1 adds
    `serializeWithSource()` returning `{ text, custom: boolean }`. `compare()`
    skips normalization when `custom` is true.
  - Strings keep today's literal, unquoted comparison; B1 never applies to a
    string actual.
  - Parser: a small hand-written literal parser in `tap-check/`, no dependency.
- B2. `buildDiff`:
  - Header `- expected` / `+ actual`, signs to match.
  - An LCS line diff with 3 lines of context, collapsing long equal runs.
  - Wildcard-aware: an expected line whose pattern matches its actual line
    counts as equal.
  - Drop `found:`/`wanted:` when a diff is present.
- B3. Hints on specific mismatches:
  - Expected is `"…"` and actual equals its contents: "strings compare without
    quotes".
  - Actual is `undefined` and the expression calls `console.log`: "use
    `print()`".
  - Expected is `true`/`false`: "a boolean result hides the value; consider
    printing the value, with wildcards for the parts that vary". Operand
    capture (rewriting `a === b` so both sides are printed) was considered and
    cut. It changes evaluation of getters, `this`, and optional chains, and
    guidance can steer authors away from booleans.

**First implementation chunk.** B2's sign and header fix plus LCS diff, with
`check.test.ts` cases for corpus 02, 16c, 25.

### Track C: runner names and scope

**What.** Internal names cannot collide with user names, and assertions have
names.

**Direction.**

- C1. The generated test callback parameter becomes `__doctest`
  (`doctest-generate.ts:290`), and internal helpers are prefixed `__doctest_`.
  `print` stays public. A `setup` declaration of `print` is reported by A1
  ("`print` is provided by doctest").
- C2. Each check carries a name: `file.md:LINE expression-first-line`. The tap
  output then lists examples instead of `(unnamed test)`, and the test name
  uses the first checked expression, not the first line.
- C3. The esbuild "already declared" error, after A4 remapping, gets the hint
  "`continue` blocks share one scope with the block they continue."

### Track D: waiting and deadlines

**What.** One `eventually` helper in scope and a per-test deadline that names
the example.

**Why.** The flake history shows no runner defect remaining, but it shows 38
home-made wait helpers and a whole-file 300 s timeout that names nothing. Most
flake triage cost was spent finding which example hung.

**Direction.**

- D1. `eventually(fn, { label, timeoutMs = 5000, intervalMs = 25 })` is
  provided like `print`. It retries `fn` until it returns without throwing
  and, if given a predicate result, until that is truthy. On expiry it throws
  `EventuallyTimeout: <label> not true after <ms>; last value/error: …`.
  A deadline is required (a default is always set).
- D2. A still-running notice, not a deadline. Each generated test records
  which example is running. After 60 s, or `ts timeout=180s` on the fence, it
  writes one diagnostic line to the TAP stream: "example at file.md:LINE still
  running after 60s". The test is not ended and the hung work is not
  cancelled. Ending the test would start its teardowns while the body still
  runs, and later assertions would fire after the test ended. The file-level
  `timeout: 300` still ends the file, and its `expired:` output is now preceded
  by the named example.
- D3. A `setup` block that throws fails the file with "setup block at
  file.md:LINE threw: …" instead of `1..0 # no tests found`. It uses A1's
  entry-module mechanism, so setup code is not wrapped or moved. The failing
  setup line comes from the rejection's stack, mapped through A4's line map.

`waitFor` and the other local helpers are not migrated in this plan; the skill
tells new code to use `eventually`.

### Track E: guidance

**What.** Rewrite `agent-doctest/docs/syntax.md` and the doctest skill around
the mistakes agents actually make, and after A–D, around what the tool now
reports.

**Direction.**

- `syntax.md` becomes example-first, in task order:
  1. File shape: setup, examples, prose, continue, cleanup.
  2. What is compared: strings are compared raw; objects accept a literal
     after B1.
  3. Volatile values: the lock-file example with `«int»`, `«date»` and `«*»`.
     This puts wildcards on the main path.
  4. Errors: `=> throws`.
  5. Waiting: `eventually`.
  6. Scope: a small diagram of block, continue, and test.

  Each rule states what the error looks like.
- A short "show the value" section: prefer printing the value with wildcards to
  `=> true`. It uses the literate grading's before/after pairs.
- A "writing the narrative" section, answering how prose should carry a
  doctest. It is based on the files graded best:
  - Open with the contract or the incident that motivated the code, in a
    paragraph a newcomer could learn from.
  - Put one sentence before each example that states the rule the example
    demonstrates. A heading or "Now test X:" is not enough.
  - Split blocks for narrative reasons only.
  - Keep helpers in a short setup, or in a shared `test/helpers/` module when
    they outgrow one screen, so the first screen of the file is prose.
- The skill:
  - Drop the "not syntax" claim.
  - Add "reading a failure" (sign convention, where the `.md` line is,
    `DoctestSyntaxError` versus a check failure versus a timeout).
  - Keep flake triage as a pointer to `.claude/agents/finish.md`, as it already
    is.
  - One recommended filter for failing output, so agents stop re-running to
    change `tail`/`grep` filters:
    `2>&1 | grep -E '^\s*not ok|DoctestSyntaxError|^\s+(diff|at):|# \{'`,
    with the full output as the fallback. Adjust it after A and B change the
    output.
- Exemplars. Subjects copy neighbours, so name two exemplar files in the skill
  and in `syntax.md`: `beebox/test/core/pdf/probe.text-layer-quality.doctest.md`
  (narrative) and `beebox/test/core/bulk-upload/worker/deliver.doctest.md`
  (multi-line output).

### Track F: fit guidance for the conversion issue

Add a short section to the conversion issue, "Fit, from the usability review",
with the shapes that stay code: framework self-tests, the `pub-worker` vitest
suite, `RuleTester` suites, and harness tests built on `core-harness.ts` or
lock-holding processes. Include about 19 named files and the reason for each.
The issue itself stays unattached. Table-driven pure tests convert well once B1
lands; converting before B1 would add more `JSON.stringify` blobs, so the
issue should wait for B.

## Could this be simpler?

The simplest version is guidance only: rewrite `syntax.md` and the skill. It
fails on the evidence: 11 of 14 subjects never opened the syntax doc, and all of
them met the errors.

The next simplest covers most of the evidence:

- A1 (checks, `import` hoisting, parse failures as TAP tests);
- A3 (the esbuild-oracle fallback, the largest real-session cause);
- B1 (literal normalization, the largest subject cause);
- B2 (diff);
- Track E.

The fuller plan adds:

- B1, which removes the `JSON.stringify` reflex at its source;
- A4, which makes every runtime stack point at the file the agent edits;
- D, which turns 300 s anonymous timeouts into a named example.

D is the most separable: it addresses triage cost rather than writing errors,
and could be approved alone or deferred.

## Subplans

None. B1's literal parser is small enough to design in its chunk.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A1 prose heuristic flags a real expression as prose | planned (valid-code corpus) | falls back to the remapped esbuild message | clear |
| A2 strictness fails existing files (unknown directive, indented fence, zero examples) | planned: run the whole suite before merge | fix those files in the same commit | clear |
| A3 fallback picks a wrong split for an example that fails to parse today | planned | only examples that fail today reach it; longest-suffix rule | clear if it then fails; silent only if the new split passes a wrong comparison |
| A3 fallback makes transforms slow on a file with many multi-line examples | planned: time the full corpus | only runs after a failed transform | clear |
| B1 literal normalization hides a custom-serializer mismatch | planned | custom-serialized values never normalize; the text comparison stays authoritative | clear |
| A1 entry module: the `?doctest-body` query breaks relative imports, the test graph (`bin/test-graph.ts`), or knip's doctest import reader | planned | the query only changes the URL the loader sees; resolution is relative to the same path | clear (import errors surface as DoctestSyntaxError) |
| B1 `serializeWithSource` disagrees with `serialize` for some value | planned | `serialize` becomes `serializeWithSource(v).text` | clear |
| A4 line map off by one after template-literal handling | planned: each corpus runtime error asserts its `.md` line | none | misleading |
| B1 literal parse accepts an expected text that was meant as a string | n/a: B1 never applies to a string actual | by design | clear |
| B1 key order differs between literal and actual | planned | compare after serialization; key order is significant, as today | clear |
| D2 notice fires on a slow but correct file under load | ledger shows 6x p99 inflation | a notice only, nothing fails; per-fence override | clear |
| D3 setup error's line is wrong when the throw is inside an imported helper | planned | the message shows the error's own stack as well as the mapped setup line | clear |

No critical gap remains. The draft's hand-written depth-tracking splitter could
silently split a passing multi-line expression. The esbuild-oracle fallback
replaces it and never touches an example whose split compiles today.

## Agent-flow / user-flow edge cases

- **Wrong directive**: ADDRESSED by A2 (unknown directives are errors).
- **Stale exemplar**: the named exemplar files change later. DEFERRED: the skill
  names them; the doc-check link check keeps the paths valid, not the content.
- **Old habit**: agents keep writing `JSON.stringify` after B1. ADDRESSED
  (harmless): it still passes; Track E stops teaching it.
- **Validation error UX**: ADDRESSED by A1 and A4 (one located message with a
  fix).
- **Partial rollout**: a file relying on the silent `ts teardown` behaviour.
  ADDRESSED in A2's commit (the two files are fixed there).
- **Hand-edit drift**: a human writes a fence with `typescript` or an info
  attribute. ADDRESSED by the language list in A2.

## NOT in scope

- **Type-checking doctest code.** Real (corpus 26 passes a type error), but it
  is the same gap as the filed `test/` type-check issue and needs a tsc program
  over generated code. File a follow-up issue instead.
- **Bulk-rewriting existing doctests** (`=> true`, `JSON.stringify`, local
  `waitFor`). New guidance applies to new and touched files.
- **A lint for fixed sleeps or bare `=> true`.** Considered. The 68 existing
  `setTimeout` sites would need triage first. Revisit after D ships.
- **Changing example separation to a prompt syntax** (Python-style). A1 detects
  the mistake; changing 12,521 assertions is not justified.
- **Auto-retry of failed files inside the runner.** The ledger and
  `finish-verify` already own flake classification.
- **Running doctests in other runtimes** (Workers pool). Those suites stay code
  (Track F).
- **Table syntax for many-case tests.** The convert subjects did well with one
  example per case; the evidence does not call for a new block kind.

## Open design questions

- **Block scope.** Decided 2026-09-29: blocks stay separate tests; the
  ReferenceError hint names the declaring block.
- **"Show, don't assert."** Decided 2026-09-29: a bare `=> «*»` is refused,
  and `=> «show»` records the value as a TAP comment. The five tracked uses
  were converted (three to `«show»`, two to real values).
- **Reaching the lighter models.** Decided 2026-09-29: the path rule carries
  the key rules (round 4 showed it is the channel that reaches Haiku).
  Refreshing a few high-traffic doctests as exemplars is still open.

- **File-level cleanup.** `cleanup` tears down only the test it follows
  (`agent-doctest/docs/syntax.md`), so resources shared by several sections
  are torn down inline (the literate grading found repeated `socket.destroy()`
  sections). The options are:
  - Treat a `cleanup` block placed before the first example as file-level.
  - Add no new form and document the `continue` chain.

  My lean: the first, since it needs no new word. It changes the meaning of
  today's "pending cleanup" case (`doctest-generate.ts:244`), so the existing
  uses need checking.
- **Default D2 deadline.** 60 s against the ledger's per-file distribution;
  confirm from `bin/test-ledger.ts report` before setting it.

## Knowledge audits

Not applicable: doctest guidance is dev-repo guidance (skills, `syntax.md`),
which box agents never load, so `knowledge-audit` cannot reach it. The
equivalent check is to re-run the usability tasks after Tracks A, B, and E, with
the same briefings, and compare the failure counts.

## What will hold this after it ships

- `agent-doctest/test/doctest-hooks.test.ts` gains one case per A1/A2 check and
  a line-map case per corpus runtime error. This file stays code (Track F).
- `agent-doctest/test/tap-check/check.test.ts` gains B1 and B2 cases.
- A full-suite run before merge confirms that A2 and A3 change no passing
  example.
- The usability re-run (same 7 tasks, same models) is the acceptance test for
  the plan as a whole.

## Implementation order

1. B2 (diff signs, LCS, wildcard-aware). No dependency; smallest visible gain.
2. A1 + C1 (checks, internal names).
3. A4 (line map, compact errors). A1's remapped-error fallback depends on it.
4. A2 (strict fences) with the two `ts teardown` fixes and a full-suite run.
5. A3 (esbuild-oracle fallback).
6. B1, then B3's hints.
7. D1, D3, D2.
8. E (guidance), written against the finished behaviour.
9. F (issue note).
10. Usability re-run.

## Rollout shape

- **Tests.** Tests come first per chunk, using the corpus files as fixtures.
- **Done-when.**
  - Every corpus case either passes as intended or fails with a
    `DoctestSyntaxError` or check message that names the `.md` line and the
    fix.
  - The full suite passes.
  - The usability re-run shows fewer format-caused failures than the
    baseline. Baseline: 14 subjects made 49 tap runs; 24 had failing checks
    and 4 had parse errors. Outside the planted repair task, 25 runs did not
    pass. Reading each one, about 15 failed on doctest format (object
    literals, scope, the `try`/`catch` split) and about 10 on wrong guesses
    about the code's behaviour.
- **Migration.** None for data. Existing doctests stay valid except the two
  `ts teardown` files and any zero-example or indented-fence files the
  full-suite run finds; those are fixed in the A2 commit.

## Counting method

All counts are over `git ls-files '*.doctest.md'` at the worktree's base
commit on 2026-09-28 (1,004 files). Each count is a `grep` over those files:

| Count | Pattern |
|---|---|
| assertions | `^=>` lines: 12,521 |
| bare booleans | `^=> (true\|false)\s*$`: 2,580 |
| `JSON.stringify` expression lines | `^JSON\.stringify`: 2,983 |
| wildcard files | files containing `«`: 69 |
| fence info strings | `^```[a-z]`, counted by distinct string |

A reviewer counted 3,068 `JSON.stringify` lines. That count allows leading
whitespace (`^\s*JSON\.stringify`); the table counts column-0 lines only. The prose ratio and the
"no prose since the previous block" figures come from a script that counts
non-blank, non-heading lines outside fences against non-blank lines inside
fences.
