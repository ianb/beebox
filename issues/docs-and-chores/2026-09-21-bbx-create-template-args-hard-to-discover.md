---
title: "`bbx create`'s key=value template arguments are undiscoverable: the natural flag guess errors with no pointer to --describe-template"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: main — production box feedback triage (bbx feedback)
priority: important
---

An agent reflexively wrote `bbx create path -t browser-task --title X --source
Y` and got `error: unknown option --title`. The real form is positional
`key=value` pairs, but nothing in the immediate failure or in `--help` says
so for the template actually being used.

## Mechanism

`beebox/src/cli/commands/create.ts:31` registers the args argument as:

```
.argument("[args...]", "Template arguments as key=value pairs")
```

This is generic across every template — it names the *form* but not what any
given template accepts. Commander's own "unknown option" error for
`--title`/`--source` fires before the action handler runs, so it can't
suggest `--describe-template <name>`; the agent has to already know that flag
exists.

The agent guide has the matching gap: it shows `-t` for every template and
mentions JSON values in passing, but (per the report) never shows a worked
`key=value` example being passed to `bbx create`, so the flag form remains the
natural first guess for anyone who hasn't already read `--describe-template`'s
output.

## Why the fix is not obvious

- Commander's argument parser raises "unknown option" generically, before
  `bbx create`'s own action code runs, so intercepting that specific error to
  append "template arguments are passed as key=value, try
  --describe-template <name>" means either a custom Commander error handler
  or pre-scanning `process.argv` for option-like tokens before Commander gets
  to reject them — more surface area than a one-line message.
- The guide fix (one worked key=value example in the create section) is
  cheap on its own, but doesn't cover templates the guide doesn't already
  enumerate, including any a box defines locally — the CLI-side error
  message is the fix that reaches every template, including box-local ones.
