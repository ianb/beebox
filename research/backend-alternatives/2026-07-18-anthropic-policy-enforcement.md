# Anthropic subscription policy: announced vs enforced (July 2026)

*2026-07-18. Deep-pass per-topic note (subagent web research, Sonnet; lightly edited).
Question: for a product whose users run the Agent SDK on their own Claude subscription,
what is the announced policy, what is actually enforced, and what do users report?
Synthesis: [2026-07-18-synthesis.md](2026-07-18-synthesis.md).*

Several claims rest on secondary aggregators the researcher could not cross-verify;
flagged where so.

---

## 1. Subscription OAuth outside official clients

- **Timeline.** Consumer ToS barred non-Claude-Code OAuth use in principle since ~2024.
  Server-side enforcement flipped on **Jan 9, 2026** ("This credential is only
  authorized for use with Claude Code"), was briefly reversed, then formalized in legal
  docs **Feb 19–20, 2026** (The Register). A harder wave hit **Apr 4, 2026**, cutting
  third-party frameworks (OpenClaw, OpenCode, Cline, Roo) off subscription quotas,
  justified on infrastructure-cost grounds (anthropic.com usage-policy update;
  TechCrunch Apr 10).
- **Current live policy** (code.claude.com legal-and-compliance, fetched directly):
  OAuth is for the subscriber's own "ordinary use"; third-party products including
  Agent-SDK-built ones "should use API key authentication"; routing *other users'*
  requests through subscription credentials is disallowed. Unchanged as of July 2026.
- **What users hit:** hard token rejection, not silent throttling
  (anthropics/claude-code#28091). OpenClaw's creator was suspended Apr 10 and
  reinstated within hours after backlash.

## 2. Agent SDK headless under subscription auth

- **Announced:** sanctioned for the subscriber's own ordinary use (Help Center + legal
  page); no task-type restriction; "developers building products/services" are pointed
  at API keys — personal single-tenant automation sits in a tolerated gray zone.
- **Enforced:** no reports found of bans/throttling of personal single-user headless or
  cron agents — explicitly a negative result across HN/Reddit/GitHub searches. One
  low-confidence report (nimbalyst#174, uncorroborated) claims OAuth traffic tagged
  `CLAUDE_CODE_ENTRYPOINT=sdk-ts` gets 429'd faster than `cli`-tagged traffic under the
  same token — i.e. possible SDK-traffic fingerprinting. Worth instrumenting for; not
  confirmed policy.

## 3. Quota changes: standing, and the one that was pulled

- **Standing (since Aug 28, 2025):** weekly caps atop the 5-hour windows, aimed at the
  top ~5% heaviest users. Max 5x ≈ 140–280 Sonnet-hrs/wk + 15–35 Opus-hrs; Max 20x ≈
  240–480 + 24–40.
- **Announced-then-cancelled (the one that matters to us):** May 13–14, 2026 —
  Agent SDK / `claude -p` / third-party usage to be split into a separate metered
  credit pool ($20 Pro / $100 Max5x / $200 Max20x, no rollover, API list pricing),
  effective June 15. **Cancelled on its own effective date** — Help Center: "nothing has
  changed"; Anthropic says it is reworking the plan and will give advance notice before
  any retry (The New Stack). As of Jul 18, 2026: not re-announced. Reads as
  when-not-if.
- A +50% weekly-limit promo ran May–mid-July 2026 (extended to ~Jul 19); its lapse is a
  reversion to baseline, not a cut.

## 4. General-use scope / Cowork

- Claude Cowork (Jan 2026; web/mobile beta Jul 7, 2026) is explicitly general-purpose
  knowledge work, bundled into Pro/Max at no extra charge, drawing the same
  subscription usage pool (support.claude.com).
- **No coding-only restriction exists anywhere** in ToS/docs for Claude Code or the
  Agent SDK. The dividing line Anthropic draws and enforces is
  individual-vs-multi-tenant, never task domain.

## 5. Rate-limit reality by plan

Weekly caps above, plus low-confidence secondary numbers (morphllm.com): Max 20x ≈ 900
messages/5-hr window; Pro ≈ 40–45. Direct current user quotes could not be pulled
(search 429s) — an evidence gap, noted rather than filled.

## 6. Bans and enforcement waves

- The real wave (Apr 4, 2026) targeted multi-tenant harness tools. Individual
  unexplained bans exist (Forbes Apr 11; a legal-blog account of a firm banned for
  OpenClaw-with-Max) plus fraud-heuristic false positives.
- **No evidence found** of any ban of native Agent SDK / `claude -p` headless use by a
  single subscriber for personal automation.

---

## Risk assessment for callback-box

Low-to-moderate, and it is a **billing/ambiguity risk, not a ban risk**:

- Our exact pattern — user's own SDK, own OAuth, single-tenant — is the pattern
  Anthropic's docs call ordinary use and the one that survived every enforcement wave.
- The credit-pool split is the concrete threat to track: if it returns, users face a
  new metered pool or cap for programmatic usage — a pricing change, with promised
  advance notice. This is precisely the scenario that motivates provider pluggability.
- Self-audit line: if callback-box ever centralizes multiple users' subscriptions
  through shared infrastructure, that crosses into the enforced-against behavior.
  Per-user, own-login architecture stays on the safe side.
- Monitoring points: support.claude.com's Agent SDK article and
  code.claude.com/docs/en/legal-and-compliance — where the next change lands first.
