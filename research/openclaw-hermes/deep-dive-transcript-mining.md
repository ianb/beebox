# Deep dive: background transcript mining — cb retro vs OpenClaw dreaming vs Hermes learning loop

*Follow-up to the top-level comparison's "background transcript mining is the consensus memory-write path" confirmation: one level down on HOW each implements it. Sources: implementation dives against real code in all three systems (2026-07).*

## The three pipelines at a glance

| | CBX `cb retro` | OpenClaw "dreaming" | Hermes background_review + curator |
|---|---|---|---|
| Cadence | Weekly cron procedure (Mon 07:00), shipped enabled | Light 6-hourly / deep daily 03:00 / REM weekly; **opt-in, default OFF**; self-reconciling cron | Continuous: every 10 user turns (memory) / 10 tool iterations (skills); weekly curator, inactivity-gated |
| Character | LLM at both stages (observer + integrator) | **Almost entirely deterministic** — regex extraction, arithmetic scoring; the only LLM call writes a whimsical DREAMS.md diary | LLM fork with **mechanical fences** |
| Input | Chat sessions: tagged/registry-confirmed, 30-min quiescent, unsettled per state file | Daily notes + live session transcripts, chunked under line/char caps, SQLite short-term recall store | The live conversation itself, replayed **cache-warm** in an in-process fork |
| Extraction guard | Literal-quote requirement (only hallucination guard) | N/A (deterministic) | Read-before-write code guard; anti-overfitting deny-list in prompt |
| Scoring/promotion | Integrator LLM assigns confidence (hypothesis→low→medium, medium ceiling) — **no code-computed recurrence** | Weighted arithmetic score (relevance .30, frequency .24, diversity .15, recency .15 + phase boosts) vs thresholds (minScore 0.8, ≥3 recalls, ≥3 unique queries); autonomous append to MEMORY.md | Model decides; memory overflow returns an error telling the model to consolidate itself (max 3 retries); curator cross-checks self-report vs captured tool calls |
| Dedup | SHA-256 evidence hash (exact) in append-only ledger | Exact provenance-key matching; idempotent cursors + seen-hash sets | Exact-string only |
| Cost control | $0.25/session cap on haiku observer; **no cap on integrator** | Deterministic = ~free; diary LLM call trivial | Same model but cache-warm replay (~26% measured savings); cheap-model routing switches to last-24-message digest |
| Tool restriction | **Prompt-only** ("you have no tools") under bypassPermissions | N/A | **Thread-local runtime whitelist** {skills_list, skill_view, skill_manage, memory}; auto-deny approval callback |
| Audit/undo | Git commits + per-run reports + append-only ledger (strongest audit trail of the three) | **No undo** for ordinary promotions (only the backfill lane rolls back); no human gate | Skills: tarball backups + archive-not-delete. Memory: **hard deletes**, no audit trail for background review |
| Size control | **None** on retro artifacts or guide cards | 10,000-char MEMORY.md cap dropping oldest promoted sections; 160-token snippet truncation | Hard caps: MEMORY.md 2,200 chars / USER.md 1,375 |
| Contradiction handling | None (prompt policy only) | **None** | **None** |

## Key mechanism details

**OpenClaw dreaming is not what the name implies.** Extraction, scoring, dedup, and promotion are regex + arithmetic in `dreaming-phases.ts` / `short-term-promotion.ts`. Candidates earn promotion by *measured recurrence* — recalled ≥3 times, across ≥3 unique queries, score ≥0.8 — and winners are appended to MEMORY.md under dated marker-commented sections with no human gate and no undo. The LLM's only role is writing an 80–180-word dream-diary narrative into DREAMS.md ("write like a poet who happens to be a programmer"), a write-only observability file explicitly excluded as a promotion source. Adjacent paths: agent writes daily notes with ordinary file tools; `memoryFlush` is a silent same-session pre-compaction turn appending to the daily note.

