---
read-when: Opening or editing Dashboard, Settings, or Browse, or repairing missing or misplaced interface cards.
---

# Interface cards

Dashboard, Settings, and Browse each have one canonical card:

| Instrument | Box-relative card path | Type |
|---|---|---|
| Dashboard | `_config/interface/dashboard.card` | `dashboard` |
| Settings | `_config/interface/settings.card` | `settings` |
| Browse | `_config/interface/browse.card` | `browse` |

Open these through ordinary card links. Profile-menu Settings and the other
navigation shortcuts open the same cards. The bare filename `dashboard.card`
already selects type `dashboard`. Do not add `type:` or `view:` frontmatter.
The type selects the built-in renderer.

These cards accept a title and a markdown body for notes or rationale. Inspect
the body through source; it is not inserted into the instrument's controls.
Adding prose does not configure dashboard widgets or change account settings.
Settings actions keep their existing authorization checks; a card cannot grant
permission by declaring it in frontmatter.

Do not copy, rename, move, archive, or delete these three anchors. Their
renderers reject any other location, and validation rejects misplaced copies.
This restriction applies to these three types, not every card in the `system`
category. Many other system cards, such as jobs, have multiple instances.

## Browsing without editing the card

Browse is one instrument, not one card per directory. Its target stays
`_config/interface/browse.card` while its view state holds the current directory
and optional selected file. A directory parameter can seed an opening, for
example `/_config/interface/browse.card?dir=_content/recipes`.

Clicking directories and breadcrumbs changes view state in the same Browse tab.
Selecting a file shows detail inside Browse. Back and Forward restore that
navigation. A bare open reuses Browse's current location; an explicit directory
or view state changes it. An explicit open-in-workspace action opens the file
separately and leaves Browse's location intact.

Do not write the current directory, selected file, or navigation history into
the card's frontmatter or body. Do not create a second Browse card to visit a
different directory. When interpreting chat context, distinguish the canonical
Browse card ref from the directory represented by its parsed view state.
Attention to a card does not change the selected conversation or a captured
send destination.

## Missing cards and migration repair

Initialization and the registered `canonical-interface-cards` migration supply
missing anchors. They preserve existing valid titles and notes. Unexpected
content at a canonical path or a misplaced instance is a conflict to resolve;
it is not permission to overwrite content or select an arbitrary copy.

Before bootstrap completion, an older box may be missing some anchors. Ordinary
commits still cannot remove anchors already present. Once bootstrap completion
is recorded, the complete valid set is required. Pre-commit checks the proposed
Git index: leaving an unstaged copy on disk cannot conceal a staged deletion.

For an accidental deletion, restore the intended card from Git history. For an
older box, inspect pending migrations with `bbx migrate --status` and use the
normal migration process. Do not fake completion, remove its manifest record,
disable validation, or invent a migration-mode flag to get a commit through.
Marking this migration applied verifies the cards already exist; it does not
create them. A future relocation needs a declared migration and its final
required set, not an ordinary card move.
