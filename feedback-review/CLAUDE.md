# Feedback Review

Agent feedback is recorded by box agents via `bbx feedback` when they notice something
confusing or friction-inducing about the CLI, conventions, or file layout. This
directory provides tooling to collect and resolve that feedback.

## Collecting feedback

```bash
pnpm dlx tsx collect.ts                        # show all unresolved feedback from ~/src/boxes/
pnpm dlx tsx collect.ts --boxes ~/src/boxes    # explicit boxes directory
```

Each item shows the box it came from and the full feedback text plus session context.

## Reviewing and resolving

## The flow is feedback → issue → workstream

Feedback is an **inbox**, not a work queue. Triage happens here, in the main
checkout: read an item and either fix it on the spot, promote it to an
`issues/` item, or resolve it as not-actionable. A workstream then owns the
*issue*, and `/finish` closes the *issue* — never the feedback item.

`/finish` used to resolve feedback directly (its old step 7, removed
2026-08-12). Two reasons it was wrong there. Layering: it made a workstream
answerable to raw capture rather than to a triaged item, skipping the judgment
step. And mechanics: `/finish` runs inside a worktree, while `collect.ts` needs
`deploy/target.env`, which exists only in the main checkout — so a worktree run
silently skipped every remote box, which is where nearly all real feedback
lives. The step couldn't do its job by construction.

Note that `bbx feedback` gets used as a **general capture channel**, not only for
CLI friction — a single pull can mix tool bugs, research pointers, and personal
notes. Triage can't be mechanical; sort by kind first, and don't force
everything into `issues/`.

After reading the feedback, decide for each item:

- **Fixable now**: Make the improvement in beebox source (CLAUDE.md, docs,
  command descriptions, error messages, etc.), then resolve the item.
- **Not actionable / already correct**: Resolve it with a note about why no change
  is needed (you can edit the feedback file before resolving if useful).
- **Needs more thought**: Leave it unresolved for later.

To resolve a specific item:
```bash
pnpm dlx tsx collect.ts --resolve <filename>   # filename from the listing header
```

To resolve all at once after a review sweep:
```bash
pnpm dlx tsx collect.ts --resolve-all
```

Resolving moves the file to `config/feedback/resolved/` in its box and commits it.

## Running a review session

1. Run `pnpm dlx tsx collect.ts` to see what's accumulated.
2. Read through the items. For fixable issues, make the changes in beebox.
3. Run `pnpm dlx tsx collect.ts --resolve-all` (or selectively) when done.
4. Commit any beebox changes.

The goal is to catch patterns: if multiple agents in different sessions report the
same confusion, that's a strong signal that something needs fixing in the docs or
command design.

## Talking to the remote server

`collect.ts` reads/resolves feedback from boxes on `box.example.com` as
well as local boxes. All remote ops go through `runOnServer()` in
`run-on-server.ts` (the single chokepoint). If you're touching the remote
path here, read [`beebox/docs/server-operations.md`](../beebox/docs/server-operations.md#writing-scripts-that-run-on-the-server)
for the rationale and the rule — short version: never SSH as root and write
inside `/home/beebox/` directly; always drop to the `beebox` user first.
`runOnServer` defaults to that.
