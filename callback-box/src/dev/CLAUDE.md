# Dev Tools

Knowledge audits and other development/testing tools.

## Knowledge Audits

`knowledge-audits.yaml` defines tests that verify agent knowledge by prompting a box agent and checking its response and behavior.

### Running

```bash
npx tsx src/dev/knowledge-audit.ts run --box ~/src/boxes/test1 [--filter <tag-or-id>]
npx tsx src/dev/knowledge-audit.ts list
```

### Recording Results

After running audits, **update the status comments in `knowledge-audits.yaml`** with the date and results. Each test section (e.g., `# === Don't Drop Important Information ===`) should have a `# Status (YYYY-MM-DD):` comment noting:

- How many tests pass/fail
- Any notable failure patterns (turn limits, tool issues, knowledge gaps)
- What fixed previous failures (if relevant)

This is the primary way we track whether tests are passing over time. Reports in `reports/` are gitignored and ephemeral.

### Test Structure

- `prompt` — what to ask the agent
- `expected_level` — `knows_directly` (no file reads needed), `knows_about` (reads docs), `discoverable` (explores filesystem)
- `correct_contains` / `correct_contains_any` — strings that must appear in the response
- `cards_contain` — strings that must appear in card files created by the agent
- `should_read` — files the agent should read before answering
- `max_turns` — override the default 10-turn limit (use for tests requiring multi-step card creation)
- `tags` — for filtering with `--filter`
