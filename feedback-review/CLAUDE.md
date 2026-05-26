# Feedback Review

Agent feedback is recorded by box agents via `cb feedback` when they notice something
confusing or friction-inducing about the CLI, conventions, or file layout. This
directory provides tooling to collect and resolve that feedback.

## Collecting feedback

```bash
npx tsx collect.ts                        # show all unresolved feedback from ~/src/boxes/
npx tsx collect.ts --boxes ~/src/boxes    # explicit boxes directory
```

Each item shows the box it came from and the full feedback text plus session context.

## Reviewing and resolving

After reading the feedback, decide for each item:

- **Fixable now**: Make the improvement in callback-box source (CLAUDE.md, docs,
  command descriptions, error messages, etc.), then resolve the item.
- **Not actionable / already correct**: Resolve it with a note about why no change
  is needed (you can edit the feedback file before resolving if useful).
- **Needs more thought**: Leave it unresolved for later.

To resolve a specific item:
```bash
npx tsx collect.ts --resolve <filename>   # filename from the listing header
```

To resolve all at once after a review sweep:
```bash
npx tsx collect.ts --resolve-all
```

Resolving moves the file to `config/feedback/resolved/` in its box and commits it.

## Running a review session

1. Run `npx tsx collect.ts` to see what's accumulated.
2. Read through the items. For fixable issues, make the changes in callback-box.
3. Run `npx tsx collect.ts --resolve-all` (or selectively) when done.
4. Commit any callback-box changes.

The goal is to catch patterns: if multiple agents in different sessions report the
same confusion, that's a strong signal that something needs fixing in the docs or
command design.
