---
title: "Main's test box shares the machine secret store with the boxholder's own local boxes"
workstream: unattached
area: beebox
labels: [secrets, dev-router]
filed-by: agent
discovered-by: Ian
discovered-in: main — a test overwrote a real key on 2026-10-18
---

The dev router runs every box that `main` serves on one secret store,
`~/.config/beebox/secrets.json`. That list includes the primary test box,
`test1`, and the boxholder's own local boxes, which hold real keys. Grants
keep the boxes apart per entry, but the entries themselves are shared: a
secret named `replicate` is one value for every box on the machine. A
test-box workflow that sets a value (an agent on the `test1` Secrets panel,
a script, a test) overwrites the real one.

Worktree boxes are already isolated. `workstreams-app/src/router/core/worktree-start.ts`
gives each worktree its own store file and sets
`BBX_SECRETS_STORE_ISOLATED=1`. Its comment states the reason: a worktree's
box "must never touch the boxholder's real secret store". `main` keeps the
default store because "`main` IS the real deployment surface on this
machine". That holds for the boxholder's real boxes, but not for `test1`.

The boxholder's position (2026-10-18): `test1` and the local real boxes
should not overlap this way.

Related: on 2026-10-18 `adapters.test.ts`, run outside tap, wrote a test
value over the real `replicate` key five times. Commit 345d354f9 makes the
store refuse the real file from a test process. That closes the test path
only; the `test1` path remains.

## What to decide

How the router knows which boxes are test boxes.

- **Mark the real boxes.** Every box `main` serves gets its own store, like
  a worktree box, unless it is marked as a real box. Fails closed: a new box
  is isolated until someone says otherwise. Cost: real local boxes need the
  marker once.
- **Mark the test boxes.** Only boxes marked as test boxes get their own
  store. A box nobody marked shares the real store.

Lean: mark the real boxes, in the router's own config (the list it already
reads), not in the box, so a box cannot claim to be real.

Also decide what a test box's store starts with. A copy of the real keys
defeats the point. An empty store means `test1` cannot call paid providers
until someone sets test keys for it. That is the same situation as a
worktree box today.
