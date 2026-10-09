# How Notebook stores sources and citations, against `{% source %}`

*Dated 2026-10-09. The Notebook side is reconstructed from the unofficial client [notebooklm-py](https://github.com/teng-lin/notebooklm-py) at `1d8920f` (2026-10-06), which decodes the web app's streamed chat protocol and its "TailwindDoc" document trees; the field names below are that client's, the wire positions are what it observed in live captures, and none of it is documented by Google. The enterprise API docs confirm the source-level facts. Bee Box is read at `cbffca9a9`. Part of the [NotebookLM research corpus](README.md); the broad comparison is [comparison.md](comparison.md).*

## How Notebook stores a source

A source is one **structured document with absolute character offsets**, not a bag of chunks.

- The document is a tree of blocks (paragraph, heading levels 1–6, list item with bullet or number and nesting level, table rows and cells, images and rules as non-text blocks). Each block holds text runs with bold, italic, underline and link. Every block, run and cell carries `[start_index, end_index)` in one coordinate space for the whole source, counted in **UTF-16 code units**. The same decoder reads three carriers of this tree: a source's full text, a chat answer, and a citation's fragment, so offsets on the source side and the answer side share one grammar.
- The source is readable back as plain text or as cleaned HTML/Markdown (`GET_SOURCE` with a format selector). Metadata carries word count and, in the enterprise API, token count. Processing has a status (`SOURCE_STATUS_COMPLETE`).
- Retrieval exists as a separate call (`RETRIEVE_RELEVANT_CHUNKS`): ranked passages per source, each with text and a `[start, end)` span in the source's coordinate space, optionally filtered to selected sources. This is the step whose results become citations.
- Nothing suggests per-chunk files or a vector store the client can see. Passages are ranges over the one document; a cited passage also carries a `DocumentObject.objectId`, an opaque id that the answer side refers back to.

The source model is therefore: **one canonical text per source, with structure, addressed by offset.** A PDF, a web page, a Doc and an audio transcript all become that.

## How a citation is stored

A chat answer streams as an envelope: the answer text with inline `[N]` markers, plus a structured answer document, plus a citation list. One citation holds:

| Field (client name) | What it is |
|---|---|
| `source_id` | the cited source |
| `chunk_id` | the passage object's id; also the key in the answer document's annotation map |
| `fragment_start_char`, `fragment_end_char` | the server's statement of the cited range in the source's offset space |
| fragment elements | the cited blocks themselves, verbatim, sliced out of the source tree (so the excerpt renders without fetching the source) |
| `score` | a relevance score, observed 0.6–0.7 |
| `answer_anchor_start`, `answer_anchor_end` | the range of the answer this citation supports, read from the answer document's annotations; usually zero-width, at the `[N]` marker |
| `citation_number` | assigned client-side, in answer order |

A note saved from chat keeps the answer text, the source passages and a `rich_content` block of anchors (`[[chunk_id], [None, 0, marker_position]]`), so the citations survive into the note. Converting a note to a source makes it citable in turn; nothing says the note's own citations survive that conversion. Reports exported to Docs are described as cited by third parties only. Tables export with citations on a second sheet. Audio and video outputs carry none.

Three properties follow:

1. **Citations are mechanical.** The retrieval step produced the passage; the model's job was to use it, and the citation is the retrieval record attached to the span of the answer it fed. The model does not decide whether to cite.
2. **The anchor is a coordinate, not a string match.** Clicking opens the source viewer at an offset range. It needs the source frozen (uploads and web pages are) or re-synced with offsets recomputed (Drive files; nothing says old citations are rebased).
3. **The excerpt travels with the citation.** Hover shows it without opening the source.

The known failure modes match: a citation can highlight the wrong passage (a reviewer), citations are "not always included", a very short source is cited as a whole, and the client's own history has two bugs in reading the fragment (truncated to the first block; a source-side range mistaken for an answer-side one), which says how fragile position-indexed arrays are even for a dedicated client.

## How Bee Box stores a citation

Bee Box has no retrieval step that produces citations. The agent searches (`bbx search` returns a card path plus a `#fragment` heading locator and an excerpt), reads, and then writes prose. Provenance is a Markdoc tag the agent chooses to write (`beebox/box-docs/provenance.md`):

```
{% source ref="/_content/notes/Bread.doc.card" usage="paraphrase"
   pos="body; heading: Proofing (#proofing); ~line 42"
   version="sha256:… git:abc123" %}
let it rise until doubled
{% /source %}
```

- **`ref`/`href`** (exactly one) names the card or URL; `bbx validate` warns on a dangling `ref` and `bbx mv` rewrites it.
- **`usage`** is prose: how the content was derived.
- **The body is the anchor.** For a span citation the verbatim excerpt is the tag body. At render time the chip calls `findQuoteRange`, which runs the browser text-fragment matching algorithm over the sibling pane (`F/lib/selection/quote-anchor.ts`), highlights with the CSS Custom Highlight API, and otherwise falls back to opening the target card. There is no offset.
- **`pos`** is "a rough hint, not an exact offset" by design (`F/lib/selection/position.ts`): section, nearest heading with its slug, paragraph number, approximate source line. Nothing parses it rigidly; it is the same grammar the composer writes on a `<user-selection>`.
- **`version`** carries a content hash and optionally a git revision, so a reader can tell the source moved on. Nothing rebases.
- **`retrieved`** dates an external fetch.
- The chip renders as `[→ Label: usage]`; in compiled plain-Markdown context it degrades to that bracket text.
- Chat answers use the same tag, or plain box-path links, which open the card in the companion pane but do not scroll to a heading (`resolveContentTarget` splits only on `?`, `F/lib/view-url.ts:137-144`).

## Where each is better

**Notebook's model is better at:**

- **Being there.** Every grounded answer cites, because citing is a property of the pipeline, not a rule the model follows. In Bee Box the rule exists (THE_LAW_OF_CHECKING: "say where you checked") and the journeys show it followed unevenly.
- **Precision.** An offset range into a canonical text addresses a span exactly, including one whose words recur elsewhere. Text-fragment matching finds the first occurrence; a short or repeated excerpt can land on the wrong one, and a span that crosses block boundaries or contains an image is hard to express as one string.
- **Compactness.** `[3]` costs three characters; the excerpt lives in the citation record, not in the citing text. A Bee Box span citation repeats the excerpt in the body, which is right for a commentary card (the excerpt is the point) and heavy for a chat answer with eight sources.
- **A claim-to-evidence map.** The answer-side anchor says which sentence a citation supports; the score says how well. `usage` says how the content was derived, which is a different and also useful thing, but it is prose and not comparable.
- **One coordinate space for every source type.** Audio, PDF, web and Docs all become the same addressed text, so one viewer and one highlight path serve all of them.

**Bee Box's model is better at:**

- **Surviving.** The citation is plain text in a plain file. It survives export, git, grep, a different renderer, and a model that never saw the box. Notebook's citations exist only inside Notebook; the export paths lose them (audio, video, Docs in part).
- **Saying what changed.** `version: sha256:` is a drift signal; Notebook has no answer to "the source changed since this was cited" except Drive re-sync with unspecified effect on old citations.
- **External sources.** `href` with `retrieved` cites a page and dates the fetch; Notebook can only cite its own imported copy.
- **Honesty about derivation.** `usage="inferred from her email signature"` is a kind of provenance Notebook cannot express; its citations assert support, with a score, and nothing more.
- **Composition with quotes.** `{% source %}` wrapping `{% quote %}` says "these exact words, from there"; the distinction between a person's words and a document excerpt is kept.
- **Resilience to re-rendering.** A text anchor still finds its span after a Markdown edit elsewhere in the file; an offset anchor is invalidated by any edit before it.

**Neither is good at:** a source that was edited at the cited spot. Notebook's offsets point at the wrong text; Bee Box's text match fails and falls back to opening the card, with the hash saying "something changed" but not what.

## What this suggests for Bee Box

Three gaps are real and separable. None is a plan; each would need its own.

1. **Mechanical citation where retrieval is mechanical.** `bbx search` already returns `path#fragment` locators and an excerpt per hit. A chat answer that used a search hit could carry that locator without the agent composing an anchor by hand. The place to do this is the search result format and the prompt, not the tag: a hit's locator is already a valid `ref` with a fragment, and the chat link renderer would need to honor `#fragment` (today it does not). That is the cheapest step and closes most of the "cites unevenly" gap for the research-answer case.
2. **A compact reference form for chat.** The inline wrapping form is right for cards. For an answer with many sources a short marker with the excerpt on hover would read better, and the renderer already has the excerpt available if the tag carries it. This is a rendering choice over the same tag (empty-body `{% source %}` with `pos` and a `quote` attribute, or a chip style), not a second citation system. The constraint to keep is the one the provenance doc states: the agent never writes the rendered `[→ …]` form.
3. **A stable locator for a span.** `pos` is rough by design, and that is the right default for a human-written hint. For a machine-produced citation, a second locator that is exact and cheap would be an offset into the card's rendered plain text, or better, a heading slug plus a text-fragment directive (`#heading:~:text=start,end`), which is the web's own standard for this, already what `findQuoteRange` implements, and survives edits elsewhere in the file better than an integer offset. Notebook's UTF-16 offsets are the wrong thing to copy; the text-fragment directive gets the precision without the brittleness.

What not to copy: a separate citation record outside the document (the citation's home is the text, which is the whole reason it survives); a relevance score (it is a retrieval artifact, not provenance); a single canonical text per card that all viewers address (cards are not one text; a `pdf` card has pages and a `person` card has fields).

None of this is filed as an issue yet: the three gaps are an assessment for discussion, and the first one touches the search result contract and the chat link renderer together, which is a design question.
