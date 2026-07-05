# PAI review — comparison substrate for Callback Box planning

A review of Daniel Miessler's **Personal AI Infrastructure** (PAI), written to inform
Callback Box planning. Checkout: `~/src/Personal_AI_Infrastructure`. The runtime under
review is release v5.0.0; throughout these docs:

- `$PAI` = `~/src/Personal_AI_Infrastructure/Releases/v5.0.0/.claude` (the installable scaffold — this is what replaces a user's `~/.claude/`)
- `$PACKS` = `~/src/Personal_AI_Infrastructure/Packs` (the same ~45 skills repackaged for standalone install)
- cb paths are relative to `callback-box/` unless noted

## Documents

| Doc | Contents |
|---|---|
| [isa.md](./isa.md) | The ISA primitive — spec quotes, a real example, what it actually is, what cb should take |
| [telos.md](./telos.md) | TELOS life-context files + the identity pair — full template quotes, mapping onto cb's personality/boxholder layer |
| [prompts.md](./prompts.md) | The actual prompt text — system prompt, CLAUDE.md, Algorithm doctrine — quoted and annotated |
| [information-layout.md](./information-layout.md) | How PAI organizes information: context loading, MEMORY tiers, knowledge lifecycle, rule routing |

## What PAI is, in one paragraph

PAI is a "Life Operating System" implemented as an opinionated replacement for the
Claude Code config directory: a constitutional system prompt (loaded via
`--append-system-prompt-file`), a CLAUDE.md of format templates and path routing
tables, 44 lifecycle hooks (TypeScript run by Bun), ~48 skills, plain-markdown state
under `PAI/USER/` and `PAI/MEMORY/`, and one persistent daemon ("Pulse", port 31337)
handling voice (ElevenLabs), cron jobs, observability, and a dashboard. The user's
assistant is a single named "DA" (Digital Assistant; the reference install's is "Kai")
that knows the user's identity, goals (TELOS), and work state at every session start.

## Reliability notes on the source material

Worth keeping in mind when reading any of these docs:

- **PAI is a sanitized export of a private system.** The release builder strips
  `PAI/USER/**` and private skills. Some configured features have no implementation
  in the public release — e.g. `$PAI/PAI/PULSE/PULSE.toml` configures a DA
  "heartbeat / diary / growth" subsystem (`[da]` section) that no shipped code
  consumes. A comment in the same file says email triage, calendar reminders, and
  the morning brief run on a *second private DA* ("Devi") on another machine.
  PAI's coverage of cb's core territory (inbound email/calendar processing) is
  therefore mostly invisible.
- **Almost nothing is validated.** The "types" are prose contracts in READMEs and
  doc files; the only machine-parsed structure is ISA frontmatter (read by sync
  hooks). There is no schema engine, no migration story, no commit-time validation.
- **The doctrine layer is large and visibly fights model drift.** See
  [prompts.md](./prompts.md) — the system prompt contains a paragraph admitting the
  mandatory output format is a "recurring failure pattern."

## The comparison frame

The two projects share a worldview — plain files over databases, filesystem-as-index
over RAG, one named personal assistant, Claude Code as substrate — and diverge on one
axis: **PAI encodes its pipeline as doctrine the model is trusted to follow; cb
encodes its pipeline as TypeScript with the model invoked at typed seams.** Almost
every PAI mechanism has a cb counterpart that is smaller and enforced in code:

| Concern | PAI | Callback Box |
|---|---|---|
| Pipeline | Algorithm doctrine (`$PAI/PAI/ALGORITHM/v6.3.0.md`, 673 lines of prompt) | reactor + intake→triage→handle in code (`src/core/reactor/`, `docs/triage.md`) |
| Task spec | ISA markdown file per task, model-maintained | job cards + procedures, schema-validated |
| Output structure | visual format templates the model must self-enforce | `invokeStructured` with Zod; chat tags parsed by UI |
| Identity | static user-authored `DA_IDENTITY.md` / `PRINCIPAL_IDENTITY.md` | evolving personality card with evidence model (`config/main.personality.card`) |
| Learning | SessionEnd hooks + Learning Router (inline writes) | retro: post-hoc, audited, recurrence-gated (`src/cli/commands/retro.ts`) |
| Scheduling | Pulse daemon, `[[job]]` cron in one TOML | `cb tick` + per-box `scheduled-script.card`s (`docs/scheduler.md`) |
| Goals | TELOS files — **no cb counterpart exists** | — |
| Safety | disclosure containment (zones, release gates) | action containment (staged output, question cards) |

## Recommendation summary (detail in the individual docs)

**Adopt (high confidence):**
1. **A goals/telos layer** — cb knows the boxholder's preferences but not their
   goals. The TELOS decomposition (mission / measurable goals / personal challenges /
   beliefs / wisdom) is a usable starting taxonomy, and cb's evidence model
   (source + confidence) ports onto it directly. → [telos.md](./telos.md)
2. **Done-criteria for procedure runs** — the kernel of ISA: a procedure run opens
   by writing testable claims about the end state ("one binary tool probe each"),
   checks them with evidence, and records where the spec was wrong. → [isa.md](./isa.md)
3. **A rule-routing table for the agent** — PAI's "Self-Healing Infrastructure"
   section maps *kind of rule → which surface it lives in*. cb has the surfaces
   (guides, rules, schemas, CLAUDE.md) but no written routing. → [prompts.md](./prompts.md)
4. **Explicit autonomy boundary in the personality surface** — `Can initiate: …` /
   `Must ask: …`. cb enforces this structurally; stating it makes it legible and
   editable. → [telos.md](./telos.md)
5. **Belief/knowledge decay** — KNOWLEDGE's `seedling → budding → evergreen` status
   with 90-day expiry of unreferenced seedlings; cb retro beliefs gain confidence
   but never expire. → [information-layout.md](./information-layout.md)

**Adopt (small, cheap):**
- Sentinel outputs (`NO_ACTION` / `NO_URGENT`) from scheduled scripts to suppress
  notification dispatch (`$PAI/PAI/PULSE/PULSE.toml` header comment).
- Rules that carry their incident provenance ("billed $498 in April 2026") — the
  evidence-model `ref` idea applied to guide-card rules.
- A handful of verification-prompt phrasings (intent echo, reproduce-first,
  "should work is forbidden", re-read check). → [prompts.md](./prompts.md)

**Reject:**
- The Algorithm as universal doctrine; tier ISC count floors (E4 ≥128 criteria);
  mandatory visual output formats; closed "thinking capability" enumerations;
  pack-style distribution (cb explicitly chose knowledge-first
  composition over plugins — `callback-box/docs/design/extensibility.md`); lightweight satisfaction-signal capture (Ian prefers
  qualitative feedback; cb retro already mines transcripts qualitatively).
