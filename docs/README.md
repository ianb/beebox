# Documentation map

Start with the current guide for the area you are working in. Plans propose
changes; archived plans and reports preserve past reasoning and evidence.
Their presence is not a claim that a feature still exists or that a task is
still open.

| Area | Current entrypoint | History and proposals |
| --- | --- | --- |
| Contributing and repo-wide rules | [Contributing](../CONTRIBUTING.md), [agent router](../CLAUDE.md) | [Root reports](reports/) hold completed repo-wide audits. |
| Bee Box behavior and operations | [Guide index](../beebox/docs/guides.md), [documentation conventions](../beebox/docs/README.md) | [Plans](../beebox/docs/plans/README.md), [shipped plans](../beebox/docs/implemented-plans/), [retired plans](../beebox/docs/unimplemented-plans/README.md), and [dated reports](../beebox/docs/reports/). |
| Workstreams and developer tooling | [Tooling router](../bin/CLAUDE.md), [exhibit contract](../workstreams-app/docs/exhibits.md) | Feature plans and implementation records live with the Bee Box plan collection. |
| Other packages | Their README or CLAUDE.md, reached from the [repo router](../CLAUDE.md) | Keep package-specific references with their package. |
| External-system research | [Research conventions](../research/CLAUDE.md); each corpus has its own index | Findings describe the system at the time studied. Adoption decisions belong in plans/issues, not implied current instructions. |
| Developer pages and tools | [dev/README.md](../dev/README.md) | One-off review exhibits live outside git; `dev/` is for tracked pages and tools. |

## Root documents

[Agent SDK release applicability](agent-sdk-notes.md) is a maintained,
newest-first release ledger. Older entries are dated history; its top-level
reviewed-version marker is consumed by the SDK-update schedule. Keep its path
and marker format stable.

The [lint-suppression audit](reports/eslint-rule-suppression-audit-2026-05-30.md)
is a completed historical report. Current coding rules live in the contributor
and package guidance, not in that audit's progress log.

Historical material belongs off the current-guide path: link it explicitly as
history when its rationale helps, rather than making readers traverse it to
find the operating instructions. Preserve the record; do not refresh old
observations into unsupported claims about today.
