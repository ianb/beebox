---
title: Card themes
read-when: Choosing a card's visual treatment, stock, quote treatment, symbol, or Properties settings
---
# Card themes

Themes are presentation choices separate from views. A card normally opens in
its preferred view; its theme changes the material around that content.

## Choosing a card theme

Turn the card to its **Properties** surface with the corner-turn control in
the top-right corner, present in every theme. The **Appearance** row names the
effective theme, its stock, and its source, for example "Paper cream · Set on
this card". Open **Change** under that row for the swatch picker, which can set
an explicit card choice, such as:

```yaml
theme:
  name: paper
  stock: cream
```

Choose **Use default** to remove the card override and let the box resolve the
theme. The available card built-ins are `plain` (`neutral`), `paper` (`cream`,
`manila`, `blue`), `post-it` (`yellow`, `rose`, `mint`), `letter-set`
(`strawberry`, `lemon`, `sky`), `bloom` (`cutouts`), `ribbon` (`flow`),
`deck` (`panels`), `night-atlas` (`lights`), `rose-trellis` (`textile`), and
`gold-thread` (`textile`). The system-only `spectrum` (`gradient`) and
`candy` (`strawberry`) themes are available for app chrome. Name the theme and
stock together; a stock from another theme is not inherited.

Resolution is explicit: card choice, first matching box path rule, box card-type
choice, schema preference, box default, then the default card theme of the system
theme the card is shown on. Properties identifies which of those supplied the
result.

Each system theme names the card themes that go with it, its default first
(`cardThemes` in `src/shared/card-theme/catalog.ts`). A card theme may go with
several system themes. A card with no authored theme follows the system theme,
so it changes when it is shown under a landmark with a different system theme.
The card picker lists that system theme's card themes first and keeps the others
under **All card themes**. A chosen theme stays as chosen on every system theme;
when it is outside the paired set, the picker shows it first under **This card**. A malformed choice remains visible as a
presentation problem and falls back to plain while it is repaired. Card theme
names and stocks are open values; an unfamiliar name is preserved for
box-authored styling, with `neutral` as its default stock.

## Symbols

A card's `symbol:` is the small mark that stands for the card in a tab strip, a
listing, or a tile: `symbol: { glyph: 🍞 }`, optionally with
`foreground:`/`background:` colours (`#rgb`, `#rrggbb`, `hsl()`,
`hsla()`, `rgb()`, `rgba()` — nothing else), or `symbol: { src: <box ref
to an image> }` for a picture. The glyph is an emoji or a letter or two, not
a word. When to give a card one at all is in the agent guide's ABOUT_CARDS.

## Box defaults and location rules

Put box-wide choices in `_config/box.json`. The `presentation` object can set a
card default, choices by card type, ordered location rules, and an optional app
chrome choice:

