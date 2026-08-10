---
title: "Gmail's no-config default silently flipped from the whole inbox to nothing"
workstream: box-family-email
area: callback-box
filed-by: agent
discovered-in: worktree-box-family-email — investigating growth on a production box
labels: [code-error]
resolution: implemented
---

> **Resolved** in `96fec6cf` (+ review fixes in `01c03821`). The shorthand is
> first-class and must state its `action`; a missing config file now fails the
> sync instead of parsing as zero rules; the admin form gained the "On match"
> control it never had. Plan:
> [gmail-explicit-action](../../../callback-box/docs/implemented-plans/gmail-explicit-action.md).
>
> Direction 3 (a migration) was declined by the boxholder — an existing
> shorthand config without an action errors on purpose, so no box keeps
> collecting on an implied rule. Direction 4 (detecting a connector that
> stopped producing) is the surviving idea and moved to
> [detect-a-connector-that-stopped-producing](../../features/2026-08-10-detect-a-connector-that-stopped-producing.md).

A box with no `config/connectors/gmail.json` behaved in two opposite ways
across one deploy, and was never told about either.

**Before `ba3bf436` ("Implement tracked Gmail working set", 2026-08-05):**
`gmail-pull.ts` fell back to `"label:inbox"` when the config was absent, and the
code acknowledged what that meant — a comment described the first sync of "the
bare `label:inbox` default" as pulling "the user's entire inbox in as cards".
So an unconfigured Gmail connector imported everything.

**After `ba3bf436`:** `readConfig` (`gmail.ts:39`) maps ENOENT to
`parseGmailConnectorConfig({})`, which yields `rules: []`, and `syncWorkingSet`
short-circuits:

```ts
const candidates = work.config.rules.length === 0
  ? []
  : await fetchCandidates({ service: work.service, refs: changes.refs });
```

So an unconfigured Gmail connector now imports nothing.

Both defaults are defensible in isolation. The problem is the transition: the
commit carries no migration, and neither state warns. A box that was silently
over-collecting became a box that is silently collecting nothing, on a deploy,
with no signal in either direction.

## Observed

A production box that had never had a `gmail.json` (the file appears nowhere in
its git history, and it is not gitignored) accumulated 530 email threads over
five weeks under the old default — an unfiltered inbox mirror, 81% of it Gmail's
Updates and Promotions categories. Its owner believed a three-label filter was
in effect. Nothing had ever reported otherwise.

On 2026-08-05 imports stopped dead — not one thread since — while the connector
went on looking healthy: it runs every wakeup, advances its `historyId` cursor,
refreshes already-tracked threads, and commits those refreshes with ordinary
"Pull 1 Gmail thread" messages. Five days passed before anyone noticed, and only
by comparing per-day first-message dates across the thread cards.

## Directions (unsettled)

1. **ENOENT should not silently mean "empty config".** An enabled connector with
   no config file is a misconfiguration, not a valid state — fail loudly, or
   warn every sync.
2. **Zero rules should be reported.** If "import nothing" is ever a legitimate
   configuration it must be visibly distinct from "broken"; if it is not, make
   it a parse-time error.
3. **A default change of this size wants a migration**, even a no-op one that
   writes the previous behavior into an explicit config so the box keeps doing
   what it was doing until someone chooses otherwise.
4. **A connector that used to produce items and abruptly stopped is detectable
   generically** — compare a connector's last-import time against its own recent
   history. That would catch this class without per-connector knowledge. Compare
   [box-growth-warning-cannot-clear](../../bugs/2026-08-10-box-growth-warning-cannot-clear.md):
   the health surface warned loudly and continuously about the box being large,
   while this stall went entirely unreported.

Worth checking whether other connectors have the same absent-config-means-
something shape.
