# 1,000 to zero in two days
## Supporting: the suppression ratchet, May 30–31
- The preset integration had turned 18 rules off "so the preset would land without mass failures"
- May 30: record every existing violation per file and rule; rules enforce for new code; the count may only shrink
- May 31: zero. Delete the ratchet. Write the rule that outlived it

```json
{
  "src/cli/commands/calendar.ts": {
    "no-optional-chaining/no-optional-chaining": { "count": 1 },
    "no-restricted-syntax": { "count": 1 }
  },
```

```text
All three projects are at zero suppressions, so the ratchet machinery is
vestigial… Harden against silent re-disabling: add a prominent standing rule
to the monorepo CLAUDE.md ("NEVER disable or weaken a lint rule to make code
pass. Ask first.")                                            (8965f1d36)
```

Notes:
Today 190 eslint-disable comments exist in tracked TypeScript; 172 use the one permitted form, a single justified next-line disable.
