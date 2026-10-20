# Site presentation assets

`site.css` supplies static-site layout, navigation and responsive behavior.
These local assets are included in the source manifest and copied to dist.
`tts-comparison/` holds the audio for the text-to-speech comparison page,
written by `research/tts-model-comparison/publish.ts`; do not edit it by hand.

The card and chrome themes are not kept here. The build copies the app's theme
stylesheets (in the order `beebox/src/frontend/src/main/app.tsx` imports them)
into one `dist/assets/themes/themes.css`, with their `art/`, and writes
`dist/assets/day-theme.js`, which shows the day's system theme. See
`site/day-theme.ts`.
