# Box skill provisioning

`generateSkills` installs the managed box skills into `.claude/skills/<name>/SKILL.md`,
mirroring how `generateRules` installs card rules. The box agent auto-discovers
project-level skills, so a freshly-installed skill is invocable.

```ts setup
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { generateSkills } from "../../src/core/box-skills.js";
import { readFile } from "node:fs/promises";
```

It installs the managed skills and returns their names:

```ts
const box = await makeTmpBox();
const written = await generateSkills(box.root);
written
=> [
  "build-course"
]
```

Each lands at `.claude/skills/<name>/SKILL.md` with well-formed frontmatter (the
`name` and a `description` that drives triggering):

```ts
const box = await makeTmpBox();
await generateSkills(box.root);
const text = await readFile(box.path(".claude/skills/build-course/SKILL.md"), "utf8");
text.startsWith("---\nname: build-course\n")
=> true

text.includes("description:") && text.includes("# Building a course")
=> true
```
