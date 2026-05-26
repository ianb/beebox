---
name: feedback-placeholder-syntax
description: "In prose/instructions inside XML-card schemas, don't use angle-bracket placeholders like <foo> — they read as XML tags. Use {foo} instead."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 63468515-9a76-4fe9-b45f-d5d751d239be
---

In prose, examples, or instructions that appear alongside XML (especially inside cardworks schema `instructions` strings, docs about card formats, or example XML snippets), don't use angle-bracket placeholders like `<model-id>` or `<value>`. They visually collide with real XML tags and confuse both humans and LLMs reading the text. Use brace-style placeholders instead: `{modelId}`, `{value}`.

**Why:** the user called this out when reviewing schema instructions — `<model-id>` in an example string looked like an XML element name.

**How to apply:** any time you write example content, format hints, or fill-in-the-blank patterns in schema `instructions`, prompts, or docs that sit near XML, default to `{name}` placeholders. Plain XML tag references (when you're actually naming a real element like `<filename>`) are still fine.
