# The evidence stays in the tree
## Supporting: how this talk was built
- Nothing here came from memory. Each number came from a file in git or a local store, with the command beside it
- Issues carry `discovered-in` (who found it, doing what) and `resolution:` (how it ended)
- Provenance is free for the agent and not for a person: 1,018 of 1,036 agent-filed issues name where they were found; 4 of 190 developer-filed ones do
- Plans carry a `.review.md` with a disposition per finding; the landing script moves them
- Commits carry Workstream, Plan and Issue trailers; the hook refuses a trailer that names nothing
- Runs, alerts, the test ledger, the cleanup log and the transcripts are readable stores
- So "do agents read old plans?" took an afternoon to answer, and the answer had line numbers

```
$ git log --format='%(trailers:key=Workstream,valueonly)' -- browse bin/browse | sort | uniq -c
   4 journey-walk
   3 journey-walks-oct
   2 skills-review
   ...
```

- The record is uneven: git is durable; some local stores keep no history, so some questions have no answer
- The same record found the failures: 13 hourly duplicates, 83 sigil violations, 4 of 128 exhibits answered

Notes:
"By putting things like issues in the repository, and plans, and setting up the ability to read sessions, this means I can have good discussions about what happened and how well the system works, and there's evidence left over for all of it." The contrast is a tracker or a chat history: the record exists, but it is not next to the code, not under the same hooks, and not readable by the next agent. This motif is the precondition for bottleneck 7, the process measuring itself.
