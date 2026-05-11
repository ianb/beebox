# Manual tests

Tests in this directory are **excluded from `npm test`**. They run real
processes (the Claude SDK, network calls, etc.) that are too slow or
expensive to run in CI / pre-commit.

## Running

```bash
npm run test:manual                                  # run all
npm run test:manual -- test/manual/chat-queue-real.doctest.md   # one file
```

Each manual test should:

- Document at the top *what it's diagnosing* and *why it can't be automated*
- Be deterministic in its assertions (booleans, counts) — `print()` raw
  agent output for the human reader, but assert on shape, not content
- Bound runtime with timeouts so a wedged test fails instead of hanging
- Clean up its own tmp boxes / processes