**Hermes background_review is an in-process fork of the live agent.** The turn finalizer spawns a daemon thread that replays the conversation snapshot byte-for-byte (same cached system prompt, same tools[], shared session id purely for prefix-cache parity — code comments cite ~26% cost reduction on Sonnet 4.5) with the review prompt appended only in the fork. Nothing is ever injected into the live conversation. Fences are code, not prompt: thread-local tool whitelist, a must-`skill_view`-before-patching guard, auto-deny on approval callbacks. The weekly curator cross-checks the model's YAML self-report against captured tool calls and delete-time `absorbed_into` declarations, flagging hallucinated consolidations. Surprise: memory "consolidation" has **no LLM pipeline** — writes past the char caps error out with instructions for the model to merge/remove entries itself. Every memory write is scanned against a threat-pattern library.

**CBX retro** chains `retro status --check` (skip if nothing new) → haiku observer pass per session (quote-required observations, $0.25 cap) → one integrator agent (40 turns) draining all pending reports. Observations land in an append-only ledger with SHA-256 evidence-hash dedup; the integrator assigns confidence reading the ledger.

## Honest assessment: is CBX retro "much simpler/less robust"?

Split verdict. **CBX is *more* robust than both on audit/reversibility** — git-committed outputs, per-run reports, append-only ledger, human-legible confidence/evidence provenance. OpenClaw promotes autonomously with no undo; Hermes hard-deletes memory with no background-review audit trail. Nobody handles contradictions; CBX's evidence model at least *represents* the conflict.

**CBX is *less* robust on mechanical enforcement** — the three competitor patterns it lacks:

1. **Code-computed recurrence (OpenClaw).** CBX confidence is LLM judgment over the ledger; OpenClaw requires arithmetic thresholds (≥3 recalls, ≥3 unique queries) before anything is promoted. CBX has the ledger to compute this from — it just doesn't.
2. **Mechanical tool fences (Hermes).** CBX's observer is tool-less by system-prompt request only, running bypassPermissions. The Agent SDK supports per-query `allowedTools`/`disallowedTools`.
3. **Self-report cross-checks (Hermes curator).** Verify the integrator actually made the edits it claims, from the transcript's tool calls, not its summary.

**CBX-specific defects found during the dive** (independent of the comparison):

- **Doc-code gap:** the design doc claims a validate-phase diff-grep blocks integrator edits to `user-stated` beliefs and `speaking-voice`; the shipped procedure only checks no report is left pending. The guard was documented, never implemented.
- **Re-clone wipes memory-of-mining:** ledger + settled-state live gitignored in `.callback-box/retro/`, so a box re-clone (routine in worktree tooling) silently resets recurrence history and the dedup guard.
- No transactionality across ledger-append/state-save/report-write; no size caps on retro artifacts or guide cards; observer has a cost cap but the integrator doesn't.

## Recommended fixes (in rough order)

1. Implement the documented validate-phase guard (diff-grep on protected belief classes) — closing a doc-code gap, not new design.
2. Track retro ledger/settled-state in git (or otherwise survive re-clone) — it's exactly the kind of low-churn, history-valuable state the files+git bet is *for*.
3. Mechanical `disallowedTools` on the observer pass (and any future reduced-trust pass) — one line per call site.
4. Code-computed recurrence gate for confidence promotion (≥N distinct sessions before medium), computed from the ledger.
5. Integrator cost ceiling; size caps on guide/personality cards.
6. (Optional, Hermes-inspired) a curator-style cross-check step: after integration, verify claimed edits against actual tool calls.

## What CBX should *not* copy

- OpenClaw's fully-autonomous no-gate promotion — our staged, git-audited flow is the better design for a system whose boxholder teaches it.
- Hermes's continuous every-10-turns cadence as-is — its value is immediacy for *skills that just failed* (better addressed by triage-time feedback routing, see idea 7b) rather than belief mining; weekly is fine for belief drift.
- The dream diary. Charming, though.