```json
{
  "presentation": {
    "default": { "name": "plain", "stock": "neutral" },
    "cardTypes": {
      "doc": { "name": "paper", "stock": "cream" }
    },
    "rules": [
      {
        "match": "_content/projects/**",
        "theme": { "name": "paper", "stock": "manila" }
      },
      {
        "match": "_content/inbox/*.doc.card",
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
text selection, and floating controls such as the selection “+”. It is
independent of card themes; a card theme may set its own selection color.
Choose the box default in **Settings → System theme**. The system swatches preview
these interface parts rather than a card. Flat, Spectrum, Paper, Candy, Bloom, Ribbon, Deck, Night Atlas,
Rose Trellis, and Gold Thread support the system; Sticky note and Letter set are card themes only. Paper offers Slate, Terracotta, and Blue palettes
(stored as `cream`, `manila`, and `blue` respectively). A saved system theme
without chrome support, such as an unfamiliar name, falls back to Flat and is
reported as a presentation problem.

A landmark can override the box system theme. Open the landmark's directory from the
folder menu (**Open <dir>/**), open its landmark card, turn to **Properties**, open **Change** under **Appearance**, and use the separate **System theme** picker. **Use box
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
landmark does. Browse uses its current directory. Canonical interface cards such
as Settings use the box default. Existing `_config/box.json` files keep using
`presentation.chrome`; no rename or migration is required.

## Quotes and linked cards

The universal quote tag keeps attribution with quoted words. Its optional
`treatment` is `layered`, `inset`, or `plain`; omit it when the theme's default
should apply.

Paper, Sticky note, and Letter set use layered slips for both ordinary Markdown
blockquotes and attributed quote blocks. Plain keeps both flat, like a web page. An explicit
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
top-bar or composer implementation. System choices must provide registered
chrome support; accepting a custom card theme does not give it system support.

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

Bloom uses pastel cutouts on a pale mint desk, a pale blue toolbar with a narrow
multicolor stripe, and lilac controls. Its card material is warm cream with a
blue offset shadow and lavender inset quotes. Pink user-message slips retain
a cream offset shadow; assistant replies have a light reading panel. The single
`cutouts` stock is available as both a system theme and a card theme.

The chrome theme also owns the common background behind chat and companion
cards. Assistant replies normally sit directly on that background; Bloom supplies a
light panel to keep text readable over its cutouts. In Paper chrome,
local user messages appear as dark, borderless paper slips with white text attached to the right
edge; their tint follows the app bar stock. Flat keeps its usual message
bubbles. This treatment does not change message or scrolling behavior.


## Ribbon

Ribbon pairs flowing rust, amber and forest-green bands with cream cards and a
dark green toolbar. The card material has a simple green top edge, plain tabs,
and serif titles with a sans-serif body. Replies use translucent cream panels;
user messages are dark green. Select `ribbon` with stock `flow` for either a
system theme or an individual card. Explicit choices on other cards stay intact.


## Deck

Deck combines charcoal cloth with oversized rounded turquoise panels,
uneven screen-printed ink, pale bands, and offset outlines. Fine woven fibers
continue across dark cards and assistant reply panels without obscuring pale
text. Aqua user messages have petrol text and soft dark offset shadows. The
toolbar and composer use rounded controls with dyed turquoise accents. Select `deck` with stock `panels` for the system or an individual card.
Its paired card choices are Deck, Paper, and Sticky note. Cards with an explicit
choice keep their own material, including pale Paper on the dark workspace.


## Night Atlas

Night Atlas looks down over distant lights in turquoise and sea-green, with warm gold
and peach highlights. The workspace drifts slowly across varied terrain while
cards and controls stay still. Reduced-motion preferences keep the background
static. Deep teal cards and reply panels provide quiet reading surfaces; pale
mint user messages and warm gold controls carry the aerial palette into chat.
Select `night-atlas` with stock `lights` for the system or an individual card. Its
paired card choices are Night Atlas, Paper, and Sticky note. Explicit card choices
keep their own material.

Night Atlas’s background drifts slowly through field-like terrain, dense city
lights, and open harbor water. The horizontal pan has a constant speed, with a
thirty-minute traversal before returning; it does not accelerate midway. Only the decorative background moves;
reduced-motion preferences keep it static.


## Rose Trellis and Gold Thread

Rose Trellis combines a woven botanical background with coral and raspberry
color, warm cream reading surfaces, and olive-gold stems. Its patterned raspberry
toolbar and sweeping leaf-shaped controls carry that motion into the interface.
It has no rectangular background grid.

Gold Thread is a patterned dark theme: ink-blue cloth, loose flax-colored waves,
and matte blue controls with simple rounded corners. Its reading surfaces remain
quiet and dark, with warm ivory text. The texture supplies the energy; controls
have no metallic shine.

Choose `rose-trellis` or `gold-thread`, both with stock `textile`, for the system
or an individual card. Each pairs with its own card material, Paper, and Sticky
note. Explicit card choices retain their own material. Both backgrounds are
static, and print uses plain light surfaces.

## Goldfish and Doodlebit

Goldfish (`goldfish`, stock `water`) pairs large flowing goldfish illustrations
with cream reading surfaces and teal/periwinkle controls. Water light moves
slowly across the toolbar; the background illustration gently drifts as a whole.
The fins are not independently animated. Reduced motion keeps both layers still.

Doodlebit (`doodlebit`, stock `ink`) uses black-and-white pixel doodles, compact
regular labels, square controls and sparse lime accents. User messages are
white on black. A labeled Properties button replaces the folded corner.
Small cellular walkers advance with mouse travel over exposed desk space and
pause when the mouse stops; the larger doodles and reading surfaces stay still.
Touch and reduced-motion users get a static background. Both themes support
system and individual-card selection and respect explicit nested card themes.

## Phosphor, Overprint, and Posy

Phosphor (`phosphor`, stock `terminal`) is a dark green monochrome terminal
with ANSI-style text controls and compact fixed-width typography. Overprint
(`overprint`, stock `plate`) uses richly grained abstract print artwork; its
reading panels keep that material while shifting toward gray beneath restrained
color. Posy (`posy`, stock `paisley`) pairs a vivid hand-painted paisley field
with cream panels, small painted accents, and a quiet line frame.

All three support system and individual-card selection, pair with Paper and
Sticky note, and preserve explicit card materials.

## Tempest, Veil, and Gilt

Tempest (`tempest`, stock `water`) combines luminous stormy ocean artwork with
translucent dark reading surfaces. The water continues beneath the toolbar;
blur softens detail behind text. The artwork remains still.

Veil (`veil`, stock `pigment`) combines scraped fuchsia, jade and lime pigment
with pale opaque painted cards. Color overlaps suggest translucence without
making reading surfaces transparent. Controls use teal and lime; the folded
Properties corner has a transparent fill.

Gilt (`gilt`, stock `leaf`) uses worn goldleaf, mineral blue and oxblood abstract
forms. Rich gold title strips and controls pair with dark blue reading surfaces,
fine double card edges and narrow gilded message accents. Typography stays plain.

All three support system and individual-card selection, pair with Paper and
Sticky note, and preserve explicit card materials. Print uses light plain surfaces.
