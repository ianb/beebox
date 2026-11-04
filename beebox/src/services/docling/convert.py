"""Docling conversion driver for beebox.

Run by `services/docling/core.ts` as
`uvx --from docling==<pin> --with onnxruntime --with rapidocr python -I convert.py '<request json>'`.

It converts one PDF and writes what `docling convert --to md --to json
--image-export-mode referenced` writes: `<stem>.md`, `<stem>.json` and
`<stem>_artifacts/{page,image}_NNNNNN_<sha256>.png`. The pixels, names, markdown
and JSON match the CLI's for the same options (decisions log D18). It exists
because the memory controls below are reachable only through Docling's Python
API, not its CLI.

Memory, measured in D18:
- The pipeline keeps no page images. With images on, Docling holds every page's
  2x render until the document is assembled (about 14 MB a page). The renders
  and figure crops are made afterwards, one page at a time.
- Batches of one page and short queues between stages cut the inference spike.

Exclusion: before importing Docling, the driver takes each lock in
`lockPaths` in order (the box lock, then the host lock) as a kernel `flock`.
The kernel releases them when this process ends, however it ends, so a lock
can never outlive the conversion or expire while it runs.

Progress goes to stderr as `bbx-docling: <message>`; a failure reason as
`bbx-docling: error: <message>`.

Exit codes: 0 converted; 1 failed (reason on stderr); 70 parent gone;
75 a lock wait ran out.
"""

from __future__ import annotations

import fcntl
import json
import os
import sys
import threading
import time
from pathlib import Path
from typing import IO, Any

EXIT_FAILED = 1
EXIT_ORPHANED = 70
EXIT_BUSY = 75

# Page renders at 2x the PDF's 72-dpi page box: 144 dpi, as the CLI's
# referenced mode sets `images_scale = 2` (D4).
IMAGE_SCALE = 2.0


def say(message: str) -> None:
    """One `bbx-docling:` progress line on stderr."""
    print(f"bbx-docling: {message}", file=sys.stderr, flush=True)


def fail(message: str) -> None:
    """The run's failure reason; core.ts puts the last one on the card."""
    say(f"error: {message}")


# The lock files, open for the life of the process. Never closed by hand: the
# kernel releases them at exit, after any Docling stage thread still running
# (they are non-daemon threads) has finished with its memory.
HELD_LOCKS: list[IO[str]] = []


def watch_parent(pid: int) -> None:
    """Exit when the Node process that started us is gone.

    uv runs Python as its child, so `getppid()` is uv, not Node; Node passes
    its own PID. Without this, a killed `bbx` leaves Docling running, holding
    the locks and the memory, while a retry starts another conversion.
    """
    while True:
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            try:
                say(f"the process that started this conversion ({pid}) is gone; stopping")
            except Exception:  # noqa: BLE001 (its stderr reader is usually gone too)
                pass
            finally:
                os._exit(EXIT_ORPHANED)
        except PermissionError:
            pass  # Alive, and owned by another user.
        time.sleep(2)


def acquire_locks(paths: list[str], wait_seconds: float) -> None:
    deadline = time.monotonic() + wait_seconds
    announced = False
    for lock_path in paths:
        Path(lock_path).parent.mkdir(parents=True, exist_ok=True)
        handle = open(lock_path, "a", encoding="utf-8")  # noqa: SIM115 (held until exit)
        while True:
            try:
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if not announced:
                    say("waiting for another Docling conversion to finish")
                    announced = True
                if time.monotonic() >= deadline:
                    fail(f"another Docling conversion held {lock_path} for over {int(wait_seconds)} seconds")
                    sys.exit(EXIT_BUSY)
                time.sleep(1)
        HELD_LOCKS.append(handle)
    say("lock acquired")


