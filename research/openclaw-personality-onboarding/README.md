# OpenClaw personality/identity onboarding — research corpus

*Researched 2026-08-02; OpenClaw at commit `1ffc31983`.*

Deep-dive on how OpenClaw brings a new agent's personality into being on first
run — the bootstrap ritual, the identity files it produces, how that identity
reaches the model and the channels, whether it evolves, how the community
received it, and what callback-box should take from it. This is the deep
version of **triage row 24** in
[../openclaw-hermes/README.md](../openclaw-hermes/README.md); the wider
OpenClaw architecture is covered by that corpus (esp.
[compare-ux-prompt.md](../openclaw-hermes/compare-ux-prompt.md) and
[deep-installation.md](../openclaw-hermes/deep-installation.md)) and is not
repeated here.

## Documents

| Doc | Covers | Headline finding |
|-----|--------|------------------|
| [deep-bootstrap-ritual.md](deep-bootstrap-ritual.md) | The first-run "you just woke up" flow: steps, framing, trigger, lifecycle | Nothing is enforced — identity is valid with any one field or none; all pressure is copy. The agent itself deletes `BOOTSTRAP.md`, and completion is inferred from the file's absence |
| [deep-identity-files-and-prompt.md](deep-identity-files-and-prompt.md) | IDENTITY/SOUL/USER/AGENTS schemas, parse rules, budgets, prompt assembly | `IDENTITY.md` is the only machine-parsed file (six optional `Label: value` lines, last occurrence wins); workspace files get no injection scanning; one hardcoded sentence activates the persona |
| [deep-identity-evolution-and-function.md](deep-identity-evolution-and-function.md) | Post-t0 evolution pathways; functional roles of name/emoji/avatar | No evolution mechanism exists (memory has the loop identity lacks) — and the ritual writes a store the functional consumers never read (the two-store split) |
| [reception.md](reception.md) | Community reception, ecosystem, critiques, security angle (web research) | Praise attaches to the legible files; no first-hand account praises the ceremony as an experience; both substantive critiques target one-shot freezing and agent-solo authorship; the famous praise quote is the opening clause of a critique |
| [compare-cbx-recommendations.md](compare-cbx-recommendations.md) | CBX comparison + explicit dispositions (Codex cross-reviewed) | CBX's evolving, source-tracked personality model is validated by OpenClaw's failure modes; the missing piece is a visual signature element — adapted as a UX hypothesis, with signature fields kept stable/user-approved rather than retro-churnable |

## Dispositions (summary — full reasoning in [compare-cbx-recommendations.md](compare-cbx-recommendations.md))

| Idea | Disposition |
|------|-------------|
| Agent-solo, one-shot t0 identity ritual | **reject** |
| Signature emoji (image avatar separately) on the personality card, rendered in the CBX UI | **adapt, as a UX hypothesis** → [agent-signature-identity](../../issues/features/2026-08-02-agent-signature-identity.md) |
| "Meet your assistant" woven into first-run (chat zero-state / flow opening — not a menu slot) | **adapt** → same issue; feeds [first-run-experience](../../issues/features/2026-07-20-first-run-experience.md) |
| One identity source of truth, explicit typed projections | **keep** (validated by OpenClaw's two-store split) |
| Identity evolution over t0 commitment | **keep** (validated by the bootstrap-paradox critique) — signature fields stay user-approved continuity identifiers; retro proposes via the question sink |
| Mention/ack-reaction machinery | **later** (only if CBX gains group-chat channels; keep signature ≠ ack emoji) |
| Persona-write audit posture | **keep, no action** — with the stated boundary that provenance covers entry fields only |
