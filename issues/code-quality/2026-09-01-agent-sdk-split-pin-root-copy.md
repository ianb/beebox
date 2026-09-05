---
title: "The monorepo root's unmanaged Agent SDK pin is what `bin/` imports and what `update-agent-sdk --check` measures"
workstream: sdk-update
area: beebox
priority: normal
filed-by: agent
discovered-by: agent
discovered-in: worktree-sdk-update — running `update-agent-sdk --check` during the 2026-09-01 review
labels: [sdk-update]
---

`@anthropic-ai/claude-agent-sdk` is pinned twice. `beebox/package.json` carries
the pin the `sdk-update` schedule maintains (`0.3.251` today). The monorepo root
`package.json` carries a second, unmanaged one, still at **`0.3.226`** —
published 2026-08-08, roughly 25 releases back. The ledger diagnosed the split
when it appeared — see "Monitor reliability — the SDK pin has split in two
(needs a decision)" in `docs/agent-sdk-notes.md`, which called the perpetual
"behind" reading correctly — but it was never filed, and the header line has
since softened it to a reporting quirk. Filing it now, with one effect that
section did not cover.

**1. `update-agent-sdk --check` measures the wrong install.**
`installedVersion()` (`bin/update-agent-sdk.ts:114-115`) reads
`<repo root>/node_modules/@anthropic-ai/claude-agent-sdk/package.json`, while
the script *edits* `beebox/package.json`. So the check compares the root's
frozen `0.3.226` against the newest mature release and reports "behind" no
matter how current the managed pin is:

    $ pnpm update-agent-sdk --check
    @anthropic-ai/claude-agent-sdk is behind: installed 0.3.226, newest mature 0.3.251
    (exit 1)

`0.3.251` *is* the managed pin — the check is red on a fully up-to-date repo.
The same read is why every successful bump ends with the misleading
`Done. Now at 0.3.226`. Nothing currently consumes `--check` (no `doctor` check,
no schedule), so this is latent rather than breaking, but it is a check that
cannot go green and a success message that names the wrong version.


## Partly fixed as of 2026-09-04

`bin/update-agent-sdk.ts` has since been rewritten for multi-family updates
(`8903f08ac`, `340a567a0`) and now reads the **manifest pin** rather than the
root install, so effect 1 is gone:

    $ pnpm update-agent-sdk --check
    Agent SDK (@anthropic-ai/claude-agent-sdk) is up to date: 0.3.259 (binary: 2.1.226 (Claude Code))
    Codex (@openai/codex, @openai/codex-sdk) is up to date: 0.153.0 (binary: codex-cli 0.153.0)
    (exit 0)

Two things still stand. The parenthetical **`binary: 2.1.226`** is still the root
copy's bundled CLI, so the line reports a current pin next to a three-month-old
binary version — note that the Codex line beside it resolves correctly, which
makes the Claude one read as a typo rather than a different install. And effect 2
is untouched: the root `package.json` still pins `0.3.226`, and
`bin/agent-quotas-requests.ts` still imports the SDK from `bin/`, which resolves
there. The fork this issue describes — decide what the root pin is *for* — is
unchanged.

**2. `bin/` tooling runs the old SDK, and therefore an old bundled CLI.** (This
is the part the ledger's original note did not reach: it treated the split as a
reporting defect in the updater, but the root copy is also *executed*.)
`bin/agent-quotas-requests.ts:45` does
`await import("@anthropic-ai/claude-agent-sdk")` from `bin/`, which resolves to
the root copy — verified with `require.resolve` from `bin/`. The SDK bundles the
Claude Code binary it runs and ignores any system `claude`, so that tool drives a
CLI from early August while box agents run the pinned one. Whether that matters
depends on what `agent-quotas` needs from the CLI, which is the part worth
deciding rather than assuming.

**The fork worth deciding, not just fixing.** The narrow fix is to point
`installedVersion()` at `beebox/node_modules`. That makes the check honest and
leaves `bin/` importing a stale SDK. The fuller fix is to decide what the root
pin is *for* — if `bin/` tooling needs the SDK, it should track the managed pin
(or `bin/` should import through the beebox package); if nothing needs it, the
root dependency should go, and `installedVersion()` gets simpler for free.
Removing it is the tidier end state, but it is the one that can break an import
path somewhere in the monorepo, so it wants a look at what actually resolves the
root copy before anything moves.

Context: the "split-pin note" in `docs/agent-sdk-notes.md`, which this issue
supersedes as the record of the problem.
