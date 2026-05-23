# Box Migrations

Runbook for replaying card-format migrations against a box. Background: as schemas convert from XML to YAML frontmatter (see `docs/cards-as-markdown.md`), each box has to be brought along. This doc covers how.

## Idea: a box may not have all migrations applied

The scripts in `scripts/migrate-*.ts` are one-shot data migrations. There's no per-box manifest today recording which ones have run (a tracking system is sketched in `docs/ideas.md` § "Migration tracking per box"). The conservative default: **re-run all migrators in chronological order**. Each is idempotent (looks for the frontmatter `type:` marker and skips if present).

## The migrators

In the order they were authored — same order to run them:

| # | Script | Handles |
|---|--------|---------|
| 1 | `migrate-card-frontmatter.ts` | Phase 1 — wrap every `.card` in `---\ncontent-type: application/x-card+xml\n---` so the loader treats them uniformly |
| 2 | `migrate-email-thread.ts` | `*.email-thread.card` |
| 3 | `migrate-email-message.ts` | `*.email-message.card` |
| 4 | `migrate-briefing.ts` | `*.briefing.card` |
| 5 | `migrate-doc-sheet.ts` | `*.doc.card`, `*.sheet.card` |
| 6 | `migrate-file.ts` | `*.file.card` |
| 7 | `migrate-image.ts` | `*.image.card` |
| 8 | `migrate-audio.ts` | `*.audio.card` |
| 9 | `migrate-record-person.ts` | `*.record.card`, `*.person.card` |
| 10 | `migrate-memo.ts` | `*.memo.card` |
| 11 | `migrate-misc.ts` | `*.todo-list.card`, `*.telegram-message.card`, `*.feedback.card` |
| 12 | `migrate-jobs.ts` | the four job schemas (intake, calendar-review, chat, question-followup) |
| 13 | `migrate-personality.ts` | `*.personality.card` |
| 14 | `migrate-scheduled-script.ts` | `*.scheduled-script.card` |
| 15 | `migrate-question.ts` | `*.question.card` |
| 16 | `migrate-chat-thread.ts` | `*.chat-thread.card` |

Phase 1 (#1) must run first; the per-schema migrators (#2–16) are mostly order-independent of each other but `#1` is a hard prerequisite. Also: `migrate-attachments.ts` is a separate, earlier structural migration (move flat attachments into `.attach/` directories) — not in this list because by the time the Phase-2 migrators run, every modern box should already be on the `.attach/` layout.

Each script takes a box root and runs in dry-run mode by default; pass `--apply` to commit changes to disk:

```bash
npx tsx scripts/migrate-image.ts /path/to/box           # dry-run
npx tsx scripts/migrate-image.ts /path/to/box --apply   # write
```

## Noisy mode (field-loss detection)

Every Phase-2 migrator declares an `ElementSpec` of known attrs/children per element type. Anything outside that allow-list accumulates in a warning list printed at the end of the run:

```
3 warning(s) about unrecognized fields:
  ledger.briefing.card: unknown child at <briefing>: <legal>
  store/.../Amherdt_Handwritten_Letter.record.card: unknown attr at <record> > <person>: role="Amherdt Group"
  config/main.personality.card: unknown attr at <personality> > <boxholder>: ref="store/people/Ian_Bicking.person.card"
```

The shared helper is `scripts/_migrate-warnings.ts`. A warning means the original XML had a field the migrator doesn't know how to map — silent data loss if the warning is ignored. Two responses:

1. **Extend the migrator** (preferred for fields that look generic): add to the spec, map in the converter, extend the corresponding schema in `src/schemas/`. Re-run from a clean baseline.
2. **Accept the loss** (only for one-off junk): commit anyway; the warning is your audit trail in scrollback. Beware: subsequent runs against new boxes will report the same warnings if the fields legitimately exist there too.

## Per-box workflow

For a fresh box (live data, not a test):

```bash
# 1. Confirm the working tree is clean (commit anything pending as a baseline).
git -C $BOX status --short

# 2. Save the pre-migration commit SHA — your rollback anchor.
git -C $BOX rev-parse HEAD > /tmp/$BOX-pre-migration.sha

# 3. Run the migrators in order (dry-run first if you want to preview).
ORDER="card-frontmatter email-thread email-message briefing doc-sheet file image audio record-person memo misc jobs personality scheduled-script question chat-thread"
for m in $ORDER; do
  echo "=== $m ==="
  npx tsx scripts/migrate-$m.ts $BOX --apply
done

# 4. Validate.
cd $BOX && cb validate

# 5. Commit.
git -C $BOX add -A && git -C $BOX commit -m "Phase 2 migration: schemas to YAML frontmatter"
```

Rollback if anything goes wrong:

```bash
git -C $BOX reset --hard $(cat /tmp/$BOX-pre-migration.sha)
```

## Production rollout (box.example.com)

What was actually done on May 23, 2026 against the live server boxes (`hearth`, `ledger`, `hearth`, `seminar`, `test1`):

1. Pushed callback-box to GitHub; post-commit hook auto-deploys to `/opt/callback/callback-box/`, which puts the latest migrators on the server.
2. `systemctl stop callback-serve callback-scheduler` to avoid races during box rewrites.
3. Backup: per-box pre-migration SHAs and a compact tar (`*.card` text + `.callback-box/` runtime state + `.git`, binary attachments excluded) into `/home/callback/backups/pre-migration-<timestamp>/`. Ledger's `.git` history is the bulk of the backup size (~10G).
4. Looped over `/home/callback/boxes/*/`, ran the 16 migrators in order as the `callback` user. Three boxes finished clean; two surfaced warnings/failures.
5. Committed per box (one "Phase 2 migration" commit each).
6. Repaired the surfaced issues — see "Residual issues handled" below.
7. `systemctl start callback-serve callback-scheduler`.

### Residual issues handled

Three concrete data-loss surfaces came up. All resolved.

- **`personal/config/main.personality.card`** — `<boxholder ref="...">` attr was dropped. Patched the live YAML in place, restored the ref, committed. Fixed the migrator (`scripts/migrate-personality.ts` spec + converter) and the `BoxholderEntry` schema in `src/schemas/personality.tsx` so future runs preserve it.
- **`hearth/.../Test_Timer_2026-03-08T12-24.memo.card`** — used `<memo created="...">` attr instead of a `<created>` child. The strict migrator failed; the card was hand-converted to YAML preserving the timestamp. The migrator was *not* extended to accept this shape because no other card uses it.
- **`personal/store/callback-box/callback-box-interaction-primitives.memo.card`** — legacy `<card type="memo"><content>...</content></card>` shape from an old export. Hand-converted to YAML with `created` set to the git-add timestamp. Not worth a general migrator path.

## When you write a new migrator

- Use the `_migrate-warnings.ts` helper. Declare a tight `ElementSpec` — being too permissive defeats the noisy-mode purpose.
- Idempotency check: look for the frontmatter `type:` marker for your schema near the top and skip if present.
- Dry-run default: only mutate on `--apply`.
- Mention it in the table above and commit both the migrator and the table update together.
