---
title: "Gmail config: explicit action, no implicit tracking"
status: implemented
workstream: box-family-email
issues:
  - ../../../issues/closed/bugs/2026-08-10-gmail-connector-silent-when-rules-empty.md
  - ../../../issues/features/2026-08-10-gmail-reconcile-tracked-set-against-rules.md
---
# Gmail config: explicit action, no implicit tracking

Follows [email tracking instead of mailbox mirroring](../plans/email-tracking.md), which
established the tracked working set. That plan left two shapes for
`config/connectors/gmail.json` — named `rules`, and a `query`/`labels`
shorthand treated as "legacy" — and the shorthand silently implies
`action: track`. This plan removes the implication.

## Boxholder decisions (2026-08-10)

- On the shorthand: *"that syntax should be considered fine (it might be more
  editable)"* — `labels`/`query` is blessed, not legacy.
- On the warning: *"that log is spurious"* — the per-sync legacy warning goes.
- On the admin form: *"the admin page should set the right syntax, not a legacy
  syntax."* Once the shorthand is first-class, what admin writes is correct by
  construction; admin gains the action control it never had.
- On the budget: a single shared rolling budget across the shorthand's labels is
  fine. No per-label budget work.
- On failure mode: *"I definitely don't want the gmail connector to fail open
  like this. At least not with created cards."* A config that does not say
  `track` must never produce cards.

## The defect this closes

`GmailFiltersSection.tsx` can express exactly one outcome: labels and/or a
query. `parseGmailConnectorConfig` turns that into a `legacy-import` rule with
`action: { type: "track" }`. So every path a boxholder can reach through the UI
ends in automatic card creation, and nothing in the UI says so. Card creation
is a side effect of saving a filter.

## Design

`labels`/`query` become a first-class **shorthand** for a single rule. The
shorthand carries its own `action`, the same discriminated union the named rules
use:

```json
{
  "labels": ["fsmn", "grs", "family"],
  "action": { "type": "track" }
}
```

`action` is **required** whenever `labels` or `query` is present. Omitting it is
a `GmailConnectorConfigError`, and an invalid config makes the connector refuse
to sync rather than sync with zero rules — the current empty-rules path is
indistinguishable from a healthy connector with nothing to do, which is the
failure that hid a five-day outage.

The synthetic rule is renamed from `legacy-import` to `shorthand`, which
**discards that rule's machine-local state**. `stateForRule`
(`src/connectors/gmail-rules.ts:24`) looks state up strictly by rule name, so
the old key is orphaned in the gitignored `gmail.state.json`: the automatic
budget history resets, and the rule re-baselines on its first sync — recording
the current match count without importing that backlog
(`src/connectors/gmail-rules.ts:193`).

That is fail-closed and acceptable, but it has a consequence worth stating
plainly: **mail that accumulated while a box was stalled will not be collected
when its action is added.** The rule treats everything already in Gmail as
pre-existing. Anyone repairing a stalled box who wants the gap collected has to
track those threads explicitly (`cb connector gmail track <thread-id>`).

`GmailConnectorConfig.legacy` and the warning it gated both go away. Nothing
else reads `legacy`.

## Tracks

### Track 1 — config schema
`gmail-config.ts`: add `action` to `GmailConfigInputSchema`; require it when
`labels`/`query` is present; reject `action` alongside `rules` (the rules carry
their own); rename the synthetic rule to `shorthand`; drop the `legacy` field.
Keep `MixedGmailRuleConfigError` — `rules` plus `labels`/`query` stays an error.
Also reject `query` together with `labels` (`AmbiguousGmailShorthandError`):
`query` used to silently win, leaving the labels in the file looking effective
while matching nothing.

### Track 2 — connector
`gmail.ts`: drop the `work.config.legacy` warning block. Keep the obsolete-`gc`
warning. Make a config parse failure abort the sync with a logged error rather
than degrading to zero rules.

### Track 3 — no migration (boxholder decision, 2026-08-10)
*"Don't worry about migration, this is the only box that's really using it
anyway. But it's important not to produce all these cards."* An existing
shorthand config with no `action` therefore becomes an error, the connector
refuses to sync, and no cards are produced until a human writes the action.
Failing closed is the point, not a side effect.

### Track 4 — admin API
`admin.ts` `updateGmailConfig`: accept and persist `action`. `gmailConfig`
query: return it. Keep the existing `CONFLICT` refusal when named `rules` are
present. Rename the `usesRules` flag's user-facing copy — "legacy filter form"
is no longer accurate.

### Track 5 — admin UI
`GmailFiltersSection.tsx`: add an "On match" control — track as cards, or run a
procedure with a ref. Saving without a choice is not possible. Update the
rules-present copy.

### Track 6 — docs + tests
`docs/gmail-setup.md` (the shorthand section currently describes it as legacy),
`docs/connectors.md`. Doctests: `connector-gmail-pull.doctest.md` and
`gmail-tracking.doctest.md` cover config parsing; add cases for missing
`action`, a stray `action`, shorthand-with-procedure, and a missing config file.

## Known consequence: outbound drafts share the gate

`syncUnderLock` reads the config, syncs the working set, then uploads pending
drafts. A missing config file therefore also stops outbound draft upload, even
though drafts have nothing to do with collection rules. An explicit `{}` —
"connected, nothing automatic" — is the supported way to run a send-only box,
and it is what the draft doctests now seed. Splitting the gate so drafts upload
regardless is defensible; it was not done here because a box with no config at
all is unconfigured in every other respect too.

## Out of scope

The orphan-reporting command
([reconcile tracked set](../../../issues/features/2026-08-10-gmail-reconcile-tracked-set-against-rules.md))
is a separate deliverable and still needs design. So is
[detecting a connector that stopped producing](../../../issues/features/2026-08-10-detect-a-connector-that-stopped-producing.md),
the generic version of the failure this plan's specific cause created.

## Follow-up: the `stage` action (2026-08-10, same day)

Making the action explicit exposed that the union could not express the state
the boxholder actually wanted first: watch a query, record what matches, act on
none of it. `track` writes cards; `procedure` needs a procedure to exist. There
was no way to say "not yet".

`stage` is that third member — it records the same pending summary a
`procedure` rule records and stops. No card, no trigger, no agent. Read the
list with `cb connector gmail pending <rule>`, promote with
`cb connector gmail track <thread-id>`.

Two properties make it a usable holding state rather than a dead end. Rule
state is keyed by rule *name*, so switching a staged rule to `procedure` later
keeps its baseline (no re-baseline gap) and its accumulated summaries. The
procedure does not run merely because pending exists — it first fires on the
next *matching candidate* after the switch, and reads the whole accumulated
list at that point.

And `stage` records exactly what its eventual procedure would have seen. Only
`track` skips a thread the box already holds, because tracking it again is a
no-op; `stage` and `procedure` both record new mail on an already-tracked
thread. A first pass skipped tracked threads for `stage` too, on the reasoning
that an already-promoted thread does not belong on a to-promote list — a
cross-model review caught that this quietly makes `stage` lossy relative to the
procedure it is standing in for, which defeats its whole purpose.

## Deployment note

`box-family` is stalled at `{}` while its triage procedure is written. The
label rule returns as a `stage` rule once this ships, and becomes a `procedure`
rule when the procedure exists.
