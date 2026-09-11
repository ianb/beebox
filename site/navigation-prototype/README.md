# Navigation experiment

Four finite YAML-frontmatter + Markdown cards explore collection/main and
main/aside layouts. Every body is marked as prototype content.

Run `node site/navigation-prototype/build.mjs` from the repository root. It
writes a self-contained `scratch/navigation-prototype/index.html`, suitable
for `bin/exhibits add`. This is separate from the deployed site's build.

The experiment embeds the current app's materials, card and chrome CSS at
build time for visual fidelity. That is a prototype convenience, not the
settled production sharing architecture. No app runtime is loaded.

Links use `?card=Reading.attach/Margin.doc.card` so the static exhibit can
reload every state without a server rewrite. Attachment directories infer
the canonical parent. Public URL prefix and routing remain undecided.

Desktop starts with collection/main, then shows main/aside. Mobile shows
only the destination, with an explicit parent link. Browser Back follows
visit history. Scroll offsets are remembered per card during the session.
Native View Transitions move the main sheet between panes; reduced-motion
and unsupported browsers update without animation. Landmarks expose the
two primary destinations. The footer varies system stock independently of
card stock. Tabs are deliberately deferred.

## Guided navigation experiment

`next` is an ordered frontmatter list of `{ card, label, at? }` destinations.
`at` names a heading slug in the destination. The first destination not yet
visited in this page session is suggested first; once all have been visited,
the last is the fallback. This is a suggestion, not a completion requirement.
The top parent link restores the remembered reading position; the authored
continuation at the bottom can instead resume at a particular section.
Reloading resets the visited set. The URL still preserves the destination
card and optional section.

The collection intentionally links only to the main document. Deep links to
asides still reconstruct their canonical parent, but deciding when to offer
a deep link from another context remains an open design question. No generic
list of every card is intended as the site's navigation.

The menu follows the app Dropdown/MenuItem appearance: white surface, warm
text and selection states, 8px corners, compact rows and trigger alignment.