def convert(req: dict[str, Any]) -> int:
    # Imported after the locks: a waiting driver should cost megabytes, not the
    # ~250 MB these imports take.
    from docling.backend.docling_parse_backend import DoclingParseDocumentBackend
    from docling.datamodel.accelerator_options import AcceleratorOptions
    from docling.datamodel.base_models import ConversionStatus, InputFormat
    from docling.datamodel.document import InputDocument
    from docling.datamodel.pipeline_options import OcrMode, PdfPipelineOptions, TableFormerMode
    from docling.document_converter import DocumentConverter, PdfFormatOption
    from docling.models.factories import get_ocr_factory
    from docling_core.types.doc import ImageRef, ImageRefMode, PictureItem
    from docling_core.types.doc.base import Size

    source = Path(req["source"])
    out = Path(req["outputDir"])
    ocr: str = req["ocr"]

    # The same options `docling convert` builds for core.ts's former argv
    # (`--table-mode fast --device cpu --ocr-engine rapidocr --ocr-mode …`),
    # read off docling/cli/main.py at the pinned version.
    ocr_options = get_ocr_factory(allow_external_plugins=False).create_options(
        kind="rapidocr",
        mode=OcrMode.LAYOUT_REGIONS if ocr == "regions" else OcrMode.FULL_PAGE,
    )
    languages = req.get("languages")
    if languages:
        ocr_options.lang = list(languages)
    # Cap the side of each image RapidOCR reads at 1280 px (default 2000).
    # On degraded test scans with known text this raised word recall and cut
    # run-together words from 29 to 4, with less memory and time (D20).
    ocr_options.rapidocr_params = {"Global.max_side_len": 1280}
    options = PdfPipelineOptions(
        accelerator_options=AcceleratorOptions(num_threads=4, device="cpu"),
        do_ocr=ocr != "off",
        ocr_options=ocr_options,
        do_table_structure=True,
        document_timeout=float(req["documentTimeoutSeconds"]),
    )
    options.table_structure_options.do_cell_matching = True
    options.table_structure_options.mode = TableFormerMode.FAST
    # The memory changes (D18). Everything above is the CLI's.
    options.generate_page_images = False
    options.generate_picture_images = False
    options.layout_batch_size = 1
    options.table_batch_size = 1
    options.ocr_batch_size = 1
    options.queue_max_size = 4

    converter = DocumentConverter(
        format_options={
            InputFormat.PDF: PdfFormatOption(pipeline_options=options, backend=DoclingParseDocumentBackend),
        }
    )
    result = converter.convert(source, raises_on_error=False)
    if result.status != ConversionStatus.SUCCESS:
        details = "; ".join(str(error.error_message) for error in result.errors)
        fail(f"conversion ended with status {result.status.value}: {details or 'no details'}"[:400])
        return EXIT_FAILED
    doc = result.document
    del result, converter

    artifacts = out / f"{source.stem}_artifacts"
    artifacts.mkdir(parents=True, exist_ok=True)

    # Figure files are numbered by position among all pictures in document
    # order, as docling-core numbers them on a referenced save.
    figures_by_page: dict[int, list[tuple[int, PictureItem]]] = {}
    position = 0
    for item, _level in doc.iterate_items(with_groups=False):
        if isinstance(item, PictureItem):
            if item.prov:
                figures_by_page.setdefault(item.prov[0].page_no, []).append((position, item))
            position += 1

    def image_ref(path: Path, width: int, height: int) -> ImageRef:
        return ImageRef(
            mimetype="image/png",
            dpi=int(72 * IMAGE_SCALE),
            size=Size(width=width, height=height),
            uri=path,
        )

    # The same backend and render call the pipeline uses, so the pixels (and
    # the hashes in the file names) are the CLI's.
    backend = InputDocument(path_or_stream=source, format=InputFormat.PDF, backend=DoclingParseDocumentBackend)._backend
    try:
        for page_no in sorted(doc.pages):
            page = doc.pages[page_no]
            page_backend = backend.load_page(page_no - 1)
            try:
                render = page_backend.get_page_image(scale=IMAGE_SCALE)
            finally:
                page_backend.unload()
            page_path = artifacts / f"page_{page_no:06}_{PictureItem._image_to_hexhash(render)}.png"
            render.save(page_path, "PNG")
            page.image = image_ref(page_path, render.width, render.height)
            for figure_position, item in figures_by_page.get(page_no, []):
                box = item.prov[0].bbox.scaled(scale=IMAGE_SCALE).to_top_left_origin(
                    page_height=page.size.height * IMAGE_SCALE
                )
                crop = render.crop(box.as_tuple())
                figure_path = artifacts / f"image_{figure_position:06}_{PictureItem._image_to_hexhash(crop)}.png"
                crop.save(figure_path, "PNG")
                item.image = image_ref(figure_path, crop.width, crop.height)
            del render
    finally:
        backend.unload()

    # Placeholder mode writes the document as it stands, with the file URIs set
    # above. Referenced mode would deep-copy it and load every image back in.
    doc.save_as_json(out / f"{source.stem}.json", image_mode=ImageRefMode.PLACEHOLDER)
    markdown = doc.export_to_markdown(image_mode=ImageRefMode.REFERENCED)
    (out / f"{source.stem}.md").write_text(markdown, encoding="utf-8")
    return 0


def main() -> int:
    req = json.loads(sys.argv[1])
    parent = req.get("parentPid")
    if isinstance(parent, int) and parent > 0:
        threading.Thread(target=watch_parent, args=(parent,), daemon=True).start()
    acquire_locks(list(req["lockPaths"]), float(req["lockWaitSeconds"]))
    try:
        return convert(req)
    except Exception as error:
        # One line for the card; the traceback above it stays in the output tail.
        import traceback

        traceback.print_exc()
        fail(f"{type(error).__name__}: {error}"[:400])
        return EXIT_FAILED


if __name__ == "__main__":
    sys.exit(main())
