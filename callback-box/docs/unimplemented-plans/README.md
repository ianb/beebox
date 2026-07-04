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
| `boxes-as-packages.md` | Superseded by `../plans/boxes-as-packages-v2.md` (2026-07-03), which re-derived the design against the current codebase and kept its core (Option C, per-box processes, auth-in-front, Stance B editing model) while reversing distribution (tarball/npm over private bare repo) and the src/data framing details. |
| `box-user-account-spec.md` | Derivative of boxes-as-packages.md; the OS-user-as-box-identity idea is deferred to the isolation-hardening subplan named in `../plans/boxes-as-packages-v2.md` (§Subplans). Not superseded — parked until the fleet conversion lands. |
