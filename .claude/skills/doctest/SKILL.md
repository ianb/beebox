---
name: doctest
description: Write, run, and triage beebox `.doctest.md` tests, including distinguishing flakes from regressions and rerunning before claiming a fix. Use after choosing doctest as the test tier or when a doctest fails.
---

# Doctests: author, run, triage

The [syntax reference](../../../agent-doctest/docs/syntax.md) is short and
example-first; read it before writing a doctest. Whether a doctest is the
right tier at all is `bbx-guide-testing`'s call.

## Authoring

Create `test/<name>.doctest.md`, mirroring the `src/` path (`beebox/CLAUDE.md`).
Good models: `beebox/test/core/pdf/probe.text-layer-quality.doctest.md`
(narrative) and `beebox/test/core/bulk-upload/worker/deliver.doctest.md`
(multi-line output).

- **The prose is the document.** Open with the contract or the incident behind
  the code. Put one sentence before each example saying what rule it shows.
- **Show values.** Write objects as literals (`=> { kind: "box" }`), not
  `JSON.stringify(...)`. Prefer the value to `=> true`.
- **Unknown or varying value:** write `=> ?`, run, and paste the `suggested:`
  value after checking it is right. Varying parts arrive as wildcards
  (`«int»`, `«date»`, `«*»`). Better still, pass fixed inputs (time, ids).
- **Waiting:** `eventually(fn, { label })`, never a fixed sleep.
- Blocks are separate tests; ` ```ts continue ` shares variables, ` ```ts setup `
  holds imports and helpers, ` ```ts cleanup ` / ` ```ts teardown ` release
  resources.

## Running

- One file, **from the package directory**: `cd beebox && pnpm exec tap test/<path>.doctest.md`
- What your diff implicates: `pnpm test:changed`. Pre-commit runs typecheck and
  lint, not tests. The full suite (`pnpm test`) runs hourly on `main`; do not
  run it to check one file.
- Rule out contention: add `-j1`.
- If tap itself cannot start (a missing module under `node_modules/@tapjs`),
  stop and report it. Do not reinstall or delete `node_modules`; other
  sessions share it.

**Never declare a doctest fixed without running it.** Reproduce the failure,
then rerun after the fix.

## Reading a failure

- `not ok N - line 42: <expression>`: the example at markdown line 42.
- `diff:` `-` is expected, `+` is actual; `suggested:` is the actual value,
  ready to paste; `hint:` names a recognised mistake.
- `DoctestSyntaxError file.md:39: …` means the file did not compile: it shows
  the line and its block. Stack traces point at `.doctest.md` lines.
- `still running after 60s: file.md:L …` names an example that is hanging.

## Flake triage

The suite runs 6 files in parallel (`beebox/.taprc`); not every red run is
your bug. Isolate first: rerun the file alone. A failure that reproduces alone,
including on the unmodified tree, is a real bug, however long it has been red.
Most past flakes were test-caused: a fixed sleep or an unsettled wait (use
`eventually`), a budget sized for an idle machine, or a resource a failed
example left open (use `cleanup`). The full protocol (isolated rerun, grep
`issues/` for the signature, at most one full-suite rerun, file or fix) is in
`.claude/agents/finish.md`; file new flake shapes in `issues/bugs/` with the
`issues` skill.
