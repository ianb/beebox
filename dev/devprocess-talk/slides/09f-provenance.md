# Every commit says which stream made it
## Supporting: provenance trailers (Aug 24)
- The branch name gives the workstream; a plan is stamped only when exactly one plan claims it; an `Issue:` trailer that names no file is refused

```text
iOS box screen: drop the box-wide page rows, keep Shortcuts

Dashboard, Browse, History, and Storage are in the web avatar menu now. …

Issue: 2026-09-25-quick-drop-entry-points
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Workstream: quick-chat-design
Plan: box-screen                                              (7a4397a89)
```

- On main: 2,288 commits with Workstream (180 names), 980 with Plan (92 plans), 358 with Issue
- 81% of non-merge commits since introduction carry a workstream

Notes:
Mostly consumed by tooling and retrospectives, including the research behind this deck. Ad hoc queries are rare (3 sessions in 60 days).
