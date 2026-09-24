# Testing what agents know and do

Part of [how development happens here](development-process.md). The test tiers,
the doctest syntax, and the helpers are in [testing.md](testing.md); this page
covers what surrounds them and what tests the agents themselves. See also
[agent coding and the checks around it](agent-coding.md) and [the development
workflow](development-workflow.md).

## Testability

Doctests are the default test form: markdown files whose prose explains the
behavior and whose fenced blocks run as executable examples. They come in three
flavors: pure-function, route (through a test server, never a real one), and
filesystem (against a temporary box). Traditional TAP files are reserved for
what a doctest cannot test without circularity.

Every external dependency has a typed fake with observable state, so tests never
hit a real service. Injectability is built into the code; no mock library.

Iteration runs `pnpm test:changed`, which selects the tests the diff implicates,
plus typecheck and lint. There is no full suite at merge. That was measured:
full runs were mostly red for reasons the branch did not cause. Full runs are
batched hourly on `main` instead, bisected to the landing that broke them.

When a diff touches a deployed path, `bin/smoke` runs before the merge: a real
box boots and is walked in a browser, about thirty seconds, no model turns. It
is the only tier that answers whether the app runs, and it exists because
changes passed every other check while the app was broken.

Tours are scripted browser walks producing screenshots at two viewports plus
accessibility and axe reports. A tour is the app's walk written down. They are
deliberately not a gate, because a gate's only response to intended UI change is
to go red; a weekly session walks them and keeps them true. Details are in
[tours.md](testing/tours.md).

## Testing the agents

Two things test agents rather than code. A knowledge audit tests what a box
agent absorbed from the guidance a box loads: its `CLAUDE.md`, generated agent
guide, schema instructions, and prompts. It prompts a real agent, watches its
tool use, and checks the answer against an expected level: knows it, knows what
to read, or can discover it by exploring. The harness is documented in
[knowledge-audits.md](testing/knowledge-audits.md).

The user-stories catalog is a verified list of what the software can do,
produced by agents reading the source. A discovery stage writes claims from the
code. A verification stage sends each claim to a different agent than the one
that wrote it, told to refute when uncertain, including a browser pass against
the running app. A panel stage applies three independent lenses, where a single
refutation upholds a flag rather than a majority vote. Nothing in the document is
asserted by the agent that wrote it.
