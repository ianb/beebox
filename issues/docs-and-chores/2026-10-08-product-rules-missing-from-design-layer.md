---
title: "Shipped product rules that docs/design never mentions"
workstream: skills-review
area: beebox
labels: [docs, design]
filed-by: agent
discovered-by: agent
discovered-in: skills-review — review of docs/architecture and docs/design (2026-10-08)
---

The design layer (`docs/design/`) explains the why behind representation,
identity, interaction, trust, teaching, and extensibility. These rules are
in code or shipped docs and have no design-level statement. Each is a
candidate for a sentence in the right design file, or a new file (privacy
and egress has none).

- **Questions**: never auto-answered; one nudge at 7 days, expiry at 30;
  dismissed or expired questions stay answerable; age from `asked-at`;
  dismissed questions are not re-asked (`docs/questions.md`).
- **Notification restraint**: questions only badge unless
  `urgency: time-bound`; routine success never notifies; health never
  notifies on its own; quiet and loud pushes are suppressed while a person
  is present (`docs/notifications.md`, the root briefing's "Reaching me").
- **Triage consequences**: `guess` leaves the item in `_unsure/` with a
  question; `probable` files it with a `.probable.txt` marker
  (`docs/triage.md`).
- **Quick chat**: auto-posts without confirmation above a 0.9 probability
  sum and is irreversible; a thought is never dropped on failure
  (`docs/chat/quick-chat.md`).
- **Chat review**: a hand-set title permanently beats the machine title;
  titles are held back by "would the boxholder wince" (`docs/chat/review.md`).
- **Model policy**: a chat's engine is fixed at birth, its model can change;
  an unpinned box uses the strong tier (`docs/model-policy.md`).
- **Retries and verdicts**: nothing retries forever; quota failures are
  `deferred`; a check with no verdict is `inconclusive`, not failed.
- **Egress and privacy**: Gmail is read plus drafts only; a secret grant is
  per-box consent for one purpose; box content reaches an outside model
  only with a granted key. No design file covers privacy or egress.
- **The Laws**: Saving, Cards, Checking, and the quoting tiebreak ("if
  unsure whether a change is a fix or a reword, it is a reword"); only the
  Law of Quoting is referenced from the design docs.
- **User register**: the assistant says "I"; a card is "your recipe"; a UI
  shows actual state with pending shown explicitly (`docs/glossary.md`,
  `docs/engineering-principles.md`).
- **Records**: `reviewed` and `archived` are set only on the boxholder's
  say-so (`src/schemas/record.tsx`).
- **Publishing**: never silently moves or deletes published resources; one
  hostname per box.
- **Promises**: agents check `bbx notify --check` before promising a
  reminder.
- **Vocabularies `trust.md` omits**: belief basis
  `user-stated > feedback > inferred > default`; guide confidence
  `confirmed|high|medium|low|hypothesis` (hypothesis excluded from compiled
  guidance); progress evidence `observed|inferred|self-report` with "no
  level without evidence"; procedure-run outcome
  `completed|failed|inconclusive`; question states; notification loudness.
- **Right place, right time**: the question a proactive behavior must answer
  before acting or showing (act, show, or stay quiet; which surface; which
  attention tier) is stated only in the bbx-design skill. `interaction-model.md`
  covers proactivity as ambition but never states the question; spirit.md
  gives examples only. Found by the dev-guidance knowledge audits, 2026-10-08.
