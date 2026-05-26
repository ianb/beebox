---
name: Use ref="" for links in card schemas
description: All link elements in cardworks/callback-box schemas use ref="" as the attribute, never href/path/url/target.
type: feedback
originSessionId: b4231988-7b18-42bf-bd54-925cbec77e27
---
When defining or using link elements in card XML schemas, the attribute is **always `ref=""`** — not `href`, `path`, `url`, `target`, or any other variant.

Example: `<link ref="Bread.recipe.card">bread</link>` — `ref` for the target, inner text for the local label.

**Why:** Consistent linking convention across all card schemas in callback-box. The user emphasized this as a hard rule ("ALWAYS ref="" FOR LINKS!") during the Landmark schema design.

**How to apply:** Any time a card schema needs to point at another card or path — link, reference, pin, "see also," nearby — the attribute name is `ref`. The element name can vary (`<link>`, `<see-also>`, etc.) but the attribute is fixed.
