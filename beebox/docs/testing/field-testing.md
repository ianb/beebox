# Field tests

A persona operator drives a disposable real box through the real web UI to
test discoverability and end-to-end use.

## What it is

Field tests exercise realistic discoverability and end-to-end use through a
persona operator, a disposable real box, its real agents, and the real web UI.
They are expensive, run weekly or on demand, and are never a CI or merge gate.
The harness lives in `src/field-test/`; checked-in scenarios live in
`field-tests/<scenario>/`. Design history and rationale live in
[the implemented plan](../implemented-plans/agent-field-tests.md).

## Running it

```bash
bbx engine field-test list
bbx engine field-test run onboarding-first-days
bbx engine field-test report <run-dir>
```

`run` accepts a checked-in scenario name or a path to an in-progress scenario
directory. Each scenario's `scenario.yaml` selects its operator and box-chat
models; both default to `opus`. The operator currently runs through the Claude
chat backend. A scenario describes goals and checks rather than scripted UI
steps, so a capability that exists but cannot be discovered remains a finding.

The default run root is `~/src/boxes/field-runs/`. Each run directory contains:

- `results.json`, updated after every checklist item so an interrupted run
  retains evidence;
- `report.md`, the per-item rollup, findings, and harness event log;
- `questionnaires/<item-id>.md` and `activities/<item-id>.md`;
- `screenshots/<item-id>/`.

Use `bbx engine field-test report <run-dir>` to regenerate `report.md` from the saved
results after a run directory is moved or copied.

`bbx engine field-test inject-email <fixture> --state <path>` appends a YAML email
fixture to fake-Gmail state for manual scenario work. Run `bbx field-test
inject-email --help` for the fixture schema. This helper does not replace a
full scenario run.

## Reading results

Treat **Visual flags (unvetted)** as operator observations only. A human must
open the linked screenshots before accepting a visual claim. Other report
findings come from structured signals: failed checks, harness events,
unanswered questionnaire entries, and unresolved screenshot references.

A field run never files issues automatically. A human or triage agent decides
which evidence warrants an issue and applies the repository's normal public or
private issue rules.
