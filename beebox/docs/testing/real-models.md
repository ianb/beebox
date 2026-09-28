# Real model calls

Calling real models and provider APIs from a workstream, to understand or
check behavior that a fake cannot show.

## What it is

Many features depend on what a model actually returns: a Jev judgment's
probabilities, a small model's classification, a transcription. Service fakes
(`BBX_JEV_FAKE`, the doctest service fakes) keep the test suite fast and
deterministic, but they cannot tell you how the real service behaves. For that,
call the real thing.

Real calls are allowed and expected when they answer a question the work needs
answered. Do not assume they are off limits. Check what is available, then
decide. Jev and the small models cost fractions of a cent per call, so an
experiment of dozens or hundreds of calls needs no permission.

Real calls do not belong in committed doctests: they are slow, cost money on
every run, and change their answers. Use them for experiments, calibration, and
one-off verification, and record what you learned in the plan, issue, or test
data.

## Where the keys are

There are two routes, and they are separate.

- **Box code** (anything that runs through a box, such as `bbx judge`, triage,
  or chat) reads keys only from the machine secret store,
  `~/.config/beebox/secrets.json`, and only for a box that has been granted
  the secret ([secrets](../secrets.md)). Grants are keyed by box slug, so a
  worktree's test box has the grants of `test1`. Check them with
  `bbx secrets status` run inside the worktree's test box
  (`~/src/box-worktrees/<name>/test1/`). It shows names and grants, never
  values.
- **Dev scripts and experiments** outside a box can use the provider keys in
  the worktree's `beebox/.env`, which every worktree copies from main. Load
  them into the script's own environment. Read the names you need; never print
  or copy a value into a file, commit, log, or message.

If the key a test box needs is not granted, do not grant it and do not change
the secret store. A missing grant is a question for the boxholder; say which
secret, which box, and why.

## When to ask first

Ask the boxholder before a real call when:

- **Real content leaves the machine.** A call sends box content to a third
  party. Test-box content, fixtures, and synthetic data are fine. The
  boxholder's own boxes, local copies of them, and anything on production are
  not, without permission.
- **The cost is not small.** Expensive models, large batches, or long agent
  runs. State the rough cost when you ask.
- **The call does something.** Anything that sends a message, notifies a
  person, or changes an external account is not a test call.
