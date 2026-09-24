---
title: "bbx validate's absolute-machine-path guard flags /home/ or /Users/ inside ordinary URLs"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: main — production box feedback triage (bbx feedback)
priority: important
---

`bbx validate` flagged a plain `https://` URL as leaking an "absolute machine
path" because the URL's own path happened to contain a `/home/` segment
(the shape `https://example.gov/App/home/<section>/...`). The URL
carries no machine-specific information; the check is a false positive.

The monorepo's own guard has it too: writing this issue with a literal
example URL made `bin/path-leak-check.ts` reject the commit, for the same
reason and with the same wrongness. Whatever fix lands should be considered
for both, which the sibling-checker note below already anticipates.

## Mechanism

`beebox/src/lib/absolute-path-check.ts`'s `findAbsoluteMachinePaths()` matches
the raw regex `HOME_PATH = /\/(?:Users|home)\/([\dA-Za-z][\w.-]*)\//g`
against the full card text with no surrounding-context check. It has no
allowance for the match sitting inside a URL (no check for a preceding
`://` / scheme, or that the match starts at a path boundary rather than
mid-URL). The allowlist (`ALLOWED_ABSOLUTE_PATH_NAMES`) only covers specific
placeholder names (`me`, `you`, `user`, `x`), which does not help here: the
segment after `/home/` is an arbitrary URL path component, not a personal-name
path at all.

This is called from `beebox/src/core/card-lint.ts:320`, so it fires on every
`bbx validate` run over card content containing such a URL.

## Why the resolution isn't obvious

The guard's whole purpose (`docs/implemented-plans/one-root-box-layout.md`,
Track B) is catching machine-specific home-directory leaks in otherwise
portable box content, and it intentionally shares its regex shape with the
monorepo's own `bin/path-leak-check.ts` "on purpose... not shared code." A
fix needs to skip matches inside URLs without reintroducing false negatives
for genuine `file://` or bare-path leaks that themselves reference a URL-like
string, and ideally stays in sync with the sibling checker's approach rather
than diverging further.
