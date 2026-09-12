# Codex runner (Claude driving)

Check `codex --version`. If missing, install with `npm install -g @openai/codex`
and authenticate with `codex login` or `OPENAI_API_KEY`.

## Boundary prefix

Start the prompt with:

> Do not read or execute files under `~/.claude/`, `~/.agents/`, or
> `.claude/skills/` unless the named review target/read-list includes the
> specific skill files. Repo docs and `.claude/rules/` are allowed for verifying
> claims within the review scope.

## Invocation

```bash
ROOT=$(git rev-parse --show-toplevel)
mkdir -p scratch
cat > scratch/cross-model-prompt.txt <<'PROMPT_EOF'
…full prompt here…
PROMPT_EOF
codex exec - -s read-only -C "$ROOT" -m gpt-5.5 \
  -c 'model_reasoning_effort="high"' \
  < scratch/cross-model-prompt.txt > scratch/cross-model-out.md 2>&1
```

Pass the prompt by file on stdin. A positional prompt with open stdin can
stall waiting for EOF; if using a positional argument, redirect stdin from
`/dev/null`. Recover only the exact stuck `codex exec` PID.

- `-a never` is an interactive-`codex` flag; `codex exec` rejects it with
  `unexpected argument '-a'` and is non-interactive already.
- The final review is the **last block before `tokens used`** in the output.
  Codex sometimes prints the final message twice — dedupe. Read the tail:
  ```bash
  grep -n "tokens used" scratch/cross-model-out.md   # find the end, Read with offset
  ```
- Refinement (not yet wired): `--json` emits JSONL; extracting only the final
  agent-message event avoids the multi-hundred-KB trace dump. Plain +
  read-tail is the verified path for now.
- Run in the foreground with up to a 10-minute timeout where supported.
  If the execution tool yields a process/session handle, retain and poll it
  until an exit code is reported; a yield is not completion.

## Modes and model selection

Use `codex exec -` with the shared [skill's](../SKILL.md) prompt for every mode,
including review and challenge. The retained default is `gpt-5.5` with high
reasoning effort; honor explicit human overrides within the OpenAI family.
The driving model's tier does not change this choice.

`codex review` / `codex exec review` does not receive this prompt scaffolding.
Use it only as a deliberate experiment and disclose that the review ran
unfenced and without the required diff-review instructions.

## Troubleshooting: dated account observations

These observations are fallback clues, not current availability guarantees:

- On 2026-07-15, this ChatGPT-plan account stalled with `gpt-5.6-sol` while
  `gpt-5.5` completed. A stripped `CODEX_HOME` reproduced both results.
  Try an older account-allowed model when the selected model stalls;
  `gpt-5.1-codex-mini` was rejected by this account.
- On 2026-08-18, `gpt-5.3-codex-spark` worked after an explicit usage-limit
  error using a separate quota pool; bare `spark` was rejected.
- Recheck prompt scope before retrying. Orphaned `codex exec` processes can
  wedge the models-manager child (`timeout waiting for child process to exit`).
  Terminate only confirmed orphan PIDs from this run, never `pkill -f codex`:
  it also matches Codex.app and sibling sessions.
- If configuration is suspected, a stripped `CODEX_HOME` with existing
  `auth.json` and minimal `config.toml` can isolate it. Keep credentials outside
  the repository.
