# Dev Scripts

Stand-alone CLI tools that aren't part of the running app. Each is run manually or on a periodic cadence; none are imported elsewhere. The knowledge-audit harness has internal structure (`lib/`, `reports/`, `knowledge-audits.yaml`); the others are single files.

| Script | What it does | Full doc |
|--------|--------------|----------|
| `knowledge-audit.ts` | Runs YAML-defined tests against a real box agent | `docs/knowledge-audits.md` |
| `prompt-report.ts` | Generates `docs/prompts.md` (system-wide prompt inventory) | `docs/maintenance.md` |
| `prompt-viewer.ts` | Generates data for the `dev/prompts/` browser page: static inventory + assembled situations + duplication scan + a tracked size ledger. Shares `lib/prompt-inventory.ts` with `prompt-report.ts` (`pnpm prompt-viewer --box <path>`) | `docs/maintenance.md` |
| `agent-context.ts` | Renders the complete assembled context a box agent gets in one situation (chat/chat-thread/reactor), layer by layer with word counts (`pnpm agent-context chat --box <path>`) | `docs/prompt-surface-review.md` |
| `doc-graph.ts` | Generates `docs/doc-graph.md` (cross-reference graph + orphan/broken-ref report) | `docs/maintenance.md` |
| `doc-check.ts` | Enforcement twin of doc-graph: exits nonzero on broken refs, live-area orphans, duplicate `issues/` basenames, or a public file linking into `private-issues/` (lexical, never auto-fixed — lib: `private-link-check.ts`); run by pre-commit on any .md commit. `--fix` repairs decayed links via unique-basename lookup (lib: `doc-link-repair.ts`) | `docs/README.md` |
| `doc-graph-html.ts` | Generates `docs/doc-graph.html` — narrative showcase of the doc system (onboarding rings + topic pillars). Shares the data layer (`doc-graph-data.ts`) with `doc-graph.ts`. | — |
| `generate-doc-images.ts` | Generates illustrations for `docs/architecture/` | `docs/architecture/CLAUDE.md` |
| `csp-digest.ts` | Digests the JSONL CSP violation log (incremental via per-box cursor) | `docs/content-security-policy.md`, `docs/scheduled/csp-violation-review.md` |
| `csp-report.ts` | Local macOS runner: gathers CSP logs (all local boxes + prod over SSH), writes+opens an HTML report every run, notifies only on new violations or newly-clean/harden-ready. Runner-owned state in `scratch/csp-report-state.json` (separate from csp-digest's cursors) | `docs/scheduled/csp-violation-review.md` |

To add a new script here: register it as a `scripts` entry in `package.json` (invoke via `pnpm <name>`) so knip recognizes it as an entry point, and document it in the table above.
