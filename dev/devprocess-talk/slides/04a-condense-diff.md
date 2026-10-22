# Seven principles become seven lines
## Supporting: the March 3 condense, 66a45f868 (+14 / −114)
- The reasoning moved behind a pointer to docs/DESIGN.md; the summary stayed

```text
BEFORE (one of seven sections, 8–12 lines each)
### 2. All History in Git
Git is the state engine. A change hasn't "happened" until it's committed. …
This enables **true time travel**:
- Checkout any commit and the system is in that exact state
- Replay any sequence of operations from any point
…

AFTER (the whole section)
## Guiding Principles
See `docs/DESIGN.md` for detailed rationale. Summary:
1. **Filesystem is state** — No databases, no hidden state. …
2. **Git is history** — A change hasn't "happened" until it's committed. …
…
```

```text
BEFORE: ### Adding Documentation (7 lines: add to the Doc Map, write a purpose, link it…)
AFTER:  When adding a doc to `docs/`, add it to the Doc Map above. One topic per document.
```

Notes:
The commit body: "Move verbose design principles behind docs/DESIGN.md reference to keep CLAUDE.md focused."
