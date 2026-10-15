# Every hook had been skipped
## Supporting: commit 085a23011, the day of the merge
- The discovery produced a rule that shaped later gates: silent on success, loud on failure

```text
core.hooksPath was never set, no hooks were ever installed, and every commit
since the migration has skipped typecheck + lint + lint-staged + auto-deploy.
…
Add behavioral rule to root CLAUDE.md: noisy command output is a bug.
Warnings, deprecations, peer-dep mismatches, etc. cost agent context
and should be fixed at the source.
```

```text
THE RULE NOW (root CLAUDE.md)
Treat unsolicited tool output—including warnings, deprecations, ignored-build-
script lists, and peer-dependency mismatches—as a bug. Fix diagnostics
introduced by this work or relevant to its correctness. For pre-existing
systemic noise outside the task, find or file one focused issue… Moving noise
to stderr does not help.
```

Notes:
The second half of the rule ("for pre-existing noise, file one issue") came in September, after agents chased every warning in the tree.
