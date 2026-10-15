# Instrument before gate
## Supporting: one ledger record, and the flake definition
- Every run, green or red, appends one line: commit, content hash, what changed, whether the graph accounted for it, durations, failures and their class

```json
{"ts":"2026-10-08T02:32:56Z","branch":"worktree-box-first-load","mode":"selected",
 "exitCode":1,"tier":"ordinary","accounted":false,
 "changed":["beebox/src/frontend/src/components/LightboxProvider.tsx","…2 more"],
 "failures":[{"file":"src/frontend/test/renderers.system-card-renderers.doctest.md",
              "class":"attached"}]}
```

```text
A failing test file is re-run once in isolation: passing there is a flake by
the ledger's definition (fail-then-pass at the same content hash) and is
named, not hidden; failing again is real and blocks. The `smoke` command gets
no such forgiveness — it boots one real box and either it works or it does not.
                                                     (bin/finish-verify.ts)
```

- 1,915 runs recorded; 717 files have failed at least once; 49 files on the fix-or-delete list

Notes:
The ledger has no gate of its own. Its numbers justified each later flake-policy change and define "flake" for the landing script, so the decision moved from agent discretion to a scripted single rerun.
