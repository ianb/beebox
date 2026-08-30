# Third-party assets and their attribution

Bundled work by other people, and what their licences require of us. Code
dependencies are not listed here — their licences travel in `node_modules` and
are permissive; this file is for **assets we redistribute and display**, where
the licence asks for a credit that has to live somewhere a person can find.

## Twemoji — emoji artwork

- **Package:** `@twemoji/svg`
- **Artwork:** © Twitter, Inc and other contributors, licensed
  [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- **Code:** MIT

Used to render a box's mark wherever a surface needs a real raster rather than
a character: the Apple touch icon, the web-app manifest icons, and notification
icons (`core/box/box-icon.ts`, `lib/twemoji.ts`).

**Why the artwork rather than the font.** The obvious approach — draw the emoji
as text in an SVG and rasterize it — was measured and rejected. librsvg renders
emoji as monochrome line art even where a colour emoji font is installed, and
the deployed server installs no emoji font at all, so it would have produced a
blank square in production. Twemoji ships each emoji as *shapes*, which need no
font and come out in colour at any size.

CC-BY requires attribution, and we redistribute the artwork (the dependency
ships to the server, and rasterized derivatives are served to browsers), so the
obligation is live rather than theoretical. This file is the credit. There is
no in-app credit today — the app has no About surface to put one on, and
inventing one was out of scope for the change that added the dependency. If an
About or version panel is ever added, this belongs on it.
