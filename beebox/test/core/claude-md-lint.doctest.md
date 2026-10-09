# Instruction-file size lint

A box instruction file (`AGENTS.md`, or `CLAUDE.md` before conversion) loads
into the agent's context every turn, so `bbx validate` surfaces a **soft** (never blocking) warning when one grows too large. The
check is character-based — a line can be a one-word bullet or a 170-char
paragraph, so line count is a poor proxy for context cost — with two tiers: a
gentle nudge at `CLAUDE_MD_WARN_CHARS`, firmer language at `CLAUDE_MD_FIRM_CHARS`.

```ts setup
import { lintAllClaudeMd, lintClaudeMdSize, CLAUDE_MD_WARN_CHARS, CLAUDE_MD_FIRM_CHARS } from "../../src/core/claude-md-lint.js";
import { mkdtemp, mkdir, writeFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Classify the result into a stable tier label so these tests assert *which*
// tier fires, not the exact wording (which is free to evolve).
function tier(chars: number): string {
  const warning = lintClaudeMdSize("CLAUDE.md", "x".repeat(chars));
  if (warning === null) return "ok";
  if (warning.includes("too large")) return "firm";
  if (warning.includes("getting large")) return "soft";
  return "unexpected";
}

// The stable lead of the warning line (path + rule tag + size), so the test
// can assert labelling without pinning the prose that follows.
function warningLead(relPath: string, chars: number): string {
  const warning = lintClaudeMdSize(relPath, "x".repeat(chars));
  if (warning === null) return "ok";
  return warning.slice(0, warning.indexOf(" chars") + " chars".length);
}
```

## Just under the soft tier stays silent

```ts
tier(CLAUDE_MD_WARN_CHARS - 1)
=>
ok
```

## At the soft tier — a gentle nudge

```ts
tier(CLAUDE_MD_WARN_CHARS)
=>
soft
```

## Still soft just below the firm tier

```ts
tier(CLAUDE_MD_FIRM_CHARS - 1)
=>
soft
```

## At the firm tier — firmer language

```ts
tier(CLAUDE_MD_FIRM_CHARS)
=>
firm
```

## The warning names the file and reports its size

The message is a lint-style `warning <path> [claude-md-size] …` line carrying
the character count, so the agent (or boxholder) sees which file and how big.

```ts
warningLead("config/CLAUDE.md", 25000)
=>
warning  config/CLAUDE.md  [claude-md-size] 25000 chars
```

## Both instruction-file names are linted, mirrors once

`bbx validate` walks the box for every real instruction file: `AGENTS.md` in a
converted box, `CLAUDE.md` in one not yet converted. The `AGENTS.md` symlink
beside a legacy `CLAUDE.md` is the same content and is not reported twice.

```ts
const root = await mkdtemp(join(tmpdir(), "bbx-instruction-size-"));
await mkdir(join(root, "legacy"), { recursive: true });
await mkdir(join(root, "converted"), { recursive: true });
await writeFile(join(root, "legacy/CLAUDE.md"), "x".repeat(CLAUDE_MD_WARN_CHARS));
await symlink("CLAUDE.md", join(root, "legacy/AGENTS.md"));
await writeFile(join(root, "converted/AGENTS.md"), "x".repeat(CLAUDE_MD_WARN_CHARS));
(await lintAllClaudeMd(root)).map((w) => w.split("  ")[1])
=> ["converted/AGENTS.md", "legacy/CLAUDE.md"]
```
