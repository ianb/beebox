# Synthetic document preparation fixtures

Five fictional Odette Marlowe household documents exercise native PDF text, an
image-only PDF, a junk hidden text layer, a rotated raster document, and a corrupt
PDF. `manifest.json` contains every fixture, its intended category, and preparation
expectation. `expected-text/` records author intent, never extracted evidence.

From the repository root, with Python 3, Poppler (`pdftotext`, `pdftoppm`) and
Tesseract (English and orientation data) installed:

```sh
python3 beebox/test/fixtures/triage-evaluation/documents/prepare.py --output scratch/jev-preparation-verified
```

The verifier writes only to the required output directory, rejecting paths inside
the triage-evaluation fixture tree. Its `results.json` covers all manifest entries, including
the expected corrupt-PDF failure. Actual native text, OCR, tool diagnostics and
rendered pages stay separate. Unexpected failures exit nonzero. Essential routing
phrases must survive OCR; whitespace and unrelated border/spacing noise may vary.
The junk layer must yield at least 100 isolated letter tokens; empty native text
is required for the scan. This does not run a classifier or calibrate thresholds.

`generate.py` deterministically recreates raw fixtures with reportlab 5.0.1 and
Pillow 11.3.0 (charset-normalizer 3.5.1). It currently requires macOS Arial fonts
at the paths in the script; preparation of committed fixtures needs no fonts or
Python packages. Generate only when intentionally updating fixtures. The PNG is
a synthetic rotated illustration, not a real camera photo. Clear synthetic pages
do not establish production OCR quality; handwriting, languages, HTML email and
relevance filtering need separate coverage. No secrets, network calls or APIs.
