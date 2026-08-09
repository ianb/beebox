---
title: "Give the agent one clear temp-file convention (it invents different places today)"
workstream: unknown
area: callback-box
filed-by: agent
discovered-in: "main session — boxholder: the agent has different ideas about where temp files go"
resolution: implemented
---

Resolved by `45322542`. The generated box-agent guide now directs general
scratch files to the box-root `tmp/`, rejects the host `/tmp`, and warns that
the uncommitted contents may be swept. A focused doctest and knowledge audit
cover the convention. The optional validation nudge was not needed.

The agent has **no single, discoverable convention** for where temporary files go,
so it improvises different places (`/tmp`, the box root, an ad-hoc dir). The
boxholder wants **one convention** the agent actually follows.

## Why it happens: the convention exists but is invisible where it's needed

- A box **`tmp/`** dir is the intended scratch space — but it is documented only in
  the dev-repo `docs/box-layout.md:82` ("scratch space (not committed)"). **Box
  agents cannot see dev-repo docs** (per the knowledge-audit rule: a box agent loads
  the box's own CLAUDE.md / agent-guide / rules, not this repo's docs). So the box
  agent has never been told about `tmp/` and picks its own place. (Note the flow-
  specific `tmp-capture/` / `tmp-upload/` dirs are *committed* and different — not
  general scratch.)
- The **dev** side already has a clear one: `scratch/` (gitignored,
  `.gitignore` + `scratch/README.md` + a standing note), for the dev-repo agent.

So this is mostly a box-agent gap: the intended `tmp/` convention needs to live where
the box agent will actually read it.

## Fix direction

- Pick ONE convention per context and state it where that agent sees it:
  - **Box agent** → put "temp files go in `tmp/` (uncommitted); it is swept, don't
    rely on persistence" into the box's own guidance (a box `CLAUDE.md` line, the
    generated agent-guide, or a `.claude/rules/` glob — cb-context territory), not
    just `box-layout.md`.
  - **Dev agent** → `scratch/` already exists; reinforce it (even in-session the
    dev agent has reached for `/tmp`, so the rule may need to be louder).
- Consider a light nudge (a validation warning or a `cb`/hook check) when temp files
  land outside the convention, so drift is caught rather than accumulating.
- Verify with a knowledge audit that a box agent actually absorbs the `tmp/` rule
  (dev-repo guidance can't be audited; box guidance can).
