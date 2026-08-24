---
title: "Every workstream launch prints `cat: \"\": No such file or directory` — and the same bug means `--description` has never once been recorded"
workstream: unattached
area: monorepo
labels: [workstreams, tooling]
resolution: implemented
filed-by: agent
discovered-by: Ian
discovered-in: main session — boxholder noticed an error on every workstream startup
---

> **Fixed 2026-08-24.** `bin/lib/launch-session.sh` now emits unescaped inner
> quotes and tests the file with `-s` rather than the path with `-n`, so an
> absent description is simply empty instead of a failed `cat`. **Both** the
> claude and codex launcher branches carried the bug and both are fixed.
> Verified by generating launchers for each agent with and without a
> description file: the old form printed
> `cat: "": No such file or directory`, the new one is silent when empty and
> yields the text when set.
>
> **Backfilled**, through `session_registry_merge` so the lock protocol held:
> 44 of 57 registry entries, from three sources in descending trustworthiness —
> the exact `--description` strings passed during this session (10), the `title:`
> of a plan doc carrying that `workstream:` (17), and the `title:` of an owned
> issue (17, suffixed `(+N more issues)` where a stream owns several). The
> remaining 13 had no authored source and were left blank rather than invented:
> `browse-ws-auth`, `chat-bookkeeping`, `cloud-env`, `exit-dialog-probe`,
> `file-visualizer`, `github-pages-site`, `ios-clear-mic`, `lint-speedup`,
> `demo-schedules`, `streaming-scroll`, `tiddlywiki-research`,
> `tiling-backgrounds`, `workstreams-rehearsal`.
>
> Note the derived two-thirds are approximations: an issue title describes a
> problem, not a stream's scope. Good enough for routing, not authoritative.

Every workstream startup prints a `cat` error. It looks cosmetic. It is the
visible half of a bug that has silently disabled the workstream **description**
feature since it shipped.

## The generated launcher is malformed

`bin/lib/launch-session.sh:43` writes the launcher through an **unquoted**
heredoc (`cat > "$LS_LAUNCHER" <<EOF`):

```bash
--arg description "\$(if [ -n \"${LS_DESCRIPTION_FILE:-}\" ]; then cat \"${LS_DESCRIPTION_FILE:-}\"; fi)" \
```

In an unquoted heredoc `\` keeps its meaning only before `` $ ` \ `` and
newline — **not before `"`**. So the backslashes survive into the generated
file. Reproduced by generating one:

```bash
--arg description "$(if [ -n \"\" ]; then cat \"\"; fi)"
```

At runtime bash sees `\"\"` as the two-character literal `""`. `[ -n '""' ]` is
**true**, so it runs `cat '""'` — a file literally named `""`. Hence the error
on every launch.

**With a real description file it is equally broken**: the test passes and the
command becomes `cat '"/path/to/desc"'`, quotes included, which also fails.
There is no input for which this works.

## The consequence nobody saw

`cat` fails → the command substitution is empty → `--arg description ""` →
the jq filter drops it (`if $description == "" then {} else …`). So the
description is never written to the session registry.

Verified: **no workstream in the registry has a `description` field**, and
`bin/workstreams list`'s DESCRIPTION column is empty for every row — including
a dozen launched today, every one of which passed `--description`.

That matters more than the noise. Descriptions exist specifically so a later
clerical session can route work to an existing workstream without reconstructing
what it covers — the ask in
[no way to know what a workstream covers](../features/2026-08-20-no-way-to-know-what-a-workstream-covers.md)
and the reason `bin/workstreams list` grew the column. **The feature shipped
non-functional**, and its failure signal was an error message that reads like
harmless shell noise.

## Fix

The escaping. The neighbouring lines get it right —
`--arg tty "\$(tty 2>/dev/null || true)"` uses unescaped inner quotes and works.
The same shape here would too.

Worth doing alongside:

- **Backfill.** Existing rows have no description and no launcher will supply
  one retroactively; decide whether they stay blank or get filled from the
  briefing's first line.
- **Make the launcher's own errors visible as errors.** A generated script that
  emits a failed `cat` on every run went unnoticed for as long as the feature
  has existed. A `set -e`-style failure, or simply not swallowing it, would have
  surfaced this the first time.
- **Check the sibling paths.** `bin/lib/launch-session.sh:108,113` build codex
  invocations through the same heredoc; confirm their quoting survives too.
