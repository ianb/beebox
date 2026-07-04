---
needs: [design]
area: callback-box
---

# "Before you build this" — embedding-indexed reuse search

The repeated failure mode: agent is asked for X, agent writes X from scratch, X already existed under a slightly different name in `src/components/ui/` or `src/lib/` or `cardworks/`. The agent doesn't know what to grep for because the existing thing's name doesn't match the task vocabulary. Result: parallel implementations, drift, the codebase gets harder to navigate over time precisely *because* it has more in it.

Idea: an index of available units — UI components, hooks, helpers, schemas, cardworks elements, services — keyed by an embedding of their *purpose* (from JSDoc, the type signature, neighboring usage). The agent, before building anything non-trivial, queries the index with a natural-language description of what it's about to write. The index returns the top few candidates with one-line summaries and file paths. If something fits, the agent reuses; if nothing fits, it proceeds and the index re-embeds the new thing.

Convention to make it stick: a short rule in `CLAUDE.md` ("before writing a new component / helper / schema, run `cb reuse-search 'description'` and consider the candidates") plus a pre-commit nudge when a new file in `src/components/ui/` or `src/lib/` doesn't appear in the index yet.

Open questions: where embeddings live (local Faiss index in `.callback-cache/`? a small server?); how to keep the index from going stale (rebuild on file change vs. on demand); whether the search is a CLI or a tRPC procedure the agent calls; how to surface *what was missed* — false negatives are the painful kind ("the helper existed but the search didn't return it").
