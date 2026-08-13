---
title: "Support Codex as a box engine alongside Claude Code — refresh the research and decide"
workstream: unattached
area: callback-box
needs: [decision, design]
labels: [engine, vendor-risk, research]
filed-by: agent
discovered-by: Ian
discovered-in: main session — boxholder decision to reduce single-vendor exposure
---

Ian wants callback-box able to run on **Codex as an engine**, not only Claude
Code, to reduce exposure to a single vendor's product decisions. There was no
issue for it; there is substantial prior research, now a month old and written
before the trigger.

## Start from the research, don't redo it

`research/backend-alternatives/` (2026-07-18) is seven documents on exactly this:
an SDK coupling audit, alternative harnesses, drop-in providers, a ChatGPT
subscription path, vLLM self-hosting, Anthropic policy enforcement, and a
synthesis with recommendations and a watchlist.

**The finding that governs everything**, from the coupling audit's verdict:

> what callback-box delegates to `@anthropic-ai/claude-agent-sdk` is not a loop,
> it's a **runtime**

The SDK spawns the bundled Claude Code binary, and the product leans on Claude
Code's *harness* — built-in tools, context-file loading, hooks, session store,
transcripts, auth — not merely its agentic loop. That reframes the task: this is
not "swap the model", it's "re-provide a runtime".

The audit splits it into two integration shapes:

- **Shape A — a different model provider *under* Claude Code**
  (Anthropic-compatible endpoint, `ANTHROPIC_BASE_URL`). Touches almost nothing;
  all coupling layers stay intact. Categorically cheaper.
- **Shape B — a different harness** (Codex CLI, OpenCode, Goose…). Must replace
  or re-provide every layer.

**Codex is Shape B**, the expensive one. The audit ranks swap cost, most
expensive first: harness contract > transcript files > chat backend/streaming >
batch agent surface > auth UX. Notably the message-protocol layers are in better
shape than first assumed (adapter boundaries mostly exist); the *runtime* layers
are worse, and were invisible to the first pass because they don't live in
`src/core/agent/` at all — layer 3 reads Claude Code's **private on-disk
transcript store**.

## What this issue adds to the research

**The trigger changed.** The synthesis weighed vendor risk as a watchlist item —
things like a credit-pool split or differential throttling. Ian's concern is now
about **output quality and product direction**, which the research didn't model
and which no amount of provider-swapping under Claude Code (Shape A) addresses.
If the objection is to what the harness produces, Shape A is not a hedge.

So the research needs a refresh pass with a different question at the front:
*given the goal is independence from Anthropic's product decisions, what is the
cheapest thing that actually delivers it?*

## What to work out

- **Re-read the watchlist against today.** Several items were "monitor this";
  some may have fired.
- **Scope the harness re-provision concretely.** The audit says what would have
  to be replaced; turn that into an estimate. Layer 3 (reading Claude Code's
  private transcript store) is the one that looks least tractable and most
  likely to need a real design.
- **Partial adoption is probably the answer.** Worker sessions already run on
  Codex routinely (`bin/launch-worktree-session --agent codex`) and `/finish`
  lands their work, so the *development* side is already dual-vendor. The
  exposure is specifically the **box engine** — `cb wakeup`, chat sessions,
  scheduled procedures. Naming that boundary may make this much smaller than
  "support Codex everywhere".
- **What degrades?** Codex has no `--worktree`, no equivalent hook surface, and
  a different session/transcript model. Decide which box features are allowed
  to be Claude-Code-only, if any, rather than discovering it during a port.
- **Cost and quota.** Ian already tracks Codex usage; making it the engine for
  every box turn is a different order of consumption than worker sessions.

## Related

- `research/backend-alternatives/2026-07-18-synthesis.md` — recommendations and
  the watchlist to re-evaluate.
- `research/backend-alternatives/2026-07-18-sdk-coupling-audit.md` — the layer
  map any port has to satisfy.
- The Agent SDK monitor's ledger (`docs/agent-sdk-notes.md` at the repo root)
  already tracks upstream SDK *and* Claude Code releases — a good place to
  notice a change that raises or lowers the urgency here.
