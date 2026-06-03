# scratch/

Gitignored scratch space for throwaway artifacts — orientation docs the
agent writes to share with the user, intermediate outputs, dumps that
shouldn't enter version control.

**This README itself is tracked** (via the `!scratch/README.md` exception
in the root `.gitignore`) so the convention survives even when the
directory is otherwise empty. Everything else inside `scratch/` is
ignored by git.

## When to use this

- The agent writes a one-off reference doc the user wants delivered
  as a file but doesn't want as a permanent project doc.
- Quick reports, mined log summaries, diff snapshots — anything you'd
  otherwise be tempted to put in `/tmp` (don't).
- Drafts of something that *might* become a real doc once the shape
  is clear; promote to `docs/` (or another tracked location) once it
  earns its keep.

## When NOT to use this

- Anything that other contributors need to see → real docs / `docs/`.
- Anything that's part of an actively-used workflow → real code / scripts.
- Anything the agent needs to find in a future session → `docs/ideas.md`
  or auto-memory (the memory system survives across sessions; scratch
  files don't carry forward).

## Lifecycle

No cleanup policy yet. If it grows unmanageable, prune by hand or add
a sweep to a periodic task. Files here can vanish at any time.
