---
title: "filed for later mado"
area: callback-box
resolution: wontfix
---

**Closed (2026-07-15): wontfix.** A speed-only win that doesn't fit: `mado` is
CommonMark+GFM and doesn't understand **Markdoc**, which we've since standardized
on — so it can't correctly lint our actual body syntax (its own caveat, now
decided). It also doesn't help the **link/reference checking** we actually care
about (`doc-check` owns that), and markdown-lint speed has never been a pain
point. Refile only if a Markdoc-aware fast linter appears.

<https://github.com/akiomik/mado> — fast Rust Markdown linter, CommonMark + GFM, ~50x faster than markdownlint. We already lint markdown, so this is mostly a speed win. Caveats: probably doesn't help with the link-checking we care about, and unclear whether either our current linter or mado understands Markdoc (which we plan to adopt).

Comparison of markdown linters: <https://panache.bz/guide/comparison.html> (covers several dialects but not Markdoc).
