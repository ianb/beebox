# Record card schema: where a claim came from

A record's `sources:` says where its content came from. Each entry names either
an in-box card (`ref:`) or a page on the web (`href:`) — the same exclusive pair
the `{% source %}` body tag takes, so a box agent writing a source has one
vocabulary, not two. Before `href` existed a web source was written as a URL in
`ref:`, and the linter's ref walk then reported it as a missing file.

```ts setup
import { parseCardText } from "../../src/core/card-io.js";
import { createCardSchemaMap } from "../../src/schemas/registry.js";
import { errorMessage } from "../../src/lib/error-guards.js";

const schemas = await createCardSchemaMap();
const parse = (fm: string) =>
  parseCardText(`---\n${fm}---\nA thing the box recorded.\n`, {
    source: "_content/records/Thing.record.card",
    schemas,
  });

const messageFor = (fm: string): string => {
  try {
    parse(fm);
    return "no error";
  } catch (e) {
    return errorMessage(e);
  }
};
```

## An in-box source and a web source each validate

```ts
const inBox = parse("status: draft\nname: Thing\nsources:\n  - ref: /_content/inbox/scan.pdf.card\n    note: the scan\n");
const web = parse("status: draft\nname: Thing\nsources:\n  - href: https://example.com/notice\n    time: 2026-02-19T17:06:25Z\n");
JSON.stringify([inBox.fields["sources"], web.fields["sources"]])
=> [[{"ref":"/_content/inbox/scan.pdf.card","note":"the scan"}],[{"href":"https://example.com/notice","time":"2026-02-19T17:06:25Z"}]]
```

## An entry with neither, or both, is a schema error

Both halves matter: "neither" is the empty entry an agent leaves behind when it
means to cite something, and "both" is the ambiguity that would make a reader
guess which target the note is really about.

```ts continue
parse("status: draft\nname: Thing\nsources:\n  - note: somewhere\n")
=> throws CardIOError

parse("status: draft\nname: Thing\nsources:\n  - ref: /_content/inbox/scan.pdf.card\n    href: https://example.com/notice\n")
=> throws CardIOError
```

The message names the rule, so the agent that wrote the card can fix it without
reading the schema:

```ts continue
messageFor("status: draft\nname: Thing\nsources:\n  - ref: /_content/inbox/scan.pdf.card\n    href: https://example.com/notice\n")
  .includes("a `sources` entry takes exactly one of `ref` or `href`, not both")
=> true
```
