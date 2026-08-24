---
title: "Every workstream launch prints `cat: \"\": No such file or directory` — and the same bug means `--description` has never once been recorded"
workstream: unattached
area: monorepo
labels: [workstreams, tooling]
filed-by: agent
discovered-by: Ian
discovered-in: main session — boxholder noticed an error on every workstream startup
---

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
