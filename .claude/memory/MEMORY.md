# Callback Project Memory

## Memory System Concerns
Auto-memory (`~/.claude/projects/` path) is problematic: path-hash-based, machine-specific, not version-controlled, easily lost. Prefer storing durable knowledge in repo files (CLAUDE.md, docs/) rather than here. This file is best for ephemeral/session-adjacent notes, feedback, and preferences. Planned features + ideas live in `docs/ideas.md`. Server operations live in `docs/server-operations.md`. See [issue #25739](https://github.com/anthropics/claude-code/issues/25739) for the open feature request for portable memory.

## Key Locations
- Monorepo: `~/src/callback-mono/` (callback-box, callback-clerk, agent-doctest, personal-vibe-check)
- Boxes: `~/src/boxes/` (outside the monorepo so agents don't inherit parent CLAUDE.md)
- Test box: `~/src/boxes/test1/`

## Session-Adjacent Notes

### Claude Code rules: use `paths:` not `globs:`
The frontmatter field for conditional `.claude/rules/` files is `paths:`, not `globs:`. Using `globs:` causes all rules to load unconditionally (Claude Code doesn't recognize the field). Fixed in `init-rules.ts`.

### DOCID debug markers
`cb init . --docid-debug` persists a `.callback-box/docid-debug` marker file. All subsequent `generateDocs()` calls (including from wakeup) detect the marker and embed `<!-- DOCID:<path> -->` in generated files. Useful for tracing which doc files are actually loaded into agent context.

## Feedback
- [Scan whole function when fixing a bug](feedback_compound_bugs.md) — compound bugs cluster; re-read the full function and eyeball sample output before declaring done
- [Don't hardcode box-specific names in shared prompts/docs](feedback_user_name.md) — shared text uses generic roles ("the user", "the boxholder", "a character"); specific names (the user's, family members', characters' like ones from test1) only in personal memory and one-off replies
- [Use ref="" for links in card schemas](feedback_link_ref_convention.md) — link elements always use `ref` for the target, never href/path/url
- [Don't use "load bearing"](feedback_no_load_bearing.md) — AI-ism the user finds annoying; substitute "primary," "foundational," "critical," or "central"
- [Brace placeholders, not angle brackets](feedback_placeholder_syntax.md) — in prose/instructions near XML, write `{modelId}` not `<model-id>` — angle brackets read as tags
- [Form-as-prompt for evaluation tasks](feedback_form_as_prompt.md) — for review/audit/critique work, prefer structured forms with explained criteria over numeric confidence scores or free prose
- [No premature behavior tuning](feedback_no_premature_tuning.md) — soft default (derived from one observation, not strongly endorsed): wait for real friction before adding behavioral rules
- [Resilience before bug fix](feedback_resilience_before_bug_fix.md) — when a bug causes downstream damage (UI freeze, data loss, lost in-progress message), fix the resilience gap first; the bug exposed a fragility that's its own problem
- [Large scope is fine — flag mismatches](feedback_large_scope_is_fine.md) — large AI changes are usually fine; flag scope when reality diverges from the user's expectation (e.g. a "small bug fix" growing into many files)
- [Transparency](feedback_transparency.md) — no silent error capture; UI surfaces unexpected states visibly marked as unintentional; user is often a developer who needs actionable error surfaces; open-source contract
- [Files over external trackers](feedback_files_over_external_trackers.md) — for project state/notes/work-queues/knowledge, prefer repo files over Linear/Notion/Jira/etc.
- [Knowledge audits ARE runnable — stop hedging](feedback_run_audits.md) — when adding/modifying entries in `src/dev/knowledge-audits.yaml`, just run the affected subset (`npx tsx src/dev/knowledge-audit.ts run --box ~/src/boxes/test1 --filter <tag>`) rather than declining on LLM-cost grounds

## Design Notes
- **AIism problem** — stock LLM phrases ("That's a real tension", "Great question!", "Let me unpack that") are noticeable and annoying. No known fix for real-time conversation. See [tone-design.md](tone-design.md).
