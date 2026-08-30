# Real Claude scan vision — the one gated integration test

Everything else about the Claude scan backend is tested against fixtures and
the fake. This file makes **one real agent-SDK call** with a generated test
image, because the fixtures cannot catch the things that actually break: the
SDK rejecting the generated JSON schema, a changed `outputFormat` contract, a
turn budget that stops sufficing, an auth/env convention drift.

It is **skipped** — loudly, with a reason on stderr — wherever the Claude
harness cannot run: no Claude Code binary, not logged in, no network. A skip
is a normal outcome in CI; the assertions name which path ran. Expect roughly
half a minute of wall clock when it does run (one Sonnet call, one page).

```ts setup
import { createClaudeScanVision } from "../../src/services/scan-vision-claude.js";
import { resolveClaudeCodeBinary } from "../../src/core/sdk-binary-path.js";
import { checkClaudeAuth } from "../../src/core/agent/auth-preflight.js";
import Sharp from "sharp";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Probe: is the Claude harness usable here at all? Binary resolution is
// instant; the auth check shells `claude` once (positive results are cached).
async function claudeRunnable() {
  if (resolveClaudeCodeBinary() === null) return "no Claude Code binary found";
  try {
    await checkClaudeAuth();
    return null;
  } catch (e) {
    return `Claude auth unavailable (${e instanceof Error ? e.message : String(e)})`;
  }
}

const skipReason = await claudeRunnable();
if (skipReason) console.warn(`[skipped] scan-vision-claude-integration: ${skipReason}`);

// A legible synthetic page: white background, large black caption text —
// enough for the model to classify and transcribe something deterministic-ish.
async function makeTestPage(dir) {
  const svg = `<svg width="800" height="600" xmlns="http://www.w3.org/2000/svg"><rect width="800" height="600" fill="white"/><text x="60" y="300" font-size="48" font-family="sans-serif" fill="black">May 1985</text></svg>`;
  const p = join(dir, "page-0.jpg");
  await Sharp(Buffer.from(svg)).jpeg().toFile(p);
  return p;
}
```

## One real call: structural post-conditions hold

We assert structure, not semantics: exactly one analysis, index 0, a null
`subject_bbox` (schema-enforced), and reported usage/cost — the contract the
photo flow depends on, exercised against the real SDK.

```ts
const dir = skipReason ? null : await mkdtemp(join(tmpdir(), "scan-vision-int-"));
const result = skipReason
  ? { analyses: [{ index: 0, subject_bbox: null }], usage: { prompt: 1 }, costUsd: 0 }
  : await createClaudeScanVision({ boxRoot: dir }).analyzeBatch({ imagePaths: [await makeTestPage(dir)], boxholderContext: null });
skipReason ? "SKIPPED" : "RAN";
result.analyses.length
=> 1

result.analyses[0]?.index
=> 0

JSON.stringify(result.analyses[0]?.subject_bbox)
=> null

result.usage !== null && (skipReason ? true : result.usage.prompt > 1000)
=> true

skipReason ? true : typeof result.costUsd === "number" && result.costUsd > 0
=> true
```

```ts cleanup
if (dir) await rm(dir, { recursive: true, force: true });
```
