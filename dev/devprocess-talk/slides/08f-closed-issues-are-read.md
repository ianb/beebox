# Do agents read closed issues?
## Supporting: closed issues in the transcripts
- Yes, but mostly around the close. 430 Claude transcripts (of 3,566, subagents included) read at least one closed issue; 385 of the 717 closed issues have been read at least once
- Of 931 such reads, 422 happen in the closing workstream or on the closing day; 319 come a week or more later (157 after 30 days)
- Open issues get five times the traffic: 4,687 reads across 979 files
- By category of closed issue read: bugs 476, features 216, decisions 77, code-quality 73, exploration 51, docs-and-chores 38
- Most-read closed issues are decisions and conventions: the architectural-review open decisions (15), the release-provider honesty decision (11), categorize-issues-into-subdirectories (10), skill-description triggering conditions (9)

Notes:
Same method as the plans slide: real reads only (Read tool, or cat/sed/grep in a shell), not edits or moves; "age" uses the closing commit's date on main, so a read inside the closing worktree shows as before close. Codex: 7 transcripts, 11 files. The shape differs from plans: a shipped plan is read as a design record for months; a closed issue is read while being closed, then by the "fixed?" and duplicate checks the issue skills require, and the long tail is decisions.
