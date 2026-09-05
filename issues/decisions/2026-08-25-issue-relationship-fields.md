---
title: "Add relationship fields to the issue schema? (blocked-by, related, superseded-by)"
workstream: unattached
area: docs
needs: [decision]
filed-by: agent
discovered-by: agent
discovered-in: "worktree-beads-vs-issues — comparing Beads' typed dependency edges against our frontmatter"
priority: normal
---

The issue schema is closed and has no machine-readable relationships between
items. Clusters are re-derived on every `bbx-pick-issues` run
(`bin/issues similar`, grep), ordering ("B after A") lives only in prose, and
`resolution: superseded` names no target. Beads models all of this as typed
edges (`blocks`, `parent-child`, `related`, `discovered-from`, `duplicates`,
`supersedes`) and derives `bd ready` from the blocking ones. Analysis:
[Beads vs. our issues/ queue](../../research/beads-vs-issues.md) §2.5–2.6.

## Proposal

Three optional frontmatter keys, values are bare basenames (the same stable
key the `Issue:` commit trailer uses; `doc-check` already validates them):

```yaml
blocked-by: [2026-08-01-foo]         # do not start before these close
related: [2026-07-04-bar]            # cluster, follow-up, found-while
superseded-by: 2026-08-10-baz        # closed/ only, with resolution: superseded
```

Consumers: `bin/issues show` prints inverse edges; `groups --by related`
becomes a cluster query; `/finish` notes in B when it closes an A that B is
`blocked-by`. No `bd ready` equivalent; the developer still picks work.

## Related Beads concepts that resolve here, not as new categories

- `milestone` ("completion of a set of related issues, no work itself") is
  an issue whose `blocked-by:` lists its members; it closes when they all
  close. A use of the field.
- `pinned` (persistent, protected from close/stale) is standing agent
  context, which lives in CLAUDE.md/docs here. Not needed.
- `message` (inter-agent mail as beads) is a mailbox; `bin/comments` and
  schedule reports already cover it. Not needed.

## Against

329 open items, most with nothing worth linking; agents will pad the field;
it is a schema change (`issues/CLAUDE.md` + `KNOWN_FRONTMATTER_KEYS` in
`workstreams-app/src/server/issue-domain.ts`) and a parser/browser change.
`superseded-by` alone is the cheap, clearly useful half if the rest is rejected.

## Decision needed

Add all three, only `superseded-by`, or none.
