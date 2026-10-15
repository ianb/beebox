# False start: the reporter blamed itself
## Supporting: thirteen issues for one failure, Aug 26–27
```markdown
Overnight 2026-08-26→27 one real failure (annotations.doctest.md, broken by the
drive-folder-mounts landing) produced THIRTEEN issues and thirteen commits on
main. The first report was correct. Every hourly run after it: still red →
bisect from "last tested commit" → the only new landing is the schedule's own
previous `chore(issues): full-suite red after …` docs-only commit → blame it,
file another issue, commit again. A feedback loop where the reporter's own
commits are the only thing left to blame.
```
- Fix (c6be8b524): a known red is carried forward; a docs-only landing cannot be blamed
- Of the 29 full-suite-red issues ever filed, 16 closed as superseded, most of them this loop

Notes:
Path: issues/closed/bugs/2026-08-27-full-suite-report-loop-blames-its-own-commits.md. Discovered by the developer asking "there were failing schedules again…?". A good example of an unattended system's failure mode: nothing was wrong except the attribution.
