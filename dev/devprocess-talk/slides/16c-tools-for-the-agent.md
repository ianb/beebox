# The tool's user is the agent
## Supporting: the browse harness, developed indirectly
- The human never drives the browser. The harness is judged by whether the agent's reports hold up
- 86 commits touch it; of the 24 with a workstream trailer, 21 came from streams doing other work
- Aug 23: a journey walker read silent clicks as the app doing nothing. The fix: ids on 190 controls, an actionability check, a refusal with a reason
- Aug 18: screenshots hung on any page without the app's ready marker; found while checking a feature
- Oct 8: three "upload failures" in a walk report were one path-resolution bug; fixed from the walk

```
browse: act by cb- id, refuse silent clicks, and put ids on every static control
  agent-browser's click is a box-center mouse event with no preconditions:
  disabled, covered, off-screen, zero-size ... all report '✓ Done'.
  A journey walker read those as the app doing nothing.
```

- The human's part: ask the agent whether the tool served it, and let the fix land in passing
- Same shape for the context router, the issues CLI, the doc browser and the test ledger

Notes:
"The quality of the result is how well it works for the agent, not for me, and I mostly poke at the agent indirectly to improve things for itself." The honest cost: the human cannot feel a bad harness, so the signal arrives late, as misread results (walk reports that blamed the app) rather than as friction. The counter is to read the agent's reports against the record, which is motif 9.
