---
title: "Evaluate codebase-memory-mcp, against extending bin/issues search to code plus a few tools"
workstream: unattached
area: docs
labels: [agent-workflow]
filed-by: agent
discovered-by: Ian
discovered-in: main session — boxholder asked whether the repo has code embedding search
priority: normal
---

The repository has no code search beyond text. `bin/issues search` (BM25,
hybrid, or semantic with embeddings cached in `.issues-index/`) covers the
issue queue, and `bin/issues similar --docs` adds `beebox/docs/`. For code,
agents use ripgrep, git history, and the TypeScript language server. Nothing
answers structural questions such as "every caller of X that skips Y" or
"what does this change touch".

## The candidate

[codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp)
(DeusData, MIT) is an MCP server that builds a code knowledge graph:

- tree-sitter parsing (162 languages) plus a built-in type-resolution layer
  for 12 languages, TypeScript included;
- one native binary, no runtime dependencies, fully local, no API key;
- graph stored in SQLite under `~/.cache/codebase-memory-mcp/`;
- a background watcher that polls git and re-indexes changed files;
- 17 tools, among them `search_graph` (structural, BM25, or semantic),
  `trace_path`, `detect_changes`, `query_graph` (Cypher),
  `get_architecture`, `get_file_outline`, and `get_code_snippet`.

The [incident-investigation skill](2026-09-30-evaluate-incident-investigation-skill.md)
names this server as the instrument for its anti-pattern search, because an
anti-pattern is a structural shape that grep finds only partially.

## The boxholder's leaning

Probably nothing this large is needed. The alternative: extend `bin/issues`
search to cover code (or a code corpus beside issues and docs), and add a few
narrow tools for the structural questions that come up in practice.

## What to decide

- **Which questions agents actually ask.** Collect real cases from recent
  sessions (anti-pattern sweeps, "who calls this", impact of a change, dead
  code) before choosing. Some are already covered: `pnpm lint:knip` finds
  dead exports, `pnpm lint:circular` finds import cycles, and the language
  server answers definitions and references.
- **Embeddings for code.** Does semantic search over code help here, or is
  BM25 over identifiers and comments enough? Embedding the whole tree costs
  more than embedding issues and docs, and changes much more often.
- **Operational fit for an external server:**
  - many checkouts (main plus each worktree), each a separate index or a
    shared one that is stale for some of them;
  - a polling watcher on this Mac, where fseventsd lag has already caused
    stale-module trouble;
  - one more MCP server in every session's context.
- **What a "few tools" set looks like** if built in-house: perhaps a file
  outline, a callers-of query from the language server, and a changed-symbols
  report for a diff.

A trial is cheap: install the binary, index one checkout, and run it on two or
three real structural questions from past sessions, compared with what grep
and the language server gave.
