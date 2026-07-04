---
needs: [design]
area: callback-box
---

# Ref path normalization

Refs in cards use paths like `ref="../../../store/archive/Foo.record.card"` which are fragile and hard to read. Absolute refs (`ref="/store/archive/Foo.record.card"`) are already supported and preferred.

Ideas for automatic normalization:
- `cb validate --fix` could rewrite relative refs to absolute
- `cb create` could resolve ref arguments to absolute paths before writing
- The card loader could normalize refs on save (convert relative→absolute)
- A lint rule could warn on relative refs that go above the card's parent directory
