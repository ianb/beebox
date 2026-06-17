# CLAUDE.md size lint

A box `CLAUDE.md` loads into the agent's context every turn, so `cb validate`
surfaces a **soft** (never blocking) warning when one grows too large. The
check is character-based — a line can be a one-word bullet or a 170-char
paragraph, so line count is a poor proxy for context cost — with two tiers: a
gentle nudge at `CLAUDE_MD_WARN_CHARS`, firmer language at `CLAUDE_MD_FIRM_CHARS`.

```ts setup
import { lintClaudeMdSize, CLAUDE_MD_WARN_CHARS, CLAUDE_MD_FIRM_CHARS } from "../src/core/claude-md-lint.js";

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

## A lean CLAUDE.md is fine

A small box CLAUDE.md (the real `test1` box is ~467 chars) draws no warning.

```
tier(467)
=>
ok
```

## Just under the soft tier stays silent

```
tier(CLAUDE_MD_WARN_CHARS - 1)
=>
ok
```

## At the soft tier — a gentle nudge

```
tier(CLAUDE_MD_WARN_CHARS)
=>
soft
```

## Still soft just below the firm tier

```
tier(CLAUDE_MD_FIRM_CHARS - 1)
=>
soft
```

## At the firm tier — firmer language

```
tier(CLAUDE_MD_FIRM_CHARS)
=>
firm
```

## The warning names the file and reports its size

The message is a lint-style `warning <path> [claude-md-size] …` line carrying
the character count, so the agent (or boxholder) sees which file and how big.

```
warningLead("config/CLAUDE.md", 25000)
=>
warning  config/CLAUDE.md  [claude-md-size] 25000 chars
```
