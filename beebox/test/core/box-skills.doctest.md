# Box skill provisioning

`generateSkills` installs the managed box skills into `.claude/skills/<name>/SKILL.md`,
mirroring how `generateRules` installs card rules. The box agent auto-discovers
project-level skills, so a freshly-installed skill is invocable.

```ts setup
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { generateSkills } from "../../src/core/box/skills.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// `.claude/` lives at the package root for a v2 box, not under `content/`.
function skillFile(box, rel) {
  return join(box.root, ".claude/skills", rel);
}
```

It installs the managed skills and returns their names:

```ts
const box = await makeTmpBox();
const written = await generateSkills(box.root);
written
=> [
  "build-course",
  "calendar",
  "drive",
  "email",
  "location",
  "schedules",
  "tricks",
  "views"
]
```

Each lands at `.claude/skills/<name>/SKILL.md` with well-formed frontmatter (the
`name` and a `description` that drives triggering):

```ts
const box = await makeTmpBox();
await generateSkills(box.root);
const text = await readFile(skillFile(box, "build-course/SKILL.md"), "utf8");
text.startsWith("---\nname: build-course\n")
=> true

text.includes("description:") && text.includes("# Building a course")
=> true
```

The `calendar` and `drive` skills land the same way — a trigger `description` plus
their body — so they load on demand instead of always-loaded guide sections:

```ts
const box = await makeTmpBox();
await generateSkills(box.root);
const cal = await readFile(skillFile(box, "calendar/SKILL.md"), "utf8");
cal.startsWith("---\nname: calendar\n") && cal.includes("description:") && cal.includes("# Calendar")
=> true
```

The `calendar` skill is a static constant: it references the box timezone by the
`BOX_TZ` placeholder and points at `bbx calendar vtimezone` for the VTIMEZONE block,
rather than baking either in.

```ts continue
cal.includes("TZID=BOX_TZ:") && cal.includes("bbx calendar vtimezone")
=> true

const drv = await readFile(skillFile(box, "drive/SKILL.md"), "utf8");
drv.startsWith("---\nname: drive\n") && drv.includes("description:") && drv.includes("# Google Drive")
=> true
```

The guide-section extractions — `email`, `location`, `schedules`, `tricks`, `views` —
install the same way. Each is a doorway to a capability the always-loaded guide no
longer carries, discovered via its trigger `description`:

```ts
const box = await makeTmpBox();
await generateSkills(box.root);
const names = ["email", "location", "schedules", "tricks", "views"];
const texts = await Promise.all(names.map((name) => readFile(skillFile(box, name + "/SKILL.md"), "utf8")));
const bad = names.filter((name, i) => !(texts[i].startsWith("---\nname: " + name + "\n") && texts[i].includes("description:")));
bad.join(",")
=>
```

The `tricks` skill is now a single static constant with the package-layout
script path (`src/tricks/scripts/`), no shape fork:

```ts continue
texts[names.indexOf("tricks")].includes("src/tricks/scripts/")
=> true
```
