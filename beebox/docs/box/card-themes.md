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
theme. The available card built-ins are `plain` (`neutral`), `paper` (`cream`,
`manila`, `blue`), and `post-it` (`yellow`, `rose`, `mint`). The system-only
`spectrum` (`gradient`) theme is available for app chrome. Name the theme and
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

## System themes and landmark overrides

The **system theme** styles the toolbar, shared background, user-message slips,
and floating controls such as the selection “+”. It is independent of card themes.
Choose the box default in **Settings → System theme**. The system swatches preview
these interface parts rather than a card. Flat, Spectrum, and Paper support the
system; Sticky note is a card theme only. Paper offers Slate, Terracotta, and Blue palettes
(stored as `cream`, `manila`, and `blue` respectively).

A landmark can override the box system theme. Open its card from the **here** menu,
turn to **Properties**, and use the separate **System theme** picker. **Use box
default** removes that override. An agent can make the same choice in landmark
frontmatter:

```yaml
system-theme:
  name: paper
  stock: manila
```

The ordinary `theme` field still styles the landmark card itself. Do not use it to
style the surrounding interface. System resolution uses the current landmark's
`system-theme`, then the box's `presentation.chrome` (including its existing
box-default fallback), then the built-in Flat theme. A landmark without an
override uses the box default, not another landmark's override.

Inside a workspace, the selected conversation's context determines the landmark.
Opening or moving a card does not change the system theme; switching to a different
landmark does. Browse uses its current directory. Global pages such as Settings
use the box default. Existing `_config/box.json` files keep using
`presentation.chrome`; no rename or migration is required.

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

## App bar materials

`presentation.chrome` selects the surrounding app appearance independently of
individual cards. Flat is a solid ink-blue bar with a flat neutral desk.
Spectrum keeps the colorful gradient that was previously the unnamed default.
Paper gives the bar a
single saturated, textured surface with raised round controls: `cream` uses
slate blue, `manila` uses rust, and `blue` uses ink blue. These are chrome
interpretations of the stocks; card surfaces retain their pale paper colors.
For example, `"chrome": { "name": "paper", "stock": "blue" }` selects the
blue bar. Changing this choice updates open pages through the box's existing
configuration subscription.

The chrome theme also owns the common background behind chat and companion
cards. Assistant replies sit directly on that background. In Paper chrome,
local user messages appear as dark, borderless paper slips with white text attached to the right
edge; their tint follows the app bar stock. Flat keeps its usual message
bubbles. This treatment does not change message or scrolling behavior.
