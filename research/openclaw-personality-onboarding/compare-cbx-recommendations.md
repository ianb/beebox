# OpenClaw identity onboarding vs callback-box: comparison and dispositions

*Written 2026-08-02; OpenClaw at commit `1ffc31983`. Synthesis of
[deep-bootstrap-ritual.md](deep-bootstrap-ritual.md),
[deep-identity-files-and-prompt.md](deep-identity-files-and-prompt.md),
[deep-identity-evolution-and-function.md](deep-identity-evolution-and-function.md), and
[reception.md](reception.md). This corpus is the deep version of triage row 24 in
[../openclaw-hermes/README.md](../openclaw-hermes/README.md).*

## The two models in one paragraph each

**OpenClaw** commits identity at t0 through a ritual. A new agent workspace is
seeded with `BOOTSTRAP.md` ("You just woke up… pick a name, a nature, a vibe, an
emoji"), the agent performs the ritual in its first human conversation, writes
`IDENTITY.md` + `SOUL.md`, and deletes the bootstrap file. Nothing is enforced —
every field is optional, defaults exist for all consumers — but the copy is
insistent and the moment is singular: no mechanism anywhere revisits identity
afterwards. The identity elements are functionally load-bearing (avatar,
ack-reaction, group-chat mention trigger, message prefix), yet the ritual writes
them to a file the functional layer does not read; syncing file → config is one
manual CLI call the ritual never mentions.

**Callback-box** ships identity as a default and evolves it. `cb init` seeds
`config/main.personality.card` with a named starter identity ("Egg",
`src/schemas/personality-template.ts`, installed via
`src/core/box/defaults.ts:121`) whose every tone/trait entry carries
`confidence: low, source: default` plus explicit `unresolved` questions. The
retro observer sinks observations back into the card (`personality` is a
first-class sink — `callback-box/src/core/retro/observations.ts:19`), and
`compilePersonality` (`callback-box/src/schemas/personality.tsx`, invoked from
`src/core/docs-gen/compile.ts:371`) compiles the card into the agent guide
every agent receives. There is no identity moment, no agent-chosen element, and
no visual/signature identity at all: `goes-by` reaches only prompt text ("You
are **Egg**"), the UI `Avatar` component is for human users, and the card's one
non-prompt projection is `compileSpeakingVoice` (Electron voice config) —
nothing visual, nothing attributive.

So the comparison is between a **ritual with no evolution** and an **evolution
with no ritual**. The research question (triage row 24): does CBX want the
ritual's outputs — an early concrete identity anchor and a reusable signature
element — and if so, where do they live?

## What the research established

1. **Praise attaches to the files; the ceremony has no first-hand fans on
   record.** Reception ([reception.md](reception.md)): the celebrated quote
   ("genuinely the best idea in personal agent design right now") is the
   opening clause of a critique ("…and for almost everyone, it's empty");
   first-hand praise attaches to living with the legible files afterwards, and
   no first-hand account was found of anyone enjoying the birth ceremony as an
   experience. Derivative projects patch onboarding and evolution; none patches
   the file format. Precision matters here (the reception sample is partial,
   and absence of praise is not rejection): the two substantive critiques
   target *one-shot freezing* and *agent-solo authorship* specifically — 
   neither rules out an early identity moment that is co-authored and
   revisable.
2. **Nothing is enforced, and the system is honest about defaults.** Identity
   parses with any one field or none; a config-empty agent is "Assistant" with a
   👀 ack and an `[openclaw]` prefix
   ([deep-bootstrap-ritual.md](deep-bootstrap-ritual.md)).
3. **The bootstrap paradox is real and architecturally confirmed.** The critique
   (identity fixed in one ephemeral early session yields flat files) is
   corroborated by the code: OpenClaw's memory subsystem has a prescribed
   consolidation loop (daily notes → curated `MEMORY.md`, heartbeat +
   pre-compaction prompts, dreaming), while identity's version of that loop is
   one sentence of template prose. The prompt says "embody its persona," never
   "update" ([deep-identity-evolution-and-function.md](deep-identity-evolution-and-function.md)).
4. **Worse than the paradox: the two-store split.** The ritual's output lands in
   `IDENTITY.md`; every functional consumer reads config-only
   `agents.list[].identity` with no fallback and no sync. A freshly-onboarded
   agent has named itself in a file the mention matcher cannot see; on
   iMessage/Signal identity is the sole addressing mechanism, so the agent is
   unaddressable until a manual CLI sync nothing mentions. Three code paths
   order the two stores three different ways.
5. **The signature emoji does double duty, and only one duty draws complaints.**
   Expression (sign-offs, persona packs, avatar fallback) is liked; protocol
   (the same emoji fired as ack-reaction at every inbound message) reads
   "repetitive/robotic" (openclaw issue #8508, still open). The design never
   separated the two uses.
6. **Agent-writable persona files are a persistence surface.** Workspace files
   get no injection scanning (deliberate trust boundary), and real incidents
   (ClawHavoc; the self-edited "programming God" soul) used soul/memory writes
   for persistence. Nothing audits what changed or why.

## Dispositions

| # | Idea | Disposition | Trace |
|---|------|-------------|-------|
| 1 | Agent-solo, one-shot t0 identity ritual ("you just woke up") | **reject** | reception + bootstrap paradox; CBX retro loop is the direct counter-design |
| 2 | Signature emoji (and, separately, image avatar) as personality-card fields rendered in the CBX UI | **adapt, as a UX hypothesis to prototype** | issue filed: `issues/features/2026-08-02-agent-signature-identity.md` |
| 3 | An identity introduction early in first-run (co-authored, revisable — wrapped into an existing surface, not a menu flow) | **adapt** | folded into the same issue; feeds `issues/features/2026-07-20-first-run-experience.md` |
| 4 | One identity source of truth with explicit typed projections | **keep (validated)** | OpenClaw's two-store split is the cautionary tale; CBX pattern is `compilePersonality` + `compileSpeakingVoice` projections |
| 5 | Evolution of identity over t0 commitment | **keep (validated)** — but signature fields are continuity identifiers, not retro-churnable beliefs | `retro/observations.ts` `personality` sink; see §4–5 |
| 6 | Ack-reaction / mention-trigger machinery | **later** | revisit only if CBX gains group-chat channel presence; separate expression from protocol |
| 7 | Persona-write auditing as a security posture | **keep (no action)** | CBX source-tracking + git history already provide what OpenClaw lacks |

### 1. The agent-solo, one-shot t0 ritual — reject

What is rejected, precisely: a *mandatory-feeling, agent-solo, one-shot*
naming ceremony whose output is treated as settled. Both critique camps
([reception.md](reception.md) §4) want that changed — one toward continuous
evolution (which CBX already has), one toward human authorship (which CBX's
seeded template + user-editable card already is). CBX adopting OpenClaw's
ceremony would trade its best structural property (identity as an evolving,
evidence-tracked belief) for OpenClaw's weakest one (identity as a one-shot
artifact of an ephemeral session). The "Egg starts at low confidence and earns
its personality" model is the answer to the bootstrap paradox, and this
research strengthens the case for it rather than against it.

What is *not* rejected: an early identity moment as such. Neither critique
rules out a co-authored, revisable introduction — that survives as
recommendation 3.

### 2. Signature element (emoji; image avatar separately) — adapt, as a hypothesis

The functional lesson survives the ritual's rejection: in OpenClaw the
signature elements are the agent's handles across every surface, and CBX today
has literally none — the assistant renders with no avatar, no emoji, no visual
presence; `goes-by` never leaves the prompt. That gap is real independent of
any onboarding philosophy.

Honest evidence framing (this was sharpened by the cross-model review): the
reception research does *not* prove that a per-agent signature improves
attachment — praise attaches to the file bundle, and the strongest
emoji-specific data point is a complaint about the ack-reaction protocol use.
"An agent with a visual identity is easier to attach to" is a **CBX UX
hypothesis to prototype**, informed by OpenClaw's design, not validated by it.
Emoji and image avatar should be evaluated separately — the OpenClaw ritual
does not even ask for an avatar
([deep-bootstrap-ritual.md](deep-bootstrap-ritual.md)), and an attach-ref
avatar carries schema/validation/transport questions an emoji doesn't.

The CBX placement differs from OpenClaw's on the axes that caused trouble
there:

- **Where it lives:** new optional fields on the personality card next to
  `goes-by` (e.g. `emoji`; `avatar` as a later, separate call) — one source of
  truth, no second store, no sync step (finding 4).
- **What it is:** a *continuity identifier*, not a belief. Name and signature
  are what the user recognizes the agent by; letting retro churn them would
  undermine the anchor they exist to provide. They are user-approved fields —
  the agent (retro included) may *propose* a change, with the user confirming
  (see §4–5). This distinction — stable presentation profile vs evolving
  behavioral personality — is the design spine the issue must keep.
- **What consumes it:** an explicit typed projection for the UI (chat avatar
  beside replies, attribution surfaces), alongside the existing prompt and
  speaking-voice projections. Expression uses only — per finding 5, the
  ack-reaction protocol use is what reads robotic, and CBX has no group-chat
  ack anyway.

Filed as `issues/features/2026-08-02-agent-signature-identity.md`.

### 3. The identity moment inside first-run — adapt

The first-run-experience design
(`issues/features/2026-07-20-first-run-experience.md`) settled a hard
criterion for its menu: a few *complete flows with a real payoff* — and it
demoted "box talks first" as incidental plumbing. Choosing a name is
configuration, not a payoff flow, so "meet your assistant" does **not** get a
menu slot (the corpus initially proposed one; the cross-model review correctly
called the conflict). The adapted shape: weave the introduction into a surface
that already exists in that design — the chat zero-state, or the opening of
whichever menu flow the user picks — where the agent introduces itself *as
Egg*, says it will grow into its personality, and offers to take a different
name/signature if the user wants. Co-authored (the human is in the loop —
brianthinks' objection) and revisable (nothing fixes at t0 — the paradox).
It also gives the signature fields from recommendation 2 their natural first
write.

This is a note into the first-run issue's design, not a separate work item;
recorded in the filed issue.

### 4–5. CBX's compiled, evolving model — keep, validated

Two findings function as direct validation of existing CBX architecture, worth
recording because they convert design intuitions into evidenced positions:

- **One source of truth, explicit typed projections** (finding 4). OpenClaw's
  deepest identity bug is that its ritual and its consumers disagree about
  where identity lives. The precise CBX invariant to protect is not "all
  consumers read the compilation" — `compilePersonality` emits prompt
  markdown, and `compileSpeakingVoice` already exists as a *separate typed
  projection* for Electron. It is: **the card is the only source of truth, and
  every consumer reads it through an explicit, named projection.** When
  recommendation 2 is implemented, the UI gets its own typed identity
  projection from the card — never a parallel config store (the OpenClaw
  trap), and never an ad-hoc re-parse.
- **Evolution loop over t0 ritual — for beliefs, not identifiers** (finding
  3). OpenClaw gives memory the loop and denies it to identity; the
  community's most substantive critique asks for what CBX's
  retro→personality sink already does for tone/traits/relationship
  (`callback-box/src/core/retro/observer.ts:46`). But the cross-model review
  drew the right boundary: signature fields are continuity identifiers, and
  retro directly rewriting them would produce name/avatar churn that defeats
  recognition. If recommendation 2 lands, retro's route to a signature change
  is the *question* sink (propose, with evidence; the boxholder confirms) —
  not a direct personality-sink write. That needs its own small design
  (observation kind, churn guard), recorded in the filed issue.

### 6. Mention/ack machinery — later

OpenClaw's emoji-as-mention-trigger and ack-reaction designs solve problems CBX
does not have: multi-agent group chats on third-party channels. The trigger for
revisiting is CBX gaining a group-chat channel presence (e.g. a richer Telegram
posture). If that happens, the lessons are already written down: identity-based
addressing is fragile as the *sole* mechanism (iMessage/Signal), silent
degradation everywhere is the failure pattern, and the signature emoji must not
be the ack emoji (finding 5).

### 7. Persona writes as a security surface — keep, no action (with a stated boundary)

OpenClaw's incidents came from unaudited agent writes to persona files that are
then injected into every prompt unscanned. CBX's equivalents carry mitigations
OpenClaw lacks: retro-proposed personality changes are typed observations with
`source`/`confidence`/`ref`, card edits are validated and git-committed, and
the compile step means a hostile edit is at least visible in one reviewable
file. The boundary to state honestly (cross-model review): provenance tracking
attaches only to the *entry* fields (tone/traits/relationships) — `goes-by`,
`role`, `body`, and any future signature fields are ordinary authored values
with no source attribution, and nothing today requires review of a card edit.
That is acceptable for the current single-assistant, boxholder-edited card;
it's why recommendation 2 makes signature changes user-confirmed rather than
agent-writable. No new work now; a future "let agents edit personality
directly" proposal must revisit this section first.

## Cross-model review (Codex, 2026-08-02)

The dispositions were adversarially reviewed by OpenAI Codex (gpt-5.6-sol,
read-only over this repo) before being finalized; this document incorporates
its accepted findings. The material changes it forced: (1) the
stable-identifier vs evolving-belief split in §2 and §4–5 — its single most
important finding; (2) §3 no longer claims a first-run *menu slot* (conflicts
with that issue's settled complete-flows criterion); (3) §2 is framed as a UX
hypothesis rather than reception-validated, with emoji and avatar separated;
(4) §4–5 restated as "one source of truth, explicit typed projections"
(`compileSpeakingVoice` already breaks the "everyone reads the compilation"
claim); (5) §7 states the provenance boundary (entries only) instead of
implying full audit coverage; (6) CBX-side citations completed (`cb init` →
`box/defaults.ts:121`; guide compile → `docs-gen/compile.ts:371`). Findings
not adopted: treating the per-box card as a blocker (CBX is
one-assistant-per-box by design; multi-agent attribution is not a current
surface).

## Issues filed

- `issues/features/2026-08-02-agent-signature-identity.md` — recommendations 2
  and 3 (signature emoji/avatar fields + the first-run "meet your assistant"
  moment), cross-linked to the first-run-experience issue and this corpus.
