---
title: Card themes
read-when: Choosing a card's visual treatment, stock, quote treatment, or Properties settings
---
# Card themes

Themes are presentation choices separate from views. A card normally opens in
its preferred view; its theme changes the material around that content.

## Choosing a card theme

Use the card's **Properties** surface to inspect the effective theme and its
source. The corner-turn control is in the top-right corner in every theme.
The swatch picker can set an explicit card choice, such as:

```yaml
theme:
  name: paper
  stock: cream
```

Choose **Use default** to remove the card override and let the box resolve the
theme. The available built-ins are `plain` (`neutral`), `paper` (`cream`,
`manila`, `blue`), and `post-it` (`yellow`, `rose`, `mint`). Name the theme and
stock together; a stock from another theme is not inherited.

Resolution is explicit: card choice, first matching box path rule, box card-type
choice, schema preference, box default, then plain. Properties identifies which
of those supplied the result. A malformed or unknown choice remains visible as
a presentation problem and falls back to plain while it is repaired.

## Box defaults and location rules

Put box-wide choices in `_config/box.json`. The `presentation` object can set a
card default, choices by card type, ordered location rules, and an optional app
chrome choice:

```json
{
  "presentation": {
    "default": { "name": "plain", "stock": "neutral" },
    "cardTypes": {
      "memo": { "name": "paper", "stock": "cream" }
    },
    "rules": [
      {
        "match": "_content/projects/**",
        "theme": { "name": "paper", "stock": "manila" }
      },
      {
        "match": "_content/inbox/*.memo.card",
        "theme": { "name": "post-it", "stock": "yellow" }
      }
    ],
    "chrome": { "name": "paper", "stock": "cream" }
  }
}
```

Rules use box-relative paths without a leading slash. `*` matches within one
path segment. A segment that is exactly `**` crosses zero or more segments.
Rules are tested in order and the first match wins, so put narrower rules before
broader ones. `?`, bracket/brace patterns, negation, backslashes, empty path
segments, and `.` or `..` segments are unsupported.

After editing `_config/box.json`, run `bbx validate` without a path argument.
It validates the presentation catalog choices and location patterns along with
the rest of the box. A card's own `theme` remains the way to make an exception
to a matching rule.

## Quotes and linked cards

The universal quote tag keeps attribution with quoted words. Its optional
`treatment` is `layered`, `inset`, or `plain`; omit it when the theme's default
should apply.

Paper and Sticky note use layered slips for both ordinary Markdown blockquotes
and attributed quote blocks. Plain keeps both flat, like a web page. An explicit
`treatment="inset"` or `treatment="plain"` opts out of the slip for that quote;
`treatment="layered"` can opt into a slip even on Plain.

```markdoc
{% quote from="Rowan Vale" treatment="layered" %}
Keep the quoted words intact.
{% /quote %}
```

In a custom view, use `CardLink` for an ordinary link and `CardRef` when the
reader should also be able to expand the referenced card in place. An
independently surfaced card uses its own resolved theme. Frameless embeds,
including `CardRef` expansion and Markdown embeds, inherit the enclosing card's
theme. A self-styled authored view can still draw its own material inside that
frame.

Themes may provide optional app chrome, but a card theme does not require a
top-bar or composer implementation. Do not invent a new theme name or stock in
a card: built-ins are catalogued by the engine and unknown values are errors.
