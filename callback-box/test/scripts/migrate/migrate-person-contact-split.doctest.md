# Migration: split person `contact` into email/phone/address

`scripts/migrate/person-contact-split.ts` splits the person card's freeform
`contact:` string into structured `email:` / `phone:` / `address:` scalars.
`rewritePersonContact(fileName, raw)` returns `{ text, residual }` (or `null`
when there's nothing to do). It is **conservative and noisy**: only confidently
classifiable parts become fields; everything else is preserved in the body under
a `## Contact` note and listed in `residual` (which drives a migration warning).

The examples below use the shapes seen in real boxes.

```ts setup
import { rewritePersonContact } from "../../../scripts/migrate/person-contact-split.js";

const card = (contact) => `---\nstatus: active\nname: X\ncontact: ${contact}\n---\nNotes.\n`;
```

## A pure postal address → `address:`, nothing left over

```ts
const r = rewritePersonContact("G.person.card", card("3447 20th Ave. S., Minneapolis, MN 55407"));
r.residual
=> []

r.text.includes("address: 3447 20th Ave. S., Minneapolis, MN 55407")
=> true

r.text.includes("contact:")
=> false
```

## "address · phone" → both fields, nothing left over

```ts
const r = rewritePersonContact("M.person.card", card("1450 Oak Avenue N · 555-100-2003"));
[r.residual.length, r.text.includes("address: 1450 Oak Avenue N"), r.text.includes("phone: 555-100-2003")]
=> [
  0,
  true,
  true
]
```

## A multi-line block with two emails → first email + phone + address; the extra email line is preserved

```ts
const block = "---\nstatus: active\nname: Noor\ncontact: |-\n  1200 Cedar Street, Springfield, IL 62704\n  noor@example.net (preferred) / noor@example.org (also works)\n  555-100-2004\n---\nNotes.\n";
const r = rewritePersonContact("Noor.person.card", block);
[r.text.includes("email: noor@example.net"), r.text.includes("phone: 555-100-2004"), r.text.includes("address: 1200 Cedar Street, Springfield, IL 62704")]
=> [
  true,
  true,
  true
]

// The second email + annotations survive verbatim in the body note.
r.residual
=> [
  "noor@example.net (preferred) / noor@example.org (also works)"
]

r.text.includes("## Contact")
=> true
```

## Labeled Phone/Fax/Email → phone + email as fields; the fax is preserved (no fax field)

```ts
const block = "---\nstatus: active\nname: Idris\ncontact: |-\n  Phone: (555) 100-2005\n  Fax: (555) 100-2006\n  Email: idris@example.com\n---\nb\n";
const r = rewritePersonContact("Idris.person.card", block);
[r.text.includes("phone: (555) 100-2005"), r.text.includes("email: idris@example.com")]
=> [
  true,
  true
]

r.residual
=> [
  "Fax: (555) 100-2006"
]
```

## Biographical misuse → no fields; the whole value is preserved for review

```ts
const r = rewritePersonContact("Priya.person.card", card("London, England (1815–1852)"));
[r.text.includes("email:"), r.text.includes("phone:"), r.text.includes("address:")]
=> [
  false,
  false,
  false
]

r.residual
=> [
  "London, England (1815–1852)"
]

r.text.includes("## Contact\n\n- London, England (1815–1852)")
=> true
```

## A vague locale (no street/zip) is preserved, not mis-filed as address

```ts
rewritePersonContact("Ian.person.card", card("Minneapolis, Minnesota (Powderhorn Park neighborhood)")).residual
=> [
  "Minneapolis, Minnesota (Powderhorn Park neighborhood)"
]
```

## Idempotent + scoped: no `contact` key, or a non-person card, → null

```ts
rewritePersonContact("A.person.card", "---\nname: A\nemail: a@b.co\n---\nb\n")
=> null

rewritePersonContact("Home.place.card", card("123 Main St, Townsville, CA 90001"))
=> null
```
