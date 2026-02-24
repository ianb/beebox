# Knowledge Test Report — 2026-02-23T05:03:07.985Z

Box: /Users/ianbicking/src/boxes/scenarios/knowledge/box
Tests run: 1

## memo-xml-structure
**Prompt:** "Show me the XML structure of a memo card."
**Expected level:** knows_about
**Watch for:** Reads docs/generated/card-memo.md before answering

**Agent behavior:**
- Files read: /Users/ianbicking/src/boxes/scenarios/knowledge/box/docs/generated/card-memo.md, /Users/ianbicking/src/boxes/scenarios/knowledge/box/box/inbox/test-memo.memo.card
- Searches: Glob: **/*.memo.card; Grep: memo in .
- Bash: Try to see memo template output
- Response length: 95 words

**Response:**
> [thinking]
> Here's the XML structure of a memo card:
> 
> ```xml
> <memo status="new">
>   <created>2026-02-20T10:00:00Z</created>
>   <content>
> ## Test Memo
> 
> This is a sample memo card for knowledge testing.
>   </content>
>   <source>manual</source>
> </memo>
> ```
> 
> Key elements:
> 
> - **`<memo>`** — root element with a `status` attribute (`new`, `processing`, `processed`)
> - **`<created>`** — ISO 8601 timestamp
> - **`<content>`** — the memo body (supports markdown; may be empty for voice memos)
> - **`<source>`** — origin identifier (e.g., `manual`, `text`, `email`, `voice`)
> 
> For voice memos, there's also a `<transcription>` child element (added after audio processing), and potentially a `<transcription-error permanent="true">` if transcription failed.

**Automated checks:**
- ✓ Read docs/generated/card-memo.md

**Assessment:** (to be filled in during evaluation)

---
