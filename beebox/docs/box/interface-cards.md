---
read-when: Opening or editing a built-in interface instrument, linking to History, or repairing a missing or misplaced interface card.
---

# Interface cards

Each built-in interface instrument has one canonical card:

| Instrument | Box-relative card path | Type |
|---|---|---|
| Dashboard | `_config/interface/dashboard.card` | `dashboard` |
| Settings | `_config/interface/settings.card` | `settings` |
| Browse | `_config/interface/browse.card` | `browse` |
| Questions | `_config/interface/questions.card` | `questions` |
| Landmarks | `_config/interface/landmarks.card` | `landmarks` |
| History | `_config/interface/history.card` | `history` |
| Storage | `_config/interface/inventory.card` | `inventory` |
| Admin | `_config/interface/admin.card` | `admin` |

Open these through ordinary card links. Navigation shortcuts open the same
cards. A bare filename such as `dashboard.card` already selects its type. Do
not add `type:` or `view:` frontmatter; the type selects the built-in renderer.

These cards accept a title and a markdown body for notes or rationale. Inspect
the body through source; it is not inserted into the instrument's controls.
Adding prose does not configure live UI state or grant permission. Settings and
Admin actions keep their existing authorization checks; a card is an address,
not authority.

Do not copy, rename, move, archive, or delete these eight anchors. Their
renderers reject any other location, and validation rejects misplaced copies.
This restriction applies to these eight types, not every card in the `system`
category. Many other system cards, such as jobs, have multiple instances.
Authored `view: history` cards are also deliberately plural: they save reusable
History filters but do not replace or duplicate the canonical History entrance.

## Browsing without editing the card

Browse is one instrument, not one card per directory. Its target stays
`_config/interface/browse.card` while its view state holds the current directory.
Older links may also contain a selected file; opening one transfers that file
to an ordinary workspace tab and clears the legacy selection from Browse. A directory parameter can seed an opening, for
example `/_config/interface/browse.card?dir=_content/recipes`.

Clicking directories and breadcrumbs changes view state in the same Browse tab.
Selecting a file opens it in the right workspace pane on desktop, leaving Browse
visible when it occupies the left pane. If Browse is already in the right pane,
the file joins that pane's tab strip. Mobile uses the workspace's single-card
view. A bare open reuses Browse's current location; an explicit directory or
view state changes it.

Do not write the current directory, selected file, or navigation history into
the card's frontmatter or body. Do not create a second Browse card to visit a
different directory. When interpreting chat context, distinguish the canonical
Browse card ref from the directory represented by its parsed view state.

## History state and saved defaults

Open History by targeting its canonical card, or an authored `view: history`
card for a saved filter. Put an optional filter and selected commit in card view
state; do not escape to a separate History page or write them into the card.
Legacy query values resolve per key over an authored saved card's defaults,
which override canonical defaults. A supplied `viewState.filter` is an explicit
complete filter and replaces that resolved filter rather than partially merging
with it.

A missing filter uses those defaults. An explicitly empty filter means no
filtering. A missing commit selects the newest matching commit, while an
explicit `null` commit stays on the timeline. Reset returns to the opened
card's defaults: saved defaults for an authored History view, canonical
defaults for the canonical card. A `session` inside the History filter filters
commits; it does not select the chat recipient.

## Attention and conversation selection

Opening, focusing, or navigating an interface card changes workspace attention
and context only. It does not change the selected conversation, draft, or send
destination. Only an explicit conversation action, such as selecting a recent
chat or asking to chat about a target, changes the recipient.

## Missing cards

Initialization supplies all eight anchors, and every existing box has them (the
seeding migrations `canonical-interface-cards` and `remaining-interface-cards`
are retired). Unexpected content at a canonical path or a misplaced instance is
a conflict to resolve; it is not permission to overwrite content or select an
arbitrary copy.

Ordinary commits cannot remove an anchor. Pre-commit checks the proposed Git
index: leaving an unstaged copy on disk cannot conceal a staged deletion. For
an accidental deletion, restore the card from Git history. Do not fake
completion, remove a manifest record, or disable validation to get a commit
through. A future relocation needs a declared migration and its final required
set, not an ordinary card move.
