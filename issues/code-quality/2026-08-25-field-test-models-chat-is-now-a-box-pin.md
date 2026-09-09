---
title: "Field-test `models.chat` now pins the whole box — the name says otherwise"
workstream: model-engine-policy
area: beebox
filed-by: agent
discovered-in: model/engine policy work — cross-model review of the implementation
labels: [field-test, naming]
priority: backlog
---

A field-test scenario's `models.chat` used to write `.beebox/chat-model.json`
and so pin chat alone. It now writes the box's model policy (`agentModel` in
`config/box.json`), which chat **and the reactor** read — that was the point, and
the run report says so. The field name did not follow.

Rename `models.chat` → `models.box` across `src/field-test/scenario.ts`,
`results.ts` (the persisted result schema), `report.ts`, `run-seed.ts`, and the
two checked-in scenarios under `field-tests/`. It was left out of the policy work
because the schema is `strictObject` and results are persisted, so it is a real
rename with a compatibility question (accept both for a while, or migrate the
stored results), not a sed.

Also worth folding in: `models.operator` is a different kind of value — it goes
straight to the operator's SDK call, which accepts a tier alias like `opus`,
while `models.chat` is now resolved to a concrete model id at scenario load. Two
fields, two vocabularies, one `models:` block. Say which is which in the format
docs, or make both ids.

## 2026-09-01 manual-test failure

The weekly manual suite failed on the stale half of this same migration.
`test/manual/field-test-inject-email.doctest.md:88-91` still asserts
`.beebox/chat-model.json` exists after `seedFieldBox`. It never does: as this
issue's body already says, `seedFieldBox` (`src/field-test/run-seed.ts:87-94`)
writes `agentModel` into `config/box.json` instead. The assertion just never
followed the code.

```
not ok 3 - check failed
  at: field-test-inject-email.doctest.md:88
  expected: "true"
  actual: "false"
```

Run: commit `9550f5b68` on `main`, log
`~/src/schedule-runs/manual-tests/runs/20260901-192800.log`.
The neighboring assertion in the same block (`config/connectors/gmail.json`
exists) passes, and every later assertion in the file passes too, so this is
a stale check, not a box-creation regression. Fix: point the assertion at
`config/box.json`'s `agentModel` field instead of the retired path — this
would naturally happen as part of the `models.chat` → `models.box` rename
above, so it may be simplest to fold into that work rather than patch in
isolation.

## 2026-09-08 manual-test failure

The assertion was repointed at `agentModel` since last week (it now reads
`JSON.parse(await readFile(join(box.boxRoot, "config/box.json"), "utf8")))`,
`test/manual/field-test-inject-email.doctest.md:91`), but the literal path
string dropped the leading underscore. The box's config directory is
`_config`, not `config` — `getBoxDir(boxRoot, "config")` resolves to `_config`
per `boxDirsKey: "config"` / `path: "_config"` in
`src/lib/box-layout-spec.ts:257-258`, and `run-seed.ts:90` writes the file to
that same `_config/box.json`. Reading the un-prefixed `config/box.json` now
throws `ENOENT` instead of returning a stale-but-parseable value, so the test
hard-fails on `readFile` rather than failing the equality check:

```
not ok 3 - ENOENT: no such file or directory, open
  '.../bbx-field-pre-9iVOTH/run/box/config/box.json'
  at: field-test-inject-email.doctest.md:85 (block reported at its first
      line; the throwing statement is the readFile on line 91)
```

Run: commit `be7f0683d` on `main`, log
`~/src/schedule-runs/manual-tests/runs/20260908-195833.log`.
The preceding `_config/connectors/gmail.json` existence check (line 85, which
does use the correct `_config` prefix) still passes, so this is the same
stale/wrong-path assertion the previous entry described, now missing a `_`
instead of pointing at a retired filename. Fix: `config/box.json` →
`_config/box.json` on line 91's `join(...)` call (or, better, resolve it via
`getBoxDir(box.boxRoot, "config")` the way `run-seed.ts` itself does, so the
two can't drift again).

> 2026-09-08 run: the doctest failed again, this time `ENOENT …/config/box.json`
> — the seed writes `_config/box.json` on the one-root layout and the doctest
> still read the v2 path. Fixed in `1b13cc5ed`; passes for real.

