# Unimplemented plans

Plans and design explorations that were **not** implemented as written. They are kept because
the reasoning is still valuable — a later plan may supersede them (and cite what it kept and
dropped), or the idea may simply have been shelved.

Contrast with the siblings:

- `docs/plans/` — active proposals, not yet shipped.
- `docs/implemented-plans/` — shipped as written (moved there by `/finish`).
- `docs/unimplemented-plans/` — retired without shipping; each file's header should say what
  superseded or shelved it.

| Doc | Disposition |
|---|---|
| `boxes-as-packages-v1-superseded.md` | Superseded by `../implemented-plans/boxes-as-packages-v2.md` (2026-07-03), which re-derived the design against the current codebase and kept its core (Option C, per-box processes, auth-in-front, Stance B editing model) while reversing distribution (tarball/npm over private bare repo) and the src/data framing details. |
| `box-user-account-spec.md` | Derivative of boxes-as-packages-v1-superseded.md; the OS-user-as-box-identity idea is deferred to the isolation-hardening subplan named in `../implemented-plans/boxes-as-packages-v2.md` (§Subplans). Not superseded — parked until the fleet conversion lands. |
| `design-card-views-superseded.md` | Superseded by the shipped renderer system: `src/frontend/src/renderers/` + the file-types registry, keyed off frontmatter `type` rather than this doc's XML `tagName`-based plugin registry. |
| `query-cards.md` | Parked 2026-07-03; vocabulary explored but not planned for implementation. Parent design lives on in `../plans/interface-as-cards.md`. |
| `capture-pipeline-redesign.md` | Parked 2026-03 — direction (simpler capture pipeline) may still be relevant; OCR vendor pricing in body is stale. |
| `design-vision-superseded.md` | Superseded by `../design/` (2026-07-04) — each section adjudicated in `../plans/design-reconciliation.md` (rulings 3, 17, 18, 19); survivors harvested into `../design/identity.md`, `../design/extensibility.md`, `../design/representation.md`. |
| `email-volume-and-materialization-superseded.md` | Superseded by `../plans/email-tracking.md` (2026-08-05) after the boxholder chose card-existence tracking, deletion-as-untracking, procedure triggers, and a constrained `gws` passthrough instead of callback-specific promote/demote and remote-search wrappers. |
