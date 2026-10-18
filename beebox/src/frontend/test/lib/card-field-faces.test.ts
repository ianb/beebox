// # Which face shows each card field
//
// `splitCardFields` decides, for every frontmatter key, whether the card front
// (the reading face) or Properties (the card as an object) shows it. Each
// common field has one named place; every other key is a type field. Properties
// has two places: `foundBy`, its named rows for the common fields that say how
// the card is found, and `properties`, its table of type fields.

import { test } from "tap";
import "agent-doctest/tap";
import { COMMON_FIELDS, isCardBodyEmpty, splitCardFields } from "../../src/lib/card-field-faces.js";
import { GLOBAL_CARD_FIELDS } from "../../../cards/schema.js";

const memo = {
  title: "Porch",
  contains: "Porch repair quotes",
  "contains-evidence": "Three quotes in the body",
  todos: [{ text: "Book the inspector" }],
  symbol: { glyph: "🏠" },
  prominence: "primary",
  theme: { name: "paper" },
  status: "new",
  created: "2026-07-01T10:00:00Z",
};

// On a page, for a type with a body field, the front keeps only `todos`: the
// title is the header and `theme` is the Appearance row, so neither appears.
// The type fields `status` and `created` go to Properties' table.
void test("On a page, for a type with a body field, the front keeps only todos:", async (t) => {
  // doctest:L31
  t.check(splitCardFields(memo, { hasBodyField: true, bodyEmpty: false, mode: "page" }), {
    front: {
      todos: [
        {
          text: "Book the inspector",
        },
      ],
    },
    foundBy: {
      contains: "Porch repair quotes",
      "contains-evidence": "Three quotes in the body",
      symbol: {
        glyph: "🏠",
      },
      prominence: "primary",
    },
    properties: {
      status: "new",
      created: "2026-07-01T10:00:00Z",
    },
  });
});

// A bodiless type has nothing else to show on its front, so its type fields
// stay there. A card whose schema is unknown (it failed validation, so
// `card.get` returned `schema: null`) has no field classification, and its
// fields stay on the front rather than being hidden:
void test("A bodiless type has nothing else to show on its front, so its type fields sta...", async (t) => {
  // doctest:L50
  t.check(splitCardFields(memo, { hasBodyField: false, bodyEmpty: false, mode: "page" }).front, {
    todos: [
      {
        text: "Book the inspector",
      },
    ],
    status: "new",
    created: "2026-07-01T10:00:00Z",
  });

  // doctest:L53
  t.check(splitCardFields(memo, { hasBodyField: null, bodyEmpty: false, mode: "chat" }).front, {
    todos: [
      {
        text: "Book the inspector",
      },
    ],
    status: "new",
    created: "2026-07-01T10:00:00Z",
  });
});

// An embedded card has no header and no Properties face, so its title and type
// fields show on the front; the "found by" fields and `theme` stay off it:
void test("An embedded card has no header and no Properties face, so its title and type...", async (t) => {
  // doctest:L61
  t.check(splitCardFields(memo, { hasBodyField: true, bodyEmpty: false, mode: "embed" }), {
    front: {
      title: "Porch",
      todos: [
        {
          text: "Book the inspector",
        },
      ],
      status: "new",
      created: "2026-07-01T10:00:00Z",
    },
    foundBy: {
      contains: "Porch repair quotes",
      "contains-evidence": "Three quotes in the body",
      symbol: {
        glyph: "🏠",
      },
      prominence: "primary",
    },
    properties: {},
  });
});

// ## An empty body puts the type fields on the front
//
// A bodied type whose body is empty would show only "No body content" while
// its facts sat in Properties, so its type fields go to the front instead
// (docs/implemented-plans/place-shows-cards.md, Track B). The common fields keep their
// places, and Properties' table is empty, so no field shows twice:
void test("A bodied type whose body is empty would show only \"No body content\" while its...", async (t) => {
  // doctest:L82
  t.check(splitCardFields(memo, { hasBodyField: true, bodyEmpty: true, mode: "page" }), {
    front: {
      todos: [
        {
          text: "Book the inspector",
        },
      ],
      status: "new",
      created: "2026-07-01T10:00:00Z",
    },
    foundBy: {
      contains: "Porch repair quotes",
      "contains-evidence": "Three quotes in the body",
      symbol: {
        glyph: "🏠",
      },
      prominence: "primary",
    },
    properties: {},
  });
});

// The same bodied type with a body keeps them in Properties:
void test("The same bodied type with a body keeps them in Properties:", async (t) => {
  // doctest:L98
  t.check(splitCardFields(memo, { hasBodyField: true, bodyEmpty: false, mode: "page" }).properties, {
    status: "new",
    created: "2026-07-01T10:00:00Z",
  });
});

// An embed puts them on the front either way:
void test("An embed puts them on the front either way:", async (t) => {
  // doctest:L105
  const embedEmpty = splitCardFields(memo, { hasBodyField: true, bodyEmpty: true, mode: "embed" });
  const embedFull = splitCardFields(memo, { hasBodyField: true, bodyEmpty: false, mode: "embed" });
  t.check([JSON.stringify(embedEmpty) === JSON.stringify(embedFull), Object.keys(embedFull.front)], [
    true,
    [
      "title",
      "todos",
      "status",
      "created",
    ],
  ]);
});

// `isCardBodyEmpty` is the test every caller passes as `bodyEmpty`, and the one
// `CardBody` uses before it says "No body content". A body is empty when it is
// absent, only whitespace, or only a heading that repeats the title:
void test("isCardBodyEmpty is the test every caller passes as bodyEmpty, and the one Car...", async (t) => {
  // doctest:L116
  t.check(
    [
      isCardBodyEmpty(undefined, "Porch"),
      isCardBodyEmpty("\n  \n", "Porch"),
      isCardBodyEmpty("# Porch\n\n", "Porch"),
      isCardBodyEmpty("# Porch\n\nThree quotes.\n", "Porch"),
      isCardBodyEmpty("# Deck\n", "Porch"),
    ],
    [
    true,
    true,
    true,
    false,
    false,
  ],
  );
});

// `COMMON_FIELDS` names exactly the schema layer's global fields
// (`GLOBAL_CARD_FIELDS`), so a new global field fails here until
// `splitCardFields` gives it a place:
void test("COMMONFIELDS names exactly the schema layer's global fields (GLOBALCARDFIELDS...", async (t) => {
  // doctest:L131
  t.check(Object.keys(GLOBAL_CARD_FIELDS).toSorted(), [
    "contains",
    "contains-evidence",
    "prominence",
    "symbol",
    "theme",
    "title",
    "todos",
  ]);

  // doctest:L134
  t.check([...COMMON_FIELDS].toSorted(), [
    "contains",
    "contains-evidence",
    "prominence",
    "symbol",
    "theme",
    "title",
    "todos",
  ]);
});
