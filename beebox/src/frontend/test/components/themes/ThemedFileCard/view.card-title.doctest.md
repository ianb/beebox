# The card header title

`title:` wins; a named entity without one (person, place) is headed by its
`name:`; otherwise the filename stands in.

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
