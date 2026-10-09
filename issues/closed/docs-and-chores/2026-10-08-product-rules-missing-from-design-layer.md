---
title: "Shipped product rules that docs/design never mentions"
workstream: skills-review
area: beebox
labels: [docs, design]
filed-by: agent
discovered-by: agent
discovered-in: skills-review — review of docs/architecture and docs/design (2026-10-08)
resolution: implemented
---

The design layer (`docs/design/`) explains the why behind representation,
identity, interaction, trust, teaching, and extensibility. These rules are
in code or shipped docs and have no design-level statement. Each is a
candidate for a sentence in the right design file, or a new file (privacy
and egress has none).

- **Questions**: never auto-answered; by default one nudge at 7 days and
  expiry at 30 (`expires-after` overrides both);
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
  Update 2026-10-08: listed in `trust.md` as a dated note under "Three
  confidence vocabularies".
- **Right place, right time**: the question a proactive behavior must answer
  before acting or showing (act, show, or stay quiet; which surface; which
  attention tier) is stated only in the bbx-design skill. `interaction-model.md`
  covers proactivity as ambition but never states the question; spirit.md
  gives examples only. Found by the dev-guidance knowledge audits, 2026-10-08.
  Update 2026-10-08: stated in `interaction-model.md` ("Right place, right
  time"), with the boxholder's reason for the situation form.

Done 2026-10-08, to the boxholder's rulings of that day (which override the
list above where they differ). `trust.md` now splits trust to act (the
ladder, plus the question rules: never auto-answered, nudged once, expire,
dismissed or expired stays answerable) from trust to keep (a thought is never
dropped; the record is kept for undo; `reviewed`/`archived` only on the
boxholder's say-so), and writes quick chat's auto-post as a documented
compromise that rests on trust to keep. `representation.md` gains "Acting
forward on a kept record" (the undo principle; hand-set title beats machine
title and the wince test; triage `guess`/`probable` represent uncertainty;
publishing never silently moves or deletes) and a pointer to the glossary's
user-facing register. `identity.md` gains one sentence on model policy
(engine fixed at birth, model changeable). `interaction-model.md` states that
notifications are undesigned and `docs/notifications.md` is implementation,
not settled design. The design README points to the agent guide's THE_LAWS
with the quoting tiebreak. New `privacy-and-egress.md` holds the sharing,
grant (Gmail read plus drafts, per-box per-purpose secret grants, outside
models only with a granted key), and public-repo stances. Deliberately left
out: notification restraint rules and the promises rule (notifications are
not designed yet); retries, deferred/inconclusive verdicts, the cursor rule,
and the run-dir cache (engineering principles, already in
`docs/engineering-principles.md` and the scheduler doc).
