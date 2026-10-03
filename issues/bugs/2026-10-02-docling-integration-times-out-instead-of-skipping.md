---
title: "pdf extract.integration doctest times out instead of skipping when Docling cannot finish offline"
workstream: unattached
area: beebox
labels: [tests, environments]
filed-by: agent
discovered-in: worktree-knip-sweep — two full beebox suite runs on 2026-10-02, on a slow network link
---

`test/core/pdf/extract.integration.doctest.md` says it skips loudly wherever
Docling cannot run, and that its probe makes a cold environment "a fast skip,
never a build". On 2026-10-02 it failed with a tap `timeout!` instead (289 s,
twice in full runs, once alone).

The probe and the real call do not ask the same question:

- The probe runs `uvx --offline --from docling==<version> docling convert --help`.
  It passed, so the test did not skip.
- The real call (`doclingArgs`) runs `uvx --from docling==<version> --with
  onnxruntime --with rapidocr docling convert …` without `--offline`. During
  the hang the Docling Python process held open HTTPS connections to a
  CloudFront host. This is probably the model-weight download, which `--help`
  never exercises.

On a fast link this download finishes and the test passes, so the gap only
shows when the network is slow or absent.

Fix candidates (not implemented):

- Make the probe exercise what the real call needs: the same `--with`
  set, plus a check that the model weights are in the cache.
- Or run the real call offline in the test, and treat an offline failure
  as a loud skip.
