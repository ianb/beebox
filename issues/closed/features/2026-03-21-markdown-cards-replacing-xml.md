---
title: "markdown cards replacing xml"
workstream: unknown
area: beebox
resolution: implemented
---

**Closed:** Implemented: the card format moved to YAML frontmatter + Markdown body, and the legacy XML card format, its loader, and the `cardworks` package have since been fully removed. See `docs/cards-as-markdown.md` for the design and migration history.

Consider replacing card XML with Markdown files that have rich validated frontmatter (YAML). The frontmatter would carry all the structured data currently in XML attributes and elements, validated by Zod schemas just like today. The body would be Markdown instead of XML content elements.

Conventions for inline annotations could handle things like source attribution, status markers, or cross-references within the Markdown body. A `type` field in the frontmatter (or the file extension) would determine the schema, and could even indicate a non-Markdown content type for the body if needed.

Benefits: agents already write Markdown fluently, diffs are cleaner, easier to read/edit by hand, no need for the cardworks XML library. Tradeoffs: XML's strict structure prevents malformed cards — Markdown frontmatter is more loosely coupled from the body content.
