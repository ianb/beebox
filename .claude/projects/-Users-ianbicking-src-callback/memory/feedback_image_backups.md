---
name: Keep image backups on regeneration
description: When regenerating architecture doc images, keep the previous version as a numbered backup (e.g., .1.bak.png) so the user can compare
type: feedback
---

When regenerating images in docs/architecture/images/, rename the previous version to a numbered backup (e.g., `card-anatomy-diagram.1.bak.png`) before writing the new one. Don't add backups to git. The user wants to be able to glance at what changed but doesn't need them preserved long-term.

**Why:** The user wants to casually compare before/after when image prompts change, but the old version gets overwritten silently during regeneration.

**How to apply:** Before running `generate:doc-images` for a file that already exists, copy the existing image to a `.N.bak.png` suffix (incrementing N if backups already exist). Don't commit the backups.
