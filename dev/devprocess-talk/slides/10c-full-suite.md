# The only thing that tests main
## Supporting: schedules/full-suite, run-only by design
```yaml
# The batched full run of beebox's test suite — the only thing that tests
# `main`, and the only thing that still runs everything. Iteration and /finish
# run selected tests; a failure that reaches main surfaces here within the hour.
#
# Run-only, deliberately: no `workstream:` block. The plan gives this schedule a
# mechanical product — bisect a red batch to the landing that caused it, file
# one issue per landing, alert — and every step of that is derivable, so an
# agent session would only add cost and a place to be creative.
```

```ts
/** The landing at which `file` starts failing, over first-parent landings only.
 *  A file that does not exist at a candidate commit counts as passing: the
 *  search then converges on the landing that introduced it. */
async function blameLanding({ checkout, file, landings }) {
  const index = await bisect({ count: landings.length, passesAt: async (at) => {
    await checkoutCommit({ checkout, commit: landings[at].commit });
    if (!existsSync(path.join(checkout.dir, "beebox", file))) return true;
    return (await runFileAlone({ checkout, file })).exitCode === 0;
  }});
```

- 871 runs; 29 red landings attributed; 28 of those issues closed; 11 were real regressions that got fixed

Notes:
Later additions: a memory-pressure gate (Sep 11), and an import-graph cone check (Oct 6) because under host load the bisect blamed a landing that could not reach the failing test.
