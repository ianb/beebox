# Do agents read old plans?
## Supporting: shipped plans in the transcripts
- Yes. 227 Claude transcripts (of 3,566, subagents included) read at least one shipped plan; 144 of the 214 shipped plans have been read at least once
- More than half of those reads (269 of 479) come a week or more after the plan landed; 156 come after 30 days
- The most-read shipped plans are the ones that define a subsystem's shape:

| Shipped plan | Transcripts that read it |
|---|---|
| todo-annotation | 23 |
| boxes-as-packages-v2 | 19 |
| workstreams | 13 |
| secret-custody | 13 |
| model-engine-policy | 11 |
| doc-structure, todo-collection, user-story-audit-followups | 9 each |

- Active plans get far more traffic (1,132 reads across 166 files); parked and superseded plans almost none (11)

Notes:
Counts only real reads (the Read tool, or cat/sed/grep in a shell), not edits or moves. Transcripts go back to late July. Codex: 30 transcripts, 28 files. Two consequences: the package rule "Do not use historical plans as live manuals" exists because shipped plans are in fact read as manuals; and the doc graph's 98 orphans under implemented-plans are reached by path, not by link. Method and command: reports/sweep-numbers.md and the inventory entry "Plan docs and lifecycle directories".

What the late reads are for (204 reads a week or more after landing, by the reading session's purpose): about 115 are repo-wide audits that read many plans at once (a prior-art credit sweep, the research behind this talk, doc and layout sweeps); about 60 answer a question the human asked in the moment; about 15 are research for a new plan in the same area; the rest are workstream pickups and landing mechanics. The in-the-moment reads are where the record pays: "is this a regression?" answered by the feature's own plan ("the + has never worked on transcript text; the design doc says so"); "why was the badge removed?" answered by a plan that sequenced the removal after a replacement that never shipped; "does the todo system already do this?" answered by the plan's pipeline description; "can a test box reach my real secrets?" answered by the custody plan's isolation section. The plan gives intent and sequencing, which the code cannot. Only 26 of 204 later replies cite the plan by name, so most reads inform silently.
