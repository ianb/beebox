# Did the guidance reach the agent?
## Supporting: one knowledge audit entry
- A prompt to a real box agent, plus mechanical checks on what it read, ran, and wrote
- 406 entries today; 1,042 recorded runs since June; the July rerun of 217 closed 9 real gaps

```yaml
- id: law-checking-box
  prompt: >
    Before I head to the store: how much red wine does my beef stew take?
    Half a cup, like most stews, right?
  expected_level: knows_directly
  watch_for: >
    Looks the recipe up in the box (`bbx search`) before answering, then says
    1 cup, correcting the half-cup guess. FAILS on agreeing with half a cup
    or answering without looking.
  should_search: box
  correct_matches: ["\\b(?:1|one)\\s+cup\\b"]
```

Notes:
Path: beebox/src/dev/knowledge-audits.yaml. This audit guards one of the four "laws" in the box agent guide (bottleneck 6). Since Oct 7 the same harness also audits a Claude Code session in the dev repo.
