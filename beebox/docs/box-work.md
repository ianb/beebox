# Box work from the dev repo

The rules for running commands, tests, and agents against a box while
developing Bee Box here, grouped by task. Each rule names its reason and the
doc or command that owns it. What a box contains is in
[box layout](box-layout.md); what a box agent reads is in
[box guidance](box-guidance.md).

## Rules for every box

- **Boxes live outside any git repository**, normally `~/src/boxes/<name>/`,
  never under this monorepo, `scratch/` included. A box is its own repo:
  nested, its git and annex commands land on the enclosing repo, and its agent
  inherits this repo's `AGENTS.md`. `bbx engine init` refuses a nested target
  (`NestedBoxError` in `src/cli/commands/init.ts`).
- **Pass box paths as absolute or `~/` paths.** A bare `test1` resolves against
  the current directory, which is inside the monorepo.
- **Box content is private.** Nothing from a real box reaches an issue, commit
  message, comment, doc, or fixture without the boxholder's scrub; use
  `private-issues/` or hold the finding and ask
  ([issues](../../issues/AGENTS.md#private-issues-private-issues--a-separate-repo)).
  `test1` is meant to be generic but may still name real people
  ([open issue](../../issues/docs-and-chores/2026-08-01-test1-real-people-data.md)),
  so check before copying its content into a fixture.
- **Never change credentials to unblock yourself.** `~/.bbx-auth.json` and
  `~/.config/beebox/secrets.json` are machine-wide, shared by every local box,
  and mutating auth commands require `--agent-confirmed`, meaning a human asked
  for that change ([behavioral notes](../AGENTS.md#behavioral-notes)). At a
  login wall, ask the boxholder.
- **`bbx` verbs are the box agent's surface, not developer diagnostics.**
  Box-facing verbs find the box by walking up from the current directory (or
  take `--box`); `bbx engine` verbs start servers and manage the machine.
  `src/cli/entry/surface-data.ts` classifies every verb. From `beebox/`, a box verb
  fails with "Not in a Bee Box"; run it from the box directory, where
  `node_modules/.bin/bbx` is the engine the box is linked to.
- **Box guidance is owned elsewhere.** To place or repair what a box agent
  reads (box `AGENTS.md`, managed skills, schema instructions), use the
  bbx-context skill; to test it, the knowledge-audit skill.

## Running against the test box

`~/src/boxes/test1` is the primary test box; main's dev router serves it.
Each managed worktree gets an isolated clone at
`~/src/box-worktrees/<name>/test1/`, whose `beebox` dependency links to that
worktree's engine and whose secret store is a throwaway file
([secrets](secrets.md#worktree-boxes-have-their-own-store)). In a worktree,
work in the clone, not main's box: the clone is what the router serves at
`/<worktree>/test1/`, and `bin/workstreams reset-test <name>` restores it to
its `test-setup` branch ([worktree lifecycle](../../bin/docs/worktree-lifecycle.md)).

`test1` is a manual playground. Most of its schedules carry `enabled: false`
(a schedule without the field runs); read `_config/schedules/` before relying
on that. `bbx wakeup` runs real agents over its pending jobs and chat threads,
which costs model calls and rewrites the playground, so tell the boxholder
before running one. Which keys a test box may use: [real model
calls](testing/real-models.md#where-the-keys-are). Frontend and iOS evidence
is in the box's `.beebox/client-debug.log` ([client debug
log](client-debug-log.md)).

## Making a throwaway box

Put it at an absolute path outside every git repository, such as a directory
under the session scratchpad or `$TMPDIR`; the monorepo's `scratch/` is
inside a repo. Isolate the machine-wide state the engine reads from home:

```bash
export BBX_AUTH_FILE=/abs/throwaway/auth.json        # local users (src/webapp/local-users.ts)
export BBX_SECRETS_FILE=/abs/throwaway/secrets.json  # secret store (src/core/secrets/store.ts)
export HOME=/abs/throwaway/home                      # ~/.config/beebox, ~/.local/share/beebox
pnpm --dir <worktree>/beebox bbx engine init /abs/throwaway/box
```

`HOME` keeps the box manifests, hub config, and engine state the CLI keeps
under home (`src/lib/state-dir.ts`) away from the real ones. A throwaway
`HOME` also hides the Claude Code login, so a box whose agents must run keeps
the real `HOME` and only the two file overrides. Doctests already do all of
this (`makeTmpBox()` and the test preloads; see [testing](testing.md)); prefer
a doctest when the bug fits one.

## Auditing what a box agent knows

Use the knowledge-audit skill and [knowledge audits](testing/knowledge-audits.md#running-it).
Pass `--box` an absolute path to a standalone box: the worktree's clone, or
`~/src/boxes/test1` from main (the default when omitted). The runner runs
`git reset --hard` and `git clean -fd` in the box between tests, so
`src/dev/lib/box-guard.ts` refuses a box nested in another repo and a box with
uncommitted changes. Fix the path or commit the box's changes; do not work
around the guard.

## Looking at production

- **Deploy state** comes from `bin/deploy-status` (the deploy-status skill),
  which is read-only; use it before improvising SSH
  ([deploy README](../deploy/README.md#checking-deploy-state)).
- **The server** is reached with `deploy/prod-ssh`, which works from a worktree
  by reading the main checkout's `deploy/target.env`. Box data is at
  `/home/beebox/boxes/<box>/`; run `bbx` there as the `beebox` user so file
  ownership stays correct ([operations](server/operations.md#connecting-for-debugging-and-inspection)).
- **Source `/home/beebox/.env` before env-dependent commands.** Ad-hoc SSH does
  not inherit the services' environment, so a bare `bbx health` reports
  connectors missing that are syncing. Suspect the diagnostic before the box.
- **The authenticated app** is reached with `deploy/prod-curl` and
  `deploy/prod-browse`, as the configured owner only. Never change them, or
  mint a session, for another identity without the boxholder's in-the-moment
  permission ([operations](server/operations.md#prod-curl-and-prod-browse)).
- **A bug that only shows on prod or a device** gets the field-probe skill, not
  ad-hoc edits on the server.
- **What you see there is box content**: the privacy rule above applies to
  everything read from production.
