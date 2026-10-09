# The card header title

`title:` wins; a landmark without one is headed by its place's
`navigation.label`; a named entity (person, place) by its `name:`; otherwise
the filename stands in.

```ts setup
import { cardTitle } from "../../../../src/components/themes/ThemedFileCard/view.js";
```

```ts
cardTitle({ path: "_content/people/Mom.person.card", frontmatter: { name: "Dr. Rosa Quill" } })
=> Dr. Rosa Quill

cardTitle({ path: "_content/people/Mom.person.card", frontmatter: { title: "Mom", name: "Dr. Rosa Quill" } })
=> Mom

cardTitle({ path: "_content/people/Rosa_Quill.person.card", frontmatter: {} })
=> Rosa Quill
```

A landmark card is the place page, so it is headed by the place's name, the
label the place pill and the "Go to" buttons use. The 2026-10-09 walks saw
"Box" and "Intro Chemistry" (filenames) above pages the rest of the app called
by the box's name and "Chemistry".

```ts
cardTitle({ path: "_content/Box.landmark.card", frontmatter: { navigation: { label: "Kitchen" } } })
=> Kitchen

cardTitle({ path: "_content/chem/Intro_Chemistry.landmark.card", frontmatter: { navigation: { label: "Chemistry", openers: [] } } })
=> Chemistry
```

A landmark with no label (a destinations-only one) falls back to its filename.

```ts
cardTitle({ path: "_content/inbox/Inbox.landmark.card", frontmatter: { navigation: { label: "  " } } })
=> Inbox
```
