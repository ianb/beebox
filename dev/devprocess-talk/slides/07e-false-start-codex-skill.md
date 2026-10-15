# False start: a one-directional review
## Supporting: the `codex` skill, Jun 4 → Aug 4
- The first skill had Codex review Claude. Then Codex started doing the work
- A Codex worker invoking it got Codex reviewing Codex: "a same-model self-review wearing the costume of the cross-model check… worse than no review"
- Replaced by cross-model (aae37764a): the reviewer must be the other family, whichever model drives

```text
BEFORE (root CLAUDE.md, carrying its own changelog)
(This used to be written as a Fable-only default; that was wrong, corrected
2026-07-30. It was also one-directional Claude→Codex, which made $codex from a
codex worker a same-model no-op; made bidirectional 2026-08-04.)

AFTER (Sep 12)
The reviewer must use the other model family, regardless of the driving model.
```

Notes:
Also in this family of false starts: the review rule was once Fable-only (corrected Jul 30), and enforcement is still guidance only; a pre-land check for a review marker has been proposed but not built.
