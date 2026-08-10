---
title: "A Gmail connector with no config imports nothing, silently, forever"
workstream: box-family-email
area: callback-box
filed-by: agent
discovered-in: worktree-box-family-email — investigating growth on a production box
labels: [code-error]
---

When `config/connectors/gmail.json` is absent, `readConfig`
(`callback-box/src/connectors/gmail.ts:39`) maps ENOENT to
`parseGmailConnectorConfig({})`, which yields `rules: []`. `syncWorkingSet`
then short-circuits candidate fetching:

```ts
const candidates = work.config.rules.length === 0
  ? []
  : await fetchCandidates({ service: work.service, refs: changes.refs });
```

So the connector imports no new mail at all — while otherwise behaving exactly
like a healthy connector. It runs on every wakeup, advances its `historyId`
cursor, refreshes threads it already tracks, and commits those refreshes with
ordinary "Pull 1 Gmail thread" messages. Nothing logs, nothing warns, and the
health check reports the connector fine.

Observed on a production box: mail arrived at a steady 8–24 threads/day for
five weeks, then stopped dead on a specific day and stayed stopped for five
more. The box kept committing Gmail activity the whole time — those commits
were updates to the 530 already-tracked threads. The stall was invisible from
every surface the boxholder looks at; it surfaced only by comparing per-day
first-message dates across the thread cards.

The trigger there was config loss: `gmail.json` was untracked (it is not
gitignored, and never appeared in that box's git history), so a working-tree
clean removed it along with a large population of untracked files. But the
config could go missing any number of ways — the point is that losing it
degrades to a silent no-op rather than an error.

Two distinct problems, both worth fixing:

1. **ENOENT should not silently mean "empty config".** A connector that is
   enabled but has no config file is a misconfiguration, not a valid state.
   Either fail loudly, or warn every sync.
2. **Zero rules should be reported.** Even with a config present, an empty
   `rules` array means "import nothing". If that is ever a legitimate
   configuration it needs to be visibly distinct from "broken"; if it is not,
   it should be an error at parse time.

A third, weaker direction: a health check that compares a connector's
last-import time against its own recent history would catch this class
generally — any connector that used to produce items and abruptly stopped —
without needing per-connector knowledge. Related surface:
[box-growth-warning-cannot-clear](2026-08-10-box-growth-warning-cannot-clear.md),
which warns loudly about a box being large while this stall went unreported.

Separately: connector config files are a box's real configuration and should be
tracked. Worth checking whether anything ensures that, given
`google-calendar.json` was tracked on the same box while `gmail.json` was not.
