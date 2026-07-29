---
title: "Chat review's journal is machine-local but the husk it guards is shared, so two machines fight"
area: callback-box
filed-by: agent
discovered-in: worktree-compacting — checking prod retention after shipping chat review
---

[Chat review](../../callback-box/docs/chat-review.md) keeps two pieces of state
about a session, and they live on opposite sides of the sync boundary:

- **The span journal** — `.callback-box/chat-review/state.json`. `.callback-box/`
  is **gitignored**, so this is per-checkout machine state.
- **The husk card** — `store/chat/web/*.chat.card`, carrying `title`,
  `contains`, `contains-evidence` and the `review-span` marker. Git-tracked,
  pushed, and pulled by every other checkout of that box.

A box that exists in more than one place — and the deployed ones all do; prod
serves `/home/callback/boxes/<box>` while the same box is cloned to a laptop —
therefore has **one shared account and N independent journals.**

## Why transcripts make this worse rather than better

Transcripts don't sync at all. `~/.claude/projects/**` is per-machine, so each
checkout only holds the transcripts for sessions that *ran there*. Confirmed
2026-07-29: the estate husk's session `05975df0` has no transcript on the laptop
and a live 1.2 MB one on prod, because that conversation happened on the server.

So the two machines don't just have separate journals — they see **different
subsets of the conversation**, and neither sees all of it.

## The failure

1. Prod reviews a session, extends `contains-evidence`, writes `review-span: X`,
   advances its own journal. Commits and pushes.
2. The laptop pulls. Its journal has no entry for that session, so `resolveSpan`
   bootstraps — but the laptop's transcript for that session is missing or is a
   *different* slice of the conversation.
3. If the laptop has any transcript at all, it computes a span id ≠ X, so the
   `review-span` short-circuit does not fire. It calls the model, extends the
   account a second time from partial material, and overwrites `review-span`.
4. Prod pulls, sees a `review-span` it didn't write, and does the same in
   reverse.

Net effect: the account is extended repeatedly from partial views, `review-span`
ping-pongs, and the exactly-once guarantee — the whole point of the journal —
holds only per-machine, not per-box.

The husk is also a git-tracked file being rewritten on two machines, so this is a
merge-conflict generator on top of being semantically wrong.

## Not currently firing — and the reason is structural, not luck

Measured 2026-07-29:

- **All six prod boxes have local clones** (`ai-class`, `birch`, `box-family`,
  `estate`, `personal`, `tech-talk`), so the shared-husk half of the setup is
  the normal state, not an oddity.
- **Only prod runs a scheduler.** `launchctl` on the laptop lists only
  `com.callback-box.sdk-update` — no `cb tick`, no scheduler daemon. So there is
  exactly one automatic writer per box today.

That single-writer property is what keeps this latent, and nothing enforces it:
`enabled: true` ships to every checkout of every box, so the day a laptop runs a
scheduler — or someone runs `cb chat review run` by hand on a box prod also
reviews — there are two writers and the divergence above starts.

A manual local run during the 2026-07-28 eval did **not** trigger it: prod has
neither that session's transcript nor its husk (the conversation ran on the
laptop and the husk is still untracked there), so the two sides never met.

## Options, unsettled

- **Move the journal onto the husk.** `review-span` is already there; the rest of
  `AppliedSpan` (`endUuid`, `prefixHash`, `endIndex`) could join it. Then state
  and account travel together and any machine can continue where another left
  off. Cost: more machine bookkeeping on a card the boxholder reads, and the
  card churns on every pass.
- **Make the pass single-writer by construction** — a box-level "who reviews this
  box" claim, or only reviewing sessions whose transcript is present locally
  *and* which no other checkout has claimed.
- **Accept per-machine coverage and make it explicit** — each machine reviews
  only what it can see, and the account records which machine contributed what.
  Honest, but the account stops being a single coherent record.

Related: [stale husks](../features/2026-07-29-stale-husks-outlive-their-transcripts.md)
— the same sync asymmetry is why "transcript gone" is ambiguous between *expired*
and *ran elsewhere*.
