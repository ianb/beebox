---
title: "bbx webpage save: server bytes from the browser, and non-HTML pages"
workstream: shared-browser
area: beebox
priority: normal
filed-by: agent
discovered-by: Ian
discovered-in: shared-browser, feedback from a research box with about 5,100 saved sources
---

Two requests that `bbx webpage save` does not meet yet.

**Server bytes from the browser.** `--browser` saves the rendered page without
scripts. The research box found that `fetch(location.href)` run inside the
cleared browser session returns the server's exact bytes, status, and headers.
They suggest trying this first, falling back to the rendered page, and recording
which one in `capture`. Both are needed: one site's bot manager blocked scripted
fetches while page loads still worked.

**Non-HTML pages.** About a fifth of that box's sources are PDFs. The command
fails on any type that is not HTML or XML. Options: let the box function receive
any type, or add a standard PDF path. The card type and its saved copy also need
a decision for a PDF.

## Status 2026-11-01

Non-HTML pages: built as `bbx pdf save` (a standard PDF path with its own card type, saved copy, and `capture` fields); see `beebox/docs/plans/knowledge-base-tools.md`. Still open: server bytes from the browser. `bbx webpage save --browser` should try an in-page `fetch(location.href)` first, fall back to the rendered page, and record which one in `capture`. Other document types (not HTML, not PDF) stay unhandled.
