# Plan Engineering Review — remove-cb-render

Cross-model review by OpenAI codex (`gpt-5.6-sol`, high reasoning,
read-only over the real repo), 2026-08-01, via the `codex` skill. Verbatim
findings below; absolute path prefixes shortened to repo-relative.

Every finding was independently verified against source before the plan was
revised. All seven were real. The plan at `remove-cb-render.md` has been updated
to address each; this file is the audit trail, not a to-do list.

## Codex findings (verbatim)

The central browser-safety claim is correct: repository-wide search found one provider, no hydration path, and no call site supplying `snapshot`. The wrapper’s type is broader than `useMachine`—it fails to require machine input—but all three input-bearing sites already pass valid input, while transcription/auth require none. I found no runtime counterexample to the five swaps.

Findings, ranked by impact:

1. **High — Track 3 is incomplete and can break ESLint outright.** [Track 3](callback-box/docs/plans/remove-cb-render.md:191) deletes `XSTATE_USE_MACHINE` but misses its third use in the outside-Vite block at [eslint.config.mjs:157](callback-box/src/frontend/eslint.config.mjs:157). If that block remains “unchanged,” config evaluation gets `ReferenceError: XSTATE_USE_MACHINE is not defined`; if the path survives another way, those files retain the obsolete ban. The plan’s “exactly one matching block” claim is also false for `OUTSIDE_VITE_SHARED_RAW`: both base and special blocks match, and the latter intentionally wins without `SHARED_ALIAS_PATTERN`. Change line 157 to `{ patterns: [...BOUNDARY_PATTERNS] }`, and run the boundary probe in both a normal file and an outside-Vite file such as `src/lib/view-url.ts`. Probing only an ordinary frontend file does not test the last-match hazard.

2. **High — command deletion omits the CLI barrel export.** [Track 2](callback-box/docs/plans/remove-cb-render.md:172) removes `render.ts` and two uses in `src/cli/index.ts`, but `renderCommand` is exported from [src/cli/commands/index.ts:44](callback-box/src/cli/commands/index.ts:44). Leaving it produces an immediate missing-module error. The plan inaccurately describes [src/cli/index.ts:52](callback-box/src/cli/index.ts:52) as the command import; it is an import from the barrel.

3. **High — “nothing outside `src/ssr` imports it” is false.** [The inventory claim](callback-box/docs/plans/remove-cb-render.md:50) misses `test/frontend/state-registry-routes.doctest.md`, which directly imports the deleted registry at [line 28](callback-box/test/frontend/state-registry-routes.doctest.md:28). That doctest should be deleted with the registry. Frontend/backend typecheck will not catch code embedded in Markdown; `pnpm test` will fail later. Consequently, the plan’s test-coverage account at lines 112–115 is materially incomplete.

4. **Medium — the proposed commit order knowingly creates a broken commit.** Chunk A deletes `useSSRMachine`, while the still-present SSR renderer imports it at [render.tsx:29](callback-box/src/frontend/src/ssr/render.tsx:29). The plan admits this intermediate commit does not typecheck at [lines 316–322](callback-box/docs/plans/remove-cb-render.md:316), contrary to the repository’s clean-commit rule. Either make command/SSR deletion one atomic commit with the rewiring, or land Track 2 first; deleting the provider first leaves the wrapper harmless and the tree valid.

5. **Medium — the manual pass does not actually exercise speech playback.** The rollout equates “narration toggle behaves” with covering `speechPlaybackMachine` at [lines 403–411](callback-box/docs/plans/remove-cb-render.md:403). The toggle only sends `SET_NARRATION` at [InteractiveChat-voice.ts:189](callback-box/src/frontend/src/components/chat/InteractiveChat-voice.ts:189); playback is driven by parsed `<speech>` segments at [InteractiveChat-speech.ts:53](callback-box/src/frontend/src/components/chat/InteractiveChat-speech.ts:53). Require an actual spoken assistant response—or the `/dev/speech` harness—and verify playback starts and completes.

6. **Medium — Track 4 repeatedly cites a nonexistent command and a false surviving execution graph.** There is no `cb view render`; the command is `cb view test` ([view.ts:352](callback-box/src/cli/commands/view.ts:352), registered at [384–389](callback-box/src/cli/commands/view.ts:384)). It renders compiled agent views using the dedicated Node widget entry, not `AgentViewRenderer`, `DebugLog`, `screenshot-relay`, or frontend `Markdown`. Those guards may remain as cheap general boundary defense, but comments must not be reattributed to `cb view render`. Likewise, [the claim that `useSyncExternalStore`’s third argument is required](callback-box/docs/plans/remove-cb-render.md:336) is false: the installed React type makes `getServerSnapshot` optional at `node_modules/@types/react/index.d.ts:2175-2179`.

7. **Medium — the prose done-condition cannot pass as written.** The plan updates `publish-pages.md` but misses live references in [docs-reorg.gap-analysis.md:57](callback-box/docs/plans/docs-reorg.gap-analysis.md:57), [cli-restructure.md:51](callback-box/docs/plans/cli-restructure.md:51), and [the Roku exploration issue:63](issues/exploration/2026-07-27-roku-tv-dashboard-display.md:63). The removal plan itself also contains many matches. Generated `docs/doc-graph.md` retains the deleted document, and `doc-check --fix` explicitly excludes it; `pnpm doc-graph` must be added. Therefore the grep assertion at [lines 400–402](callback-box/docs/plans/remove-cb-render.md:400) needs either broader cleanup or precise exclusions.

Citation errors worth correcting: `src/ssr` contains **9 files / 935 lines**, not “8 files / 728 lines”; and [render.ts:51](callback-box/src/cli/commands/render.ts:51) merely constructs the script path—the spawn occurs at [line 82](callback-box/src/cli/commands/render.ts:82).

**Single most important change:** rewrite Track 3 to explicitly remove the ban from the outside-Vite override while preserving its reduced boundary pattern set, then probe that last-match override directly.

## Disposition

| # | Verified? | How the plan changed |
|---|---|---|
| 1 | Yes — `eslint.config.mjs:157` does reference `XSTATE_USE_MACHINE` | Track 3 now enumerates all four references; the probe runs `eslint --print-config` on one file of each match class |
| 2 | Yes — `src/cli/commands/index.ts:44` exports it | Track 2 adds the barrel line; the "What already exists" entry corrected |
| 3 | Yes — `test/frontend/state-registry-routes.doctest.md:28` imports the registry | Doctest added to the deletion list; plan now states that typecheck/lint cannot see doctest code |
| 4 | Yes — the ordering did create a non-typechecking commit | Chunk order reversed: delete SSR first, rewire second |
| 5 | Yes — narration toggle only sends `SET_NARRATION` | Rollout adds an explicit speech-playback step via a real `<speech>` reply or `/dev/speech` |
| 6 | Yes — the command is `cb view test`, and it renders via the Node view host | Name fixed; the "surviving non-browser consumer" justification dropped and replaced with an honest one; `useSyncExternalStore` "required" claim corrected |
| 7 | Yes — three more live docs plus two open issues, and `doc-graph.md` is generated | Track 4(c) extended; `pnpm doc-graph` added; the grep done-when given precise exclusions |
| citations | Yes — 9 files/935 lines; spawn is at `render.ts:82` | Corrected in place |

Codex's opening assessment — that the plan's central safety claim holds (one
provider, no hydration path, no call site passing `snapshot`) — was also
independently confirmed. Its one addition there, that the wrapper's signature is
laxer than `useMachine` about required machine `input`, is now recorded in
Track 1 as an expected typecheck outcome.
