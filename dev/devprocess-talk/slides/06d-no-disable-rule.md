# The same rule, before and after calibration
## Supporting: root CLAUDE.md, May 31 vs Sep 12
- "Remove attempts to convince a capable reader": the history and the rhetoric go, the scope and the one exception stay

```text
BEFORE (8965f1d36 → unchanged to Sep 12)
**NEVER disable or weaken a lint rule to make code pass. Ask first.** Every
rule in the preset is a deliberate choice, and several restate code-style.md.
Do not — without the user's explicit, in-the-moment permission — turn a rule
"off"/"warn", loosen its options…, delete a rule from a config, add a blanket
/* eslint-disable */, or sprinkle // eslint-disable-next-line to dodge
violations. This is exactly how the configs silently drifted out of sync with
our own style for months… Instead: **fix the code.** … When in doubt, ask…

AFTER (c8c728285)
**Do not disable or weaken lint rules to make code pass without explicit
permission for that change.** This includes rule removal, lower severity,
looser options, and suppressions. Fix the code; ask if the rule needs changing.
The existing exception is one `eslint-disable-next-line <rule> -- <concrete
justification>` for a true, narrow false positive.
```

Notes:
The history did not vanish: it now sits in beebox/code-style.md as the reason for the rule, read when someone edits the style contract rather than on every turn.
